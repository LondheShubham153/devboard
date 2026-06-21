import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useUpdateTask } from '../../hooks/useTasks';
import { TaskCard } from './TaskCard';

// Column order: discovery → done, left to right.
// `stripe` is the 2px accent strip at the top of each column.
const COLUMNS = [
  {
    id: 'todo',
    label: 'To do',
    count: 'text-ink-600',
    stripe: 'bg-ink-100 dark:bg-white/20',
  },
  {
    id: 'in_progress',
    label: 'In progress',
    count: 'text-accent-muted',
    stripe: 'bg-accent',
  },
  {
    id: 'blocked',
    label: 'Blocked',
    count: 'text-[#A32D2D]',
    stripe: 'bg-danger',
  },
  { id: 'done', label: 'Done', count: 'text-[#3B6D11]', stripe: 'bg-success' },
];

export function KanbanBoard({ projectId, tasks }) {
  const update = useUpdateTask(projectId);
  const qc = useQueryClient();
  const [dragging, setDragging] = useState(null);
  const [hoverColumn, setHoverColumn] = useState(null);

  const grouped = useMemo(() => {
    const out = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
    for (const t of tasks) {
      // biome-ignore lint/suspicious/noAssignInExpressions: Legacy framework requirement
      const bucket = out[t.status] || (out[t.status] = []);
      bucket.push(t);
    }
    return out;
  }, [tasks]);

  function handleDragStart(task) {
    return (e) => {
      setDragging({ id: task.id, fromStatus: task.status });
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(task.id));
    };
  }

  function handleDragEnd() {
    setDragging(null);
    setHoverColumn(null);
  }

  function handleDragOver(columnId) {
    return (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (hoverColumn !== columnId) setHoverColumn(columnId);
    };
  }

  function handleDragLeave(columnId) {
    return () => {
      if (hoverColumn === columnId) setHoverColumn(null);
    };
  }

  function handleDrop(columnId) {
    return (e) => {
      e.preventDefault();
      setHoverColumn(null);
      if (!dragging || dragging.fromStatus === columnId) {
        setDragging(null);
        return;
      }
      const id = dragging.id;
      setDragging(null);

      qc.setQueryData(['tasks', projectId], (old) => {
        if (!old?.tasks) return old;
        return {
          ...old,
          tasks: old.tasks.map((t) =>
            t.id === id ? { ...t, status: columnId } : t,
          ),
        };
      });

      update.mutate(
        { id, status: columnId },
        {
          onError: () =>
            qc.invalidateQueries({ queryKey: ['tasks', projectId] }),
        },
      );
    };
  }

  return (
    <div
      data-testid="kanban-board"
      className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"
    >
      {COLUMNS.map((col) => {
        const items = grouped[col.id] || [];
        const isHover = hoverColumn === col.id;
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: Kanban column handles drag-over drops natively
          <section
            key={col.id}
            data-testid={`kanban-column-${col.id}`}
            onDragOver={handleDragOver(col.id)}
            onDragLeave={handleDragLeave(col.id)}
            onDrop={handleDrop(col.id)}
            className={`group relative flex flex-col rounded-card overflow-hidden
              border transition
              ${
                isHover
                  ? 'border-accent shadow-focus -translate-y-px'
                  : 'border-ink-100/80 dark:border-white/10'
              }
              bg-ink-50/60 dark:bg-white/[0.03]`}
          >
            {/* accent stripe */}
            <span className={`h-[2px] ${col.stripe}`} />

            <header className="px-3 pt-2.5 pb-2 flex items-center gap-2">
              <h3 className="text-[12px] font-medium uppercase tracking-[0.05em] text-ink-600 dark:text-ink-400">
                {col.label}
              </h3>
              <span
                className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-[18px]
                px-1.5 rounded-full text-[10px] font-mono font-medium
                bg-white dark:bg-white/10 ${col.count}
                border border-ink-100 dark:border-transparent`}
              >
                {items.length}
              </span>
            </header>

            <div className="flex-1 p-2 pt-0 space-y-1.5 min-h-[140px]">
              {items.length === 0 && (
                <div
                  className="mt-1 text-[11px] text-ink-400 italic px-2 py-7 text-center
                  border border-dashed border-ink-100 dark:border-white/10 rounded
                  bg-white/40 dark:bg-white/[0.02]"
                >
                  drag a task here
                </div>
              )}
              {items.map((t) => (
                <div
                  key={t.id}
                  className={
                    dragging?.id === t.id
                      ? 'opacity-40 scale-[0.98] transition'
                      : 'transition'
                  }
                >
                  <TaskCard
                    task={t}
                    draggable
                    showStatus={false}
                    onDragStart={handleDragStart(t)}
                    onDragEnd={handleDragEnd}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
