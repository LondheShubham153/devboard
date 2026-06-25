import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useCreateTask } from '../../hooks/useTasks';

export function TaskCreateModal({ projectId, open, onClose }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [status, setStatus] = useState('todo');
  const [description, setDescription] = useState('');
  const create = useCreateTask(projectId);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    await create.mutateAsync({ title, priority, status, description });
    setTitle('');
    setDescription('');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="db-card w-full max-w-md p-5 rounded-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold">New task</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-950 dark:hover:text-white">
            <IconX size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Input
            label="Title"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to ship?"
            autoFocus
          />
          <Input
            label="Description"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional context"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block mb-1 text-[12px] font-medium text-ink-600 dark:text-ink-400">Status</span>
              <select className="db-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="todo">todo</option>
                <option value="in_progress">in progress</option>
                <option value="blocked">blocked</option>
                <option value="done">done</option>
              </select>
            </label>
            <label className="block">
              <span className="block mb-1 text-[12px] font-medium text-ink-600 dark:text-ink-400">Priority</span>
              <select className="db-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
          </div>
          {create.error && (
            <p className="text-[12px] text-danger">{create.error.message}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create task'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
