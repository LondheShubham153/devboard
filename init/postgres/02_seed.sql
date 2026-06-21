-- Seed data so the UI has something to render on first boot.
-- Mirrors the fundamentals branch's mock store: "DevBoard MVP" (id 1) with
-- 8 tasks across statuses, plus a small second project.

INSERT INTO projects (id, name, description, owner_id) VALUES
    (1, 'DevBoard MVP',   'Ship the v1 task tracker', 1),
    (2, 'Marketing Site', 'Landing page + launch blog', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (title, description, project_id, assignee_id, status, priority, due_date) VALUES
    ('Design the task schema',     'projects, tasks, statuses',     1, 1, 'done',        'high',   '2026-05-05'),
    ('Build the kanban board',     'drag and drop columns',         1, 2, 'in_progress', 'high',   '2026-06-18'),
    ('Wire up the dashboard hero', 'velocity + chip stats',         1, 1, 'in_progress', 'medium', '2026-06-20'),
    ('Add the command bar',        'global search',                 1, 3, 'todo',        'medium', '2026-06-25'),
    ('Dark mode polish',           'grain + gradients',             1, 2, 'todo',        'low',    NULL),
    ('Fix flaky avatar colors',    'hash collision on initials',    1, 1, 'blocked',     'high',   '2026-06-15'),
    ('Write component tests',      'Vitest + testing-library',      1, 3, 'todo',        'medium', NULL),
    ('Ship the v1 release',        'tag and announce',              1, 1, 'todo',        'high',   '2026-06-30'),
    ('Draft the launch blog post', '',                              2, 2, 'in_progress', 'medium', '2026-06-22'),
    ('Hero illustration',          '',                              2, 3, 'todo',        'low',    NULL);

-- Keep the projects sequence past the explicit ids we inserted.
SELECT setval('projects_id_seq', (SELECT MAX(id) FROM projects));
