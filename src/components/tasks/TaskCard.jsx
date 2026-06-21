import { IconClock, IconGripVertical, IconUser } from '@tabler/icons-react';
import { Avatar } from '../ui/Avatar';
import { PriorityBadge, StatusBadge } from '../ui/Badge';

export function TaskCard({
  task,
  assigneeName = '',
  draggable = false,
  showStatus = true,
  onDragStart,
  onDragEnd,
  onClick,
}) {
  const due = task.due_date
    ? new Date(task.due_date).toLocaleDateString()
    : null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Task cards are handled via drag-and-drop workflow
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      data-testid={`task-card-${task.id}`}
      className={`db-card px-4 py-3.5 hover:border-accent/40 transition group ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
    >
      <div className="flex items-center gap-2">
        {draggable && (
          <IconGripVertical
            size={14}
            stroke={1.6}
            className="text-ink-400 opacity-0 group-hover:opacity-100 transition shrink-0"
          />
        )}
        <span className="font-mono text-[11px] text-ink-400">#{task.id}</span>
        <h3 className="text-[14px] font-medium flex-1 min-w-0 truncate">
          {task.title}
        </h3>
        {showStatus && <StatusBadge status={task.status} />}
        {assigneeName && <Avatar name={assigneeName} size={22} />}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[12px] text-ink-600 dark:text-ink-400">
        <PriorityBadge priority={task.priority} />
        {due && (
          <span className="inline-flex items-center gap-1 font-mono">
            <IconClock size={12} stroke={1.6} /> {due}
          </span>
        )}
        {task.assignee_id && (
          <span className="inline-flex items-center gap-1 font-mono">
            <IconUser size={12} stroke={1.6} /> uid:{task.assignee_id}
          </span>
        )}
      </div>
    </article>
  );
}
