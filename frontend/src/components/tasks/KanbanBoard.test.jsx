/**
 * Kanban behaviour tests. We cover:
 *   - tasks bucket into the right columns by status
 *   - dragging from column A and dropping on column B fires a PATCH with the new status
 *   - dropping back into the source column is a no-op (no PATCH)
 *   - the optimistic cache update repositions the card before the server replies
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KanbanBoard } from './KanbanBoard';

// useUpdateTask wraps a useMutation — we replace it with a spy that records
// each call.  The board doesn't need the real network for these assertions.
const mutateSpy = vi.fn();
vi.mock('../../hooks/useTasks', () => ({
  useUpdateTask: () => ({ mutate: mutateSpy, isPending: false }),
}));

const TASKS = [
  { id: 1, title: 'Wire TLS',     status: 'done',        priority: 'high'   },
  { id: 2, title: 'JWT auth',     status: 'done',        priority: 'high'   },
  { id: 3, title: 'Cache aside',  status: 'in_progress', priority: 'medium' },
  { id: 4, title: 'gRPC search',  status: 'blocked',     priority: 'medium' },
  { id: 5, title: 'AI streaming', status: 'todo',        priority: 'high'   },
];

function setup(tasks = TASKS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['tasks', 1], { tasks, source: 'database' });
  const utils = render(
    <QueryClientProvider client={qc}>
      <KanbanBoard projectId={1} tasks={tasks} />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

beforeEach(() => {
  mutateSpy.mockReset();
});

describe('KanbanBoard', () => {
  it('renders four status columns', () => {
    setup();
    expect(screen.getByTestId('kanban-column-todo')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-in_progress')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-column-done')).toBeInTheDocument();
  });

  it('buckets tasks into the correct column', () => {
    setup();
    const done = screen.getByTestId('kanban-column-done');
    expect(done).toHaveTextContent('Wire TLS');
    expect(done).toHaveTextContent('JWT auth');

    const blocked = screen.getByTestId('kanban-column-blocked');
    expect(blocked).toHaveTextContent('gRPC search');

    const todo = screen.getByTestId('kanban-column-todo');
    expect(todo).toHaveTextContent('AI streaming');
  });

  it('shows the per-column count', () => {
    setup();
    // "done" has 2 items
    const done = screen.getByTestId('kanban-column-done');
    expect(done.querySelector('header')).toHaveTextContent('2');
    // "in_progress" has 1
    const ip = screen.getByTestId('kanban-column-in_progress');
    expect(ip.querySelector('header')).toHaveTextContent('1');
  });

  it('shows an empty-state hint when a column has no tasks', () => {
    setup(TASKS.filter((t) => t.status !== 'blocked'));
    const blocked = screen.getByTestId('kanban-column-blocked');
    expect(blocked).toHaveTextContent('drag a task here');
  });

  it('PATCHes the task with the new status when dropped into another column', () => {
    setup();

    const card = screen.getByTestId('task-card-5'); // todo: AI streaming
    const donCol = screen.getByTestId('kanban-column-done');

    // jsdom needs a stubbed DataTransfer.
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: () => '5',
    };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(donCol,  { dataTransfer });
    fireEvent.drop(donCol,      { dataTransfer });
    fireEvent.dragEnd(card,     { dataTransfer });

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    const [payload] = mutateSpy.mock.calls[0];
    expect(payload).toEqual({ id: 5, status: 'done' });
  });

  it('does NOT issue a PATCH when dropped on its source column', () => {
    setup();
    const card = screen.getByTestId('task-card-5'); // already in todo
    const todoCol = screen.getByTestId('kanban-column-todo');

    const dataTransfer = {
      effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: () => '5',
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(todoCol,   { dataTransfer });

    expect(mutateSpy).not.toHaveBeenCalled();
  });

  it('optimistically updates the cached task list on drop', () => {
    const { qc } = setup();

    const card = screen.getByTestId('task-card-4'); // blocked: gRPC search
    const inProgCol = screen.getByTestId('kanban-column-in_progress');
    const dataTransfer = {
      effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: () => '4',
    };

    fireEvent.dragStart(card,    { dataTransfer });
    fireEvent.dragOver(inProgCol,{ dataTransfer });
    fireEvent.drop(inProgCol,    { dataTransfer });

    const cached = qc.getQueryData(['tasks', 1]);
    const moved = cached.tasks.find((t) => t.id === 4);
    expect(moved.status).toBe('in_progress');
  });
});
