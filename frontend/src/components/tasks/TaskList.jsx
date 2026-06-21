import { TaskCard } from './TaskCard';

export function TaskList({ tasks = [] }) {
  if (!tasks.length) {
    return (
      <div className="db-card px-4 py-10 text-center text-ink-400 text-[13px]">
        No tasks yet. Create one to get started.
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} />
      ))}
    </div>
  );
}
