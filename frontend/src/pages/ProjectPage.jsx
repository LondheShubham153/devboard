import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  IconPlus, IconDatabase, IconBolt,
  IconLayoutKanban, IconList,
} from '@tabler/icons-react';
import { useTasks } from '../hooks/useTasks';
import { Button } from '../components/ui/Button';
import { TaskList } from '../components/tasks/TaskList';
import { TaskCreateModal } from '../components/tasks/TaskCreateModal';
import { KanbanBoard } from '../components/tasks/KanbanBoard';

const STATUSES = ['all', 'todo', 'in_progress', 'blocked', 'done'];
const VIEW_KEY = 'devboard.view';

export function ProjectPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const { data, isLoading } = useTasks(projectId);
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(false);
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'board');

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const allTasks = data?.tasks || [];
  const tasks = view === 'list'
    ? allTasks.filter((t) => filter === 'all' ? true : t.status === filter)
    : allTasks;
  const source = data?.source;

  return (
    <div className="max-w-6xl mx-auto px-6 py-7 space-y-5">
      {/* page header */}
      <header className="db-rise flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-400">
              project · #{projectId}
            </span>
            {source && <SourceBadge source={source} />}
          </div>
          <h1 className="text-[26px] font-semibold leading-none tracking-[-0.5px]">
            DevBoard MVP
          </h1>
          <p className="text-[13.5px] text-ink-600 dark:text-ink-400 mt-1.5">
            {allTasks.length} tasks · ship the v1
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setModal(true)}>
            <IconPlus size={14} /> New task
          </Button>
        </div>
      </header>

      {/* sub-toolbar */}
      <div className="db-rise db-rise-1 flex items-center justify-between gap-3 flex-wrap">
        {view === 'list' ? (
          <nav className="flex items-center gap-1 text-[12px]">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-2.5 h-7 rounded transition font-medium
                  ${filter === s
                    ? 'bg-accent text-white'
                    : 'text-ink-600 dark:text-ink-400 hover:bg-ink-50 dark:hover:bg-white/5'}`}
              >
                {s === 'in_progress' ? 'in progress' : s}
              </button>
            ))}
          </nav>
        ) : <div />}

        <SegmentedToggle
          value={view}
          onChange={setView}
          options={[
            { v: 'board', label: 'Board', icon: IconLayoutKanban },
            { v: 'list',  label: 'List',  icon: IconList },
          ]}
        />
      </div>

      {/* content */}
      <div className="db-rise db-rise-2">
        {isLoading ? (
          <div className="db-card p-6 text-center text-ink-400 text-[13px]">Loading…</div>
        ) : view === 'board' ? (
          <KanbanBoard projectId={projectId} tasks={tasks} />
        ) : (
          <TaskList tasks={tasks} />
        )}
      </div>

      <TaskCreateModal projectId={projectId} open={modal} onClose={() => setModal(false)} />
    </div>
  );
}

function SourceBadge({ source }) {
  const isCache = source === 'cache';
  return (
    <span
      title="Where this task list came from on the last fetch"
      className={`db-chip font-mono
        ${isCache
          ? 'bg-accent-subtle dark:bg-accent/15 text-accent-muted dark:text-accent'
          : 'bg-success-bg text-[#3B6D11]'}`}
    >
      {isCache ? <IconBolt size={11} stroke={2} /> : <IconDatabase size={11} stroke={2} />}
      source: {source}
    </span>
  );
}

function SegmentedToggle({ value, onChange, options }) {
  return (
    <div
      role="tablist"
      aria-label="View"
      data-testid="view-toggle"
      className="inline-flex p-0.5 rounded-card border border-ink-100/80 dark:border-white/10
                 bg-ink-50/60 dark:bg-white/[0.04]"
    >
      {options.map((opt) => {
        const active = value === opt.v;
        return (
          <button
            key={opt.v}
            role="tab"
            aria-selected={active}
            data-testid={`view-toggle-${opt.v}`}
            onClick={() => onChange(opt.v)}
            className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded text-[12px] font-medium transition
              ${active
                ? 'bg-white dark:bg-[#1c1c1f] text-ink-950 dark:text-white shadow-[0_1px_0_0_rgba(0,0,0,0.04)]'
                : 'text-ink-600 dark:text-ink-400 hover:text-ink-950 dark:hover:text-white'}`}
          >
            <opt.icon size={13} stroke={1.7} /> {opt.label}
          </button>
        );
      })}
    </div>
  );
}
