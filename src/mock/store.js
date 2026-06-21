// In-memory mock data store for the fundamentals (UI-only) build.
//
// There is no backend on this branch — the whole point is to run the UI
// standalone with `npm run dev`. These functions stand in for the REST API
// the `advanced` branch wires up against a Go + Postgres backend. They return
// Promises so the React Query hooks read exactly like real network calls; the
// only difference is the data lives in module-level arrays instead of a DB.

let nextId = 100;

const projects = [
  {
    id: 1,
    name: 'DevBoard MVP',
    description: 'Ship the v1 task tracker',
    owner_id: 1,
    created_at: '2026-05-01T09:00:00Z',
  },
  {
    id: 2,
    name: 'Marketing Site',
    description: 'Landing page + launch blog',
    owner_id: 1,
    created_at: '2026-05-10T09:00:00Z',
  },
];

let tasks = [
  {
    id: 1,
    project_id: 1,
    title: 'Design the task schema',
    description: 'projects, tasks, statuses',
    status: 'done',
    priority: 'high',
    assignee_id: 1,
    due_date: '2026-05-05',
  },
  {
    id: 2,
    project_id: 1,
    title: 'Build the kanban board',
    description: 'drag and drop columns',
    status: 'in_progress',
    priority: 'high',
    assignee_id: 2,
    due_date: '2026-06-18',
  },
  {
    id: 3,
    project_id: 1,
    title: 'Wire up the dashboard hero',
    description: 'velocity + chip stats',
    status: 'in_progress',
    priority: 'medium',
    assignee_id: 1,
    due_date: '2026-06-20',
  },
  {
    id: 4,
    project_id: 1,
    title: 'Add the command bar (⌘K)',
    description: 'global search',
    status: 'todo',
    priority: 'medium',
    assignee_id: 3,
    due_date: '2026-06-25',
  },
  {
    id: 5,
    project_id: 1,
    title: 'Dark mode polish',
    description: 'grain + gradients',
    status: 'todo',
    priority: 'low',
    assignee_id: 2,
    due_date: null,
  },
  {
    id: 6,
    project_id: 1,
    title: 'Fix flaky avatar colors',
    description: 'hash collision on initials',
    status: 'blocked',
    priority: 'high',
    assignee_id: 1,
    due_date: '2026-06-15',
  },
  {
    id: 7,
    project_id: 1,
    title: 'Write component tests',
    description: 'Vitest + testing-library',
    status: 'todo',
    priority: 'medium',
    assignee_id: 3,
    due_date: null,
  },
  {
    id: 8,
    project_id: 1,
    title: 'Ship the v1 release',
    description: 'tag and announce',
    status: 'todo',
    priority: 'high',
    assignee_id: 1,
    due_date: '2026-06-30',
  },
  {
    id: 9,
    project_id: 2,
    title: 'Draft the launch blog post',
    description: '',
    status: 'in_progress',
    priority: 'medium',
    assignee_id: 2,
    due_date: '2026-06-22',
  },
  {
    id: 10,
    project_id: 2,
    title: 'Hero illustration',
    description: '',
    status: 'todo',
    priority: 'low',
    assignee_id: 3,
    due_date: null,
  },
];

// Small artificial latency so loading states are visible, like a real fetch.
const delay = (value, ms = 120) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export function listProjects() {
  return delay({ projects: [...projects] });
}

export function listTasks(projectId) {
  const pid = Number(projectId);
  // `source` mirrors the real API's cache/database teaching badge.
  return delay({
    tasks: tasks.filter((t) => t.project_id === pid),
    source: 'mock',
  });
}

export function createTask(body) {
  const task = {
    id: ++nextId,
    project_id: Number(body.project_id),
    title: body.title,
    description: body.description || '',
    status: body.status || 'todo',
    priority: body.priority || 'medium',
    assignee_id: null,
    due_date: null,
  };
  tasks = [...tasks, task];
  return delay(task);
}

export function updateTask(id, patch) {
  const tid = Number(id);
  tasks = tasks.map((t) => (t.id === tid ? { ...t, ...patch } : t));
  return delay(tasks.find((t) => t.id === tid));
}

export function searchTasks(query, projectId) {
  const q = query.trim().toLowerCase();
  const pid = Number(projectId);
  const results = tasks
    .filter((t) => t.project_id === pid && t.title.toLowerCase().includes(q))
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
    }));
  return delay({ results });
}
