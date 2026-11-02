// DevBoard backend — a minimal Go + Gin REST API over PostgreSQL.
//
// This is the "advanced" branch's backend: the same React UI as the
// fundamentals branch, but its data now comes from real HTTP endpoints
// backed by Postgres instead of an in-memory mock store. No auth and no
// queues — just projects and tasks CRUD, kept deliberately small so the
// wiring (UI → gateway → Go → Postgres) is the whole lesson.
//
// It IS traced, as of the mega-project branch: see tracing.go, and note that
// every handler passes c.Request.Context() into its query. That is not
// ceremony — a span with no parent context floats free of its trace, which is
// precisely why Go APIs take a context as their first argument.
package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/XSAM/otelsql"
	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

var db *sql.DB

// Task mirrors the JSON shape the React UI expects.
type Task struct {
	ID          int     `json:"id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	ProjectID   int     `json:"project_id"`
	AssigneeID  *int    `json:"assignee_id"`
	Status      string  `json:"status"`
	Priority    string  `json:"priority"`
	DueDate     *string `json:"due_date"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

type Project struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	OwnerID     *int   `json:"owner_id"`
	CreatedAt   string `json:"created_at"`
}

func main() {
	// Start tracing before anything else, so the DB connection and every
	// request that follows are covered. See tracing.go.
	shutdownTracing := initTracing(context.Background())
	defer shutdownTracing()

	dsn := env("POSTGRES_URL", "postgres://devboard:devboard@localhost:5432/devboard?sslmode=disable")

	var err error
	// otelsql.Open instead of sql.Open: it wraps the driver so every query
	// becomes a child span carrying the SQL statement. This is how "the API is
	// slow" turns into "this one SELECT is slow" without adding a single line
	// of timing code to any handler.
	db, err = otelsql.Open("postgres", dsn,
		otelsql.WithAttributes(semconv.DBSystemPostgreSQL),
	)
	if err != nil {
		log.Fatalf("[backend] FATAL open db: %v", err)
	}
	db.SetMaxOpenConns(10)

	// Wait for Postgres to accept connections (compose start ordering).
	for i := 0; i < 30; i++ {
		if err = db.Ping(); err == nil {
			break
		}
		log.Printf("[backend] waiting for postgres (%d)…", i+1)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("[backend] FATAL ping db: %v", err)
	}
	log.Println("[backend] connected to postgres")

	r := gin.Default()

	// Reads the incoming traceparent header, starts a server span as its
	// child, and puts that span in c.Request.Context(). Everything downstream
	// — including the otelsql spans above — hangs off it, which is why the
	// handlers below pass c.Request.Context() into every query.
	r.Use(otelgin.Middleware("devboard-backend"))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "backend"})
	})

	r.GET("/projects", listProjects)
	r.POST("/projects", createProject)
	r.GET("/tasks", listTasks)
	r.POST("/tasks", createTask)
	r.PATCH("/tasks/:id", updateTask)
	r.GET("/search", searchTasks)

	port := env("PORT", "8080")
	log.Printf("[backend] listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[backend] FATAL: %v", err)
	}
}

func listProjects(c *gin.Context) {
	rows, err := db.QueryContext(c.Request.Context(),
		`SELECT id, name, COALESCE(description,''), owner_id, created_at
		   FROM projects ORDER BY id`)
	if err != nil {
		fail(c, err)
		return
	}
	defer rows.Close()

	projects := []Project{}
	for rows.Next() {
		var p Project
		var created time.Time
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &created); err != nil {
			fail(c, err)
			return
		}
		p.CreatedAt = created.Format(time.RFC3339)
		projects = append(projects, p)
	}
	c.JSON(http.StatusOK, gin.H{"projects": projects})
}

func createProject(c *gin.Context) {
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		OwnerID     *int   `json:"owner_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	var p Project
	var created time.Time
	err := db.QueryRowContext(c.Request.Context(),
		`INSERT INTO projects (name, description, owner_id)
		 VALUES ($1, $2, $3)
		 RETURNING id, name, COALESCE(description,''), owner_id, created_at`,
		body.Name, body.Description, body.OwnerID,
	).Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &created)
	if err != nil {
		fail(c, err)
		return
	}
	p.CreatedAt = created.Format(time.RFC3339)
	c.JSON(http.StatusCreated, p)
}

func listTasks(c *gin.Context) {
	projectID, err := strconv.Atoi(c.Query("project_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_id is required"})
		return
	}
	rows, err := db.QueryContext(c.Request.Context(), taskSelect+` WHERE project_id = $1 ORDER BY id`, projectID)
	if err != nil {
		fail(c, err)
		return
	}
	defer rows.Close()

	tasks, err := scanTasks(rows)
	if err != nil {
		fail(c, err)
		return
	}
	// `source` mirrors the cache/database teaching badge in the UI. There is no
	// cache layer on this branch, so it always reports "database".
	c.JSON(http.StatusOK, gin.H{"tasks": tasks, "source": "database"})
}

func createTask(c *gin.Context) {
	var body struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		ProjectID   int    `json:"project_id"`
		Status      string `json:"status"`
		Priority    string `json:"priority"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Title == "" || body.ProjectID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title and project_id are required"})
		return
	}
	if body.Status == "" {
		body.Status = "todo"
	}
	if body.Priority == "" {
		body.Priority = "medium"
	}
	row := db.QueryRowContext(c.Request.Context(),
		`INSERT INTO tasks (title, description, project_id, status, priority)
		 VALUES ($1, $2, $3, $4, $5)`+taskReturning,
		body.Title, body.Description, body.ProjectID, body.Status, body.Priority,
	)
	task, err := scanTask(row)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, task)
}

func updateTask(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var patch map[string]interface{}
	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	// Whitelist the columns a PATCH may touch — never trust raw keys in SQL.
	allowed := map[string]bool{
		"title": true, "description": true, "status": true, "priority": true,
	}
	sets := []string{}
	args := []interface{}{}
	i := 1
	for k, v := range patch {
		if !allowed[k] {
			continue
		}
		sets = append(sets, k+"=$"+strconv.Itoa(i))
		args = append(args, v)
		i++
	}
	if len(sets) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no updatable fields"})
		return
	}
	args = append(args, id)

	query := "UPDATE tasks SET " + join(sets, ", ") +
		" WHERE id=$" + strconv.Itoa(i) + taskReturning
	row := db.QueryRowContext(c.Request.Context(), query, args...)
	task, err := scanTask(row)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, task)
}

func searchTasks(c *gin.Context) {
	q := c.Query("q")
	projectID, err := strconv.Atoi(c.Query("project_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_id is required"})
		return
	}
	rows, err := db.QueryContext(c.Request.Context(),
		taskSelect+` WHERE project_id = $1 AND title ILIKE '%' || $2 || '%' ORDER BY id`,
		projectID, q)
	if err != nil {
		fail(c, err)
		return
	}
	defer rows.Close()

	tasks, err := scanTasks(rows)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"results": tasks})
}

// --- shared SQL + scanning helpers ---

const taskSelect = `SELECT id, title, COALESCE(description,''), project_id, assignee_id,
	status, priority, due_date, created_at, updated_at FROM tasks`

const taskReturning = ` RETURNING id, title, COALESCE(description,''), project_id, assignee_id,
	status, priority, due_date, created_at, updated_at`

type scannable interface {
	Scan(dest ...interface{}) error
}

func scanTask(s scannable) (Task, error) {
	var t Task
	var due sql.NullTime
	var created, updated time.Time
	err := s.Scan(&t.ID, &t.Title, &t.Description, &t.ProjectID, &t.AssigneeID,
		&t.Status, &t.Priority, &due, &created, &updated)
	if err != nil {
		return t, err
	}
	if due.Valid {
		s := due.Time.Format("2006-01-02")
		t.DueDate = &s
	}
	t.CreatedAt = created.Format(time.RFC3339)
	t.UpdatedAt = updated.Format(time.RFC3339)
	return t, nil
}

func scanTasks(rows *sql.Rows) ([]Task, error) {
	tasks := []Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

func join(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}

func fail(c *gin.Context, err error) {
	// Stamp the trace ID onto the error log. This one string is what turns
	// "an error happened somewhere" into "click here to see the exact request,
	// with every span and every SQL statement that led to it" — Grafana's Loki
	// datasource regexes trace_id=... out of the line and offers a link
	// straight into Tempo (see gitops/observability/grafana-values.yaml).
	//
	// Note ai-service gets this for free: it ships logs over OTLP, so the
	// trace ID travels as a structured field and needs no regex. Doing it by
	// hand here is the honest cost of a language with no auto-instrumentation.
	sc := trace.SpanFromContext(c.Request.Context()).SpanContext()
	log.Printf("[backend] ERROR trace_id=%s: %v", sc.TraceID(), err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
