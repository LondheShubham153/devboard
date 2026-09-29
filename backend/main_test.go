package main

import (
	"bytes"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type mockDriver struct {
	mu           sync.Mutex
	queryHandler func(query string, args []driver.Value) (driver.Rows, error)
}

func (m *mockDriver) Open(name string) (driver.Conn, error) {
	return &mockConn{driver: m}, nil
}

type mockConn struct {
	driver *mockDriver
}

func (c *mockConn) Prepare(query string) (driver.Stmt, error) {
	return &mockStmt{conn: c, query: query}, nil
}

func (c *mockConn) Close() error { return nil }

func (c *mockConn) Begin() (driver.Tx, error) {
	return &mockTx{}, nil
}

func (c *mockConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	c.driver.mu.Lock()
	defer c.driver.mu.Unlock()
	if c.driver.queryHandler != nil {
		return c.driver.queryHandler(query, args)
	}
	return nil, errors.New("unhandled query")
}

type mockTx struct{}

func (t *mockTx) Commit() error   { return nil }
func (t *mockTx) Rollback() error { return nil }

type mockStmt struct {
	conn  *mockConn
	query string
}

func (s *mockStmt) Close() error  { return nil }
func (s *mockStmt) NumInput() int { return -1 }
func (s *mockStmt) Exec(args []driver.Value) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}

func (s *mockStmt) Query(args []driver.Value) (driver.Rows, error) {
	return s.conn.Query(s.query, args)
}

type mockRows struct {
	columns []string
	rows    [][]driver.Value
	idx     int
}

func (r *mockRows) Columns() []string { return r.columns }
func (r *mockRows) Close() error      { return nil }
func (r *mockRows) Next(dest []driver.Value) error {
	if r.idx >= len(r.rows) {
		return io.EOF
	}
	for i, val := range r.rows[r.idx] {
		dest[i] = val
	}
	r.idx++
	return nil
}

var testMockDriver = &mockDriver{}

func init() {
	sql.Register("mock_db", testMockDriver)
	gin.SetMode(gin.TestMode)
}

func setMockQueryHandler(h func(query string, args []driver.Value) (driver.Rows, error)) func() {
	testMockDriver.mu.Lock()
	testMockDriver.queryHandler = h
	testMockDriver.mu.Unlock()

	return func() {
		testMockDriver.mu.Lock()
		testMockDriver.queryHandler = nil
		testMockDriver.mu.Unlock()
	}
}

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	mockDB, err := sql.Open("mock_db", "")
	if err != nil {
		t.Fatalf("failed to open mock db: %v", err)
	}
	origDB := db
	db = mockDB
	t.Cleanup(func() {
		db = origDB
		mockDB.Close()
	})
	return mockDB
}

// ---------------------------------------------------------------------------
// Unit tests for helpers
// ---------------------------------------------------------------------------

func TestEnvReturnsFallbackWhenUnset(t *testing.T) {
	os.Unsetenv("DEVBOARD_TEST_KEY")
	if got := env("DEVBOARD_TEST_KEY", "fallback"); got != "fallback" {
		t.Errorf("env() = %q, want %q", got, "fallback")
	}
}

func TestEnvReturnsValueWhenSet(t *testing.T) {
	os.Setenv("DEVBOARD_TEST_KEY", "real")
	defer os.Unsetenv("DEVBOARD_TEST_KEY")
	if got := env("DEVBOARD_TEST_KEY", "fallback"); got != "real" {
		t.Errorf("env() = %q, want %q", got, "real")
	}
}

func TestJoin(t *testing.T) {
	cases := []struct {
		parts []string
		sep   string
		want  string
	}{
		{[]string{}, ",", ""},
		{[]string{"a"}, ",", "a"},
		{[]string{"a", "b", "c"}, ", ", "a, b, c"},
	}

	for _, tc := range cases {
		if got := join(tc.parts, tc.sep); got != tc.want {
			t.Errorf("join(%v, %q) = %q, want %q", tc.parts, tc.sep, got, tc.want)
		}
	}
}

func TestFailHelper(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	fail(c, errors.New("something went wrong"))

	if w.Code != http.StatusInternalServerError {
		t.Errorf("fail() HTTP status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
	var res map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil || res["error"] != "internal error" {
		t.Errorf("fail() response = %v, want error: 'internal error'", res)
	}
}

type dummyScannable struct {
	err error
}

func (d *dummyScannable) Scan(dest ...interface{}) error {
	return d.err
}

func TestScanTaskError(t *testing.T) {
	_, err := scanTask(&dummyScannable{err: errors.New("scan error")})
	if err == nil {
		t.Errorf("expected error from scanTask, got nil")
	}
}

// ---------------------------------------------------------------------------
// Health check & CORS
// ---------------------------------------------------------------------------

func TestHealthCheck(t *testing.T) {
	r := setupRouter()

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("GET /health status = %d, want %d", w.Code, http.StatusOK)
	}

	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode JSON response: %v", err)
	}
	if body["status"] != "ok" || body["service"] != "backend" {
		t.Errorf("unexpected body: %v", body)
	}
}

func TestCORSOrigins(t *testing.T) {
	os.Setenv("CORS_ORIGIN", "https://devboard.example.com")
	defer os.Unsetenv("CORS_ORIGIN")

	r := setupRouter()

	testCases := []struct {
		origin      string
		shouldAllow bool
	}{
		{"http://127.0.0.1:8080", true},
		{"http://127.0.0.1", true},
		{"http://localhost:3000", true},
		{"http://localhost", true},
		{"https://devboard.example.com", true},
		{"http://unauthorized-domain.com", false},
	}

	for _, tc := range testCases {
		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Access-Control-Request-Method", "GET")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		allowOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if tc.shouldAllow && allowOrigin != tc.origin {
			t.Errorf("origin %q: expected allow-origin %q, got %q", tc.origin, tc.origin, allowOrigin)
		}
		if !tc.shouldAllow && allowOrigin != "" {
			t.Errorf("origin %q: expected no allow-origin, got %q", tc.origin, allowOrigin)
		}
	}
}

// ---------------------------------------------------------------------------
// Project endpoints
// ---------------------------------------------------------------------------

func TestListProjectsSuccess(t *testing.T) {
	setupTestDB(t)

	now := time.Now()
	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return &mockRows{
			columns: []string{"id", "name", "description", "owner_id", "created_at"},
			rows: [][]driver.Value{
				{int64(1), "Project Alpha", "Description Alpha", int64(10), now},
				{int64(2), "Project Beta", "Description Beta", nil, now},
			},
		}, nil
	})
	defer cleanup()

	r := setupRouter()
	req := httptest.NewRequest(http.MethodGet, "/projects", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var res struct {
		Projects []Project `json:"projects"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}
	if len(res.Projects) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(res.Projects))
	}
	if res.Projects[0].Name != "Project Alpha" || res.Projects[1].Name != "Project Beta" {
		t.Errorf("unexpected project names: %v", res.Projects)
	}
}

func TestListProjectsDBError(t *testing.T) {
	setupTestDB(t)

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return nil, errors.New("db query error")
	})
	defer cleanup()

	r := setupRouter()
	req := httptest.NewRequest(http.MethodGet, "/projects", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

func TestCreateProjectValidation(t *testing.T) {
	r := setupRouter()

	// Missing name
	payload := bytes.NewBufferString(`{"description":"no name"}`)
	req := httptest.NewRequest(http.MethodPost, "/projects", payload)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing name, got %d", w.Code)
	}

	// Invalid JSON
	req = httptest.NewRequest(http.MethodPost, "/projects", bytes.NewBufferString(`not json`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid JSON, got %d", w.Code)
	}
}

func TestCreateProjectSuccess(t *testing.T) {
	setupTestDB(t)
	now := time.Now()

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return &mockRows{
			columns: []string{"id", "name", "description", "owner_id", "created_at"},
			rows: [][]driver.Value{
				{int64(42), "New Project", "New Desc", int64(5), now},
			},
		}, nil
	})
	defer cleanup()

	r := setupRouter()
	payload := bytes.NewBufferString(`{"name":"New Project","description":"New Desc","owner_id":5}`)
	req := httptest.NewRequest(http.MethodPost, "/projects", payload)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body: %s", w.Code, http.StatusCreated, w.Body.String())
	}

	var p Project
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatalf("failed to decode project: %v", err)
	}
	if p.ID != 42 || p.Name != "New Project" {
		t.Errorf("unexpected project: %v", p)
	}
}

func TestCreateProjectDBError(t *testing.T) {
	setupTestDB(t)

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return nil, errors.New("db insert error")
	})
	defer cleanup()

	r := setupRouter()
	payload := bytes.NewBufferString(`{"name":"Project Fail"}`)
	req := httptest.NewRequest(http.MethodPost, "/projects", payload)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

// ---------------------------------------------------------------------------
// Task endpoints
// ---------------------------------------------------------------------------

func TestListTasksValidation(t *testing.T) {
	r := setupRouter()

	// Missing project_id
	req := httptest.NewRequest(http.MethodGet, "/tasks", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing project_id, got %d", w.Code)
	}

	// Invalid project_id
	req = httptest.NewRequest(http.MethodGet, "/tasks?project_id=invalid", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for non-numeric project_id, got %d", w.Code)
	}

	// Non-positive project_id
	req = httptest.NewRequest(http.MethodGet, "/tasks?project_id=-1", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for negative project_id, got %d", w.Code)
	}
}

func TestListTasksSuccess(t *testing.T) {
	setupTestDB(t)
	now := time.Now()
	dueDate := now.Add(24 * time.Hour)

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return &mockRows{
			columns: []string{"id", "title", "description", "project_id", "assignee_id", "status", "priority", "due_date", "created_at", "updated_at"},
			rows: [][]driver.Value{
				{int64(101), "Task One", "Desc One", int64(1), int64(2), "todo", "high", dueDate, now, now},
				{int64(102), "Task Two", "Desc Two", int64(1), nil, "done", "low", nil, now, now},
			},
		}, nil
	})
	defer cleanup()

	r := setupRouter()
	req := httptest.NewRequest(http.MethodGet, "/tasks?project_id=1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var res struct {
		Tasks  []Task `json:"tasks"`
		Source string `json:"source"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(res.Tasks) != 2 || res.Source != "database" {
		t.Errorf("unexpected tasks response: %v", res)
	}
	if res.Tasks[0].DueDate == nil || *res.Tasks[0].DueDate == "" {
		t.Errorf("expected task 1 to have formatted due_date")
	}
	if res.Tasks[1].DueDate != nil {
		t.Errorf("expected task 2 to have nil due_date")
	}
}

func TestListTasksDBError(t *testing.T) {
	setupTestDB(t)

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return nil, errors.New("db query error")
	})
	defer cleanup()

	r := setupRouter()
	req := httptest.NewRequest(http.MethodGet, "/tasks?project_id=1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

func TestCreateTaskValidation(t *testing.T) {
	r := setupRouter()

	cases := []struct {
		name string
		body string
	}{
		{"missing title", `{"project_id":1}`},
		{"missing project_id", `{"title":"Task"}`},
		{"negative project_id", `{"title":"Task","project_id":-1}`},
		{"invalid status", `{"title":"Task","project_id":1,"status":"unknown"}`},
		{"invalid priority", `{"title":"Task","project_id":1,"priority":"urgent"}`},
		{"malformed json", `not a json`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("case %q: expected 400, got %d; body: %s", tc.name, w.Code, w.Body.String())
			}
		})
	}
}

func TestCreateTaskSuccess(t *testing.T) {
	setupTestDB(t)
	now := time.Now()

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return &mockRows{
			columns: []string{"id", "title", "description", "project_id", "assignee_id", "status", "priority", "due_date", "created_at", "updated_at"},
			rows: [][]driver.Value{
				{int64(201), "New Task", "Description", int64(1), nil, "in_progress", "medium", nil, now, now},
			},
		}, nil
	})
	defer cleanup()

	r := setupRouter()
	payload := `{"title":"New Task","description":"Description","project_id":1,"status":"in_progress","priority":"medium"}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body: %s", w.Code, http.StatusCreated, w.Body.String())
	}

	var task Task
	if err := json.Unmarshal(w.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to decode task: %v", err)
	}
	if task.ID != 201 || task.Title != "New Task" {
		t.Errorf("unexpected task: %v", task)
	}
}

func TestCreateTaskDefaultStatusPriority(t *testing.T) {
	setupTestDB(t)
	now := time.Now()

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return &mockRows{
			columns: []string{"id", "title", "description", "project_id", "assignee_id", "status", "priority", "due_date", "created_at", "updated_at"},
			rows: [][]driver.Value{
				{int64(202), "Default Task", "", int64(1), nil, "todo", "medium", nil, now, now},
			},
		}, nil
	})
	defer cleanup()

	r := setupRouter()
	payload := `{"title":"Default Task","project_id":1}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestCreateTaskDBError(t *testing.T) {
	setupTestDB(t)

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return nil, errors.New("db error on insert")
	})
	defer cleanup()

	r := setupRouter()
	payload := `{"title":"Fail Task","project_id":1}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

func TestUpdateTaskValidation(t *testing.T) {
	r := setupRouter()

	cases := []struct {
		name string
		url  string
		body string
	}{
		{"invalid id non-int", "/tasks/abc", `{"status":"done"}`},
		{"invalid id zero", "/tasks/0", `{"status":"done"}`},
		{"invalid id negative", "/tasks/-5", `{"status":"done"}`},
		{"malformed json", "/tasks/1", `invalid`},
		{"no updatable fields", "/tasks/1", `{"disallowed":"field"}`},
		{"invalid status value", "/tasks/1", `{"status":"invalid_status"}`},
		{"invalid priority value", "/tasks/1", `{"priority":"super_high"}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch, tc.url, bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("case %q: expected 400, got %d; body: %s", tc.name, w.Code, w.Body.String())
			}
		})
	}
}

func TestUpdateTaskSuccess(t *testing.T) {
	setupTestDB(t)
	now := time.Now()

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		if !strings.Contains(query, "UPDATE tasks SET") {
			return nil, errors.New("expected update query")
		}
		return &mockRows{
			columns: []string{"id", "title", "description", "project_id", "assignee_id", "status", "priority", "due_date", "created_at", "updated_at"},
			rows: [][]driver.Value{
				{int64(10), "Updated Task", "Updated Desc", int64(1), nil, "done", "high", nil, now, now},
			},
		}, nil
	})
	defer cleanup()

	r := setupRouter()
	payload := `{"title":"Updated Task","description":"Updated Desc","status":"done","priority":"high"}`
	req := httptest.NewRequest(http.MethodPatch, "/tasks/10", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", w.Code, http.StatusOK, w.Body.String())
	}

	var task Task
	if err := json.Unmarshal(w.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to decode task: %v", err)
	}
	if task.Status != "done" || task.Priority != "high" {
		t.Errorf("unexpected task: %v", task)
	}
}

func TestUpdateTaskNotFound(t *testing.T) {
	setupTestDB(t)

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return &mockRows{
			columns: []string{"id", "title", "description", "project_id", "assignee_id", "status", "priority", "due_date", "created_at", "updated_at"},
			rows:    [][]driver.Value{}, // 0 rows -> ErrNoRows
		}, nil
	})
	defer cleanup()

	r := setupRouter()
	payload := `{"status":"done"}`
	req := httptest.NewRequest(http.MethodPatch, "/tasks/999", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestUpdateTaskDBError(t *testing.T) {
	setupTestDB(t)

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return nil, errors.New("db error")
	})
	defer cleanup()

	r := setupRouter()
	payload := `{"status":"done"}`
	req := httptest.NewRequest(http.MethodPatch, "/tasks/10", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

// ---------------------------------------------------------------------------
// Search endpoints
// ---------------------------------------------------------------------------

func TestSearchTasksValidation(t *testing.T) {
	r := setupRouter()

	// Missing project_id
	req := httptest.NewRequest(http.MethodGet, "/search?q=test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing project_id, got %d", w.Code)
	}

	// Negative project_id
	req = httptest.NewRequest(http.MethodGet, "/search?q=test&project_id=-2", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for negative project_id, got %d", w.Code)
	}
}

func TestSearchTasksSuccess(t *testing.T) {
	setupTestDB(t)
	now := time.Now()

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return &mockRows{
			columns: []string{"id", "title", "description", "project_id", "assignee_id", "status", "priority", "due_date", "created_at", "updated_at"},
			rows: [][]driver.Value{
				{int64(10), "Design UI", "Mockups", int64(1), nil, "todo", "high", nil, now, now},
			},
		}, nil
	})
	defer cleanup()

	r := setupRouter()
	req := httptest.NewRequest(http.MethodGet, "/search?project_id=1&q=Design", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var res struct {
		Results []Task `json:"results"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(res.Results) != 1 || res.Results[0].Title != "Design UI" {
		t.Errorf("unexpected results: %v", res)
	}
}

func TestSearchTasksDBError(t *testing.T) {
	setupTestDB(t)

	cleanup := setMockQueryHandler(func(query string, args []driver.Value) (driver.Rows, error) {
		return nil, errors.New("db search error")
	})
	defer cleanup()

	r := setupRouter()
	req := httptest.NewRequest(http.MethodGet, "/search?project_id=1&q=Design", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}
