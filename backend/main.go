// DevBoard backend — a minimal Go + Gin REST API over PostgreSQL.
//
// This is the "advanced" branch's backend: the same React UI as the
// fundamentals branch, but its data now comes from real HTTP endpoints
// backed by Postgres instead of an in-memory mock store. No auth, no queues,
// no tracing — just projects and tasks CRUD, kept deliberately small so the
// wiring (UI → gateway → Go → Postgres) is the whole lesson.

package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
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
	// The connection string must be injected by the environment/secret manager;
	// credentials are intentionally never compiled into the binary.
	dsn := os.Getenv("POSTGRES_URL")
	if dsn == "" {
		log.Fatal("[backend] POSTGRES_URL must be set")
	}

	var err error

	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("[backend] FATAL open db: %v", err)
	}

	db.SetMaxOpenConns(10)

	// Wait for PostgreSQL to accept connections.
	for i := 0; i < 30; i++ {
		if err = db.Ping(); err == nil {
			break
		}

		log.Printf("[backend] waiting for postgres (%d): %v", i+1, err)
		time.Sleep(2 * time.Second)
	}

	if err != nil {
		log.Fatalf("[backend] FATAL ping db: %v", err)
	}

	log.Println("[backend] connected to postgres")

	// =========================
	// Gin Router & Server
	// =========================

	r := setupRouter()

	port := env("PORT", "8080")

	log.Printf("[backend] listening on :%s", port)

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[backend] FATAL: %v", err)
	}
}

var validStatuses = map[string]bool{
	"todo":        true,
	"in_progress": true,
	"blocked":     true,
	"done":        true,
}

var validPriorities = map[string]bool{
	"low":    true,
	"medium": true,
	"high":   true,
}

func setupRouter() *gin.Engine {
	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowOriginFunc: func(origin string) bool {
			if origin == "http://localhost" || origin == "http://127.0.0.1" {
				return true
			}
			if strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:") {
				return true
			}
			if custom := os.Getenv("CORS_ORIGIN"); custom != "" && origin == custom {
				return true
			}
			return false
		},
		AllowMethods: []string{
			"GET",
			"POST",
			"PATCH",
			"PUT",
			"DELETE",
			"OPTIONS",
		},
		AllowHeaders: []string{
			"Origin",
			"Content-Type",
			"Accept",
			"Authorization",
		},
		AllowCredentials: true,
	}))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "backend",
		})
	})

	r.GET("/projects", listProjects)
	r.POST("/projects", createProject)

	r.GET("/tasks", listTasks)
	r.POST("/tasks", createTask)
	r.PATCH("/tasks/:id", updateTask)

	r.GET("/search", searchTasks)

	return r
}

// ============================================================
// PROJECTS
// ============================================================

func listProjects(c *gin.Context) {
	rows, err := db.Query(
		`SELECT id, name, COALESCE(description,''), owner_id, created_at
		 FROM projects
		 ORDER BY id`,
	)

	if err != nil {
		fail(c, err)
		return
	}

	defer rows.Close()

	projects := []Project{}

	for rows.Next() {
		var p Project
		var created time.Time

		if err := rows.Scan(
			&p.ID,
			&p.Name,
			&p.Description,
			&p.OwnerID,
			&created,
		); err != nil {
			fail(c, err)
			return
		}

		p.CreatedAt = created.Format(time.RFC3339)

		projects = append(projects, p)
	}

	if err := rows.Err(); err != nil {
		fail(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"projects": projects,
	})
}

func createProject(c *gin.Context) {
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		OwnerID     *int   `json:"owner_id"`
	}

	if err := c.ShouldBindJSON(&body); err != nil || body.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "name is required",
		})
		return
	}

	var p Project
	var created time.Time

	err := db.QueryRow(
		`INSERT INTO projects (
			name,
			description,
			owner_id
		)
		VALUES ($1, $2, $3)
		RETURNING
			id,
			name,
			COALESCE(description,''),
			owner_id,
			created_at`,
		body.Name,
		body.Description,
		body.OwnerID,
	).Scan(
		&p.ID,
		&p.Name,
		&p.Description,
		&p.OwnerID,
		&created,
	)

	if err != nil {
		fail(c, err)
		return
	}

	p.CreatedAt = created.Format(time.RFC3339)

	c.JSON(http.StatusCreated, p)
}

// ============================================================
// TASKS
// ============================================================

func listTasks(c *gin.Context) {
	projectID, err := strconv.Atoi(c.Query("project_id"))

	if err != nil || projectID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "project_id is required",
		})
		return
	}

	rows, err := db.Query(
		taskSelect+` WHERE project_id = $1 ORDER BY id`,
		projectID,
	)

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

	// No cache layer on this branch.
	c.JSON(http.StatusOK, gin.H{
		"tasks":  tasks,
		"source": "database",
	})
}

func createTask(c *gin.Context) {
	var body struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		ProjectID   int    `json:"project_id"`
		Status      string `json:"status"`
		Priority    string `json:"priority"`
	}

	if err := c.ShouldBindJSON(&body); err != nil ||
		body.Title == "" ||
		body.ProjectID <= 0 {

		c.JSON(http.StatusBadRequest, gin.H{
			"error": "title and project_id are required",
		})

		return
	}

	if body.Status == "" {
		body.Status = "todo"
	} else if !validStatuses[body.Status] {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid status",
		})
		return
	}

	if body.Priority == "" {
		body.Priority = "medium"
	} else if !validPriorities[body.Priority] {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid priority",
		})
		return
	}

	row := db.QueryRow(
		`INSERT INTO tasks (
			title,
			description,
			project_id,
			status,
			priority
		)
		VALUES ($1, $2, $3, $4, $5)`+taskReturning,
		body.Title,
		body.Description,
		body.ProjectID,
		body.Status,
		body.Priority,
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

	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid id",
		})
		return
	}

	var patch map[string]interface{}

	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid body",
		})
		return
	}

	// Whitelist fields that can be updated.
	allowed := map[string]bool{
		"title":       true,
		"description": true,
		"status":      true,
		"priority":    true,
	}

	sets := []string{}
	args := []interface{}{}

	i := 1

	for k, v := range patch {
		if !allowed[k] {
			continue
		}

		if k == "status" {
			s, ok := v.(string)
			if !ok || !validStatuses[s] {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "invalid status",
				})
				return
			}
		}

		if k == "priority" {
			p, ok := v.(string)
			if !ok || !validPriorities[p] {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "invalid priority",
				})
				return
			}
		}

		sets = append(
			sets,
			k+"=$"+strconv.Itoa(i),
		)

		args = append(args, v)

		i++
	}

	if len(sets) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "no updatable fields",
		})
		return
	}

	args = append(args, id)

	query :=
		"UPDATE tasks SET " +
			join(sets, ", ") +
			" WHERE id=$" +
			strconv.Itoa(i) +
			taskReturning

	row := db.QueryRow(
		query,
		args...,
	)

	task, err := scanTask(row)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "task not found",
		})
		return
	}

	if err != nil {
		fail(c, err)
		return
	}

	c.JSON(http.StatusOK, task)
}

// ============================================================
// SEARCH
// ============================================================

func searchTasks(c *gin.Context) {
	q := c.Query("q")

	projectID, err := strconv.Atoi(
		c.Query("project_id"),
	)

	if err != nil || projectID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "project_id is required",
		})
		return
	}

	rows, err := db.Query(
		taskSelect+
			` WHERE project_id = $1
			  AND title ILIKE '%' || $2 || '%'
			  ORDER BY id`,
		projectID,
		q,
	)

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

	c.JSON(http.StatusOK, gin.H{
		"results": tasks,
	})
}

// ============================================================
// SHARED SQL
// ============================================================

const taskSelect = `
SELECT
	id,
	title,
	COALESCE(description,''),
	project_id,
	assignee_id,
	status,
	priority,
	due_date,
	created_at,
	updated_at
FROM tasks
`

const taskReturning = `
 RETURNING
	id,
	title,
	COALESCE(description,''),
	project_id,
	assignee_id,
	status,
	priority,
	due_date,
	created_at,
	updated_at
`

// ============================================================
// DATABASE SCANNING
// ============================================================

type scannable interface {
	Scan(dest ...interface{}) error
}

func scanTask(s scannable) (Task, error) {
	var t Task

	var due sql.NullTime
	var created time.Time
	var updated time.Time

	err := s.Scan(
		&t.ID,
		&t.Title,
		&t.Description,
		&t.ProjectID,
		&t.AssigneeID,
		&t.Status,
		&t.Priority,
		&due,
		&created,
		&updated,
	)

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

// ============================================================
// HELPERS
// ============================================================

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
	log.Printf("[backend] ERROR: %v", err)

	c.JSON(http.StatusInternalServerError, gin.H{
		"error": "internal error",
	})
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}

	return fallback
}
