-- DevBoard (advanced branch) — minimal schema: projects + tasks only.
-- No users table: this branch has no auth. assignee_id is just an int label.

CREATE TABLE IF NOT EXISTS projects (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    owner_id    INTEGER,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(300) NOT NULL,
    description TEXT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assignee_id INTEGER,
    status      VARCHAR(20) NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo','in_progress','blocked','done')),
    priority    VARCHAR(10) NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low','medium','high')),
    due_date    DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);

-- Auto-update updated_at on row modifications.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_touch_updated_at ON tasks;
CREATE TRIGGER tasks_touch_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION touch_updated_at();
