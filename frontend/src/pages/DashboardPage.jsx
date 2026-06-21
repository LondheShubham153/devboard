import { Link } from 'react-router-dom';
import {
  IconArrowRight, IconCircleCheck, IconAlertCircle, IconClock, IconCheck,
  IconActivity,
} from '@tabler/icons-react';
import { useProjects, useTasks } from '../hooks/useTasks';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/Badge';

export function DashboardPage() {
  const { data: projData } = useProjects();
  const projects = projData?.projects || [];
  const firstId = projects[0]?.id;
  const { data: taskData } = useTasks(firstId);
  const tasks = taskData?.tasks || [];

  const counts = tasks.reduce(
    (acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; },
    {},
  );
  const done = counts.done || 0;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="relative max-w-6xl mx-auto px-6 py-8 space-y-7">
      {/* page header */}
      <header className="flex items-end justify-between gap-4 db-rise">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-400">
              workspace overview
            </span>
          </div>
          <h1 className="text-[30px] font-semibold leading-none tracking-[-0.6px]">Good to see you, Shubham.</h1>
          <p className="text-[14px] text-ink-600 dark:text-ink-400 mt-2">
            Here's where your work stands today.
          </p>
        </div>
        {firstId && (
          <Link to={`/projects/${firstId}`}>
            <Button variant="secondary">
              View project <IconArrowRight size={14} />
            </Button>
          </Link>
        )}
      </header>

      {/* hero progress strip + chip stats */}
      <section className="db-rise db-rise-1 grid gap-3 lg:grid-cols-[2fr_3fr]">
        <HeroProgress done={done} total={total} pct={pct} />
        <div className="grid grid-cols-3 gap-3">
          <ChipStat label="In progress"  value={counts.in_progress || 0} icon={IconClock}        tone="accent"  />
          <ChipStat label="Blocked"      value={counts.blocked || 0}     icon={IconAlertCircle}  tone="danger"  />
          <ChipStat label="To do"        value={counts.todo || 0}        icon={IconCheck}        tone="neutral" />
        </div>
      </section>

      <section className="db-rise db-rise-2 grid lg:grid-cols-5 gap-3">
        <ProjectsPanel projects={projects} className="lg:col-span-2" />
        <RecentTasksPanel tasks={tasks} className="lg:col-span-3" />
      </section>
    </div>
  );
}

function HeroProgress({ done, total, pct }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-ink-100/80 dark:border-white/10
      bg-white dark:bg-[#1c1c1f] p-5">
      {/* radial accent in the corner */}
      <div
        aria-hidden
        className="absolute -top-12 -right-10 h-44 w-44 rounded-full
                   bg-[radial-gradient(closest-side,rgba(127,119,221,0.18),transparent_70%)]"
      />
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] font-medium text-ink-400">
        <IconActivity size={12} stroke={2} /> Project velocity
      </div>
      <div className="mt-3 flex items-baseline gap-2.5">
        <span className="text-[44px] font-semibold leading-none tracking-[-1px]">{done}</span>
        <span className="text-[20px] text-ink-400 font-medium">/ {total}</span>
        <span className="ml-2 db-chip bg-success-bg text-[#3B6D11]">
          <IconCircleCheck size={11} stroke={2} /> {pct}%
        </span>
      </div>
      <p className="mt-1 text-[13px] text-ink-600 dark:text-ink-400">
        tasks completed in <span className="font-mono">DevBoard MVP</span>
      </p>

      {/* progress bar */}
      <div className="mt-4 h-1.5 w-full rounded-full bg-ink-100 dark:bg-white/10 overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ChipStat({ label, value, icon: Icon, tone }) {
  const tones = {
    accent:  { bg: 'bg-accent-subtle dark:bg-accent/15', fg: 'text-accent-muted dark:text-accent' },
    danger:  { bg: 'bg-danger-bg',  fg: 'text-[#A32D2D]' },
    neutral: { bg: 'bg-ink-50 dark:bg-white/10', fg: 'text-ink-600 dark:text-ink-400' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div className="db-card rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={`h-7 w-7 rounded inline-flex items-center justify-center ${t.bg} ${t.fg}`}>
          <Icon size={14} stroke={1.7} />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
          {label}
        </span>
      </div>
      <div className="text-[28px] font-semibold leading-none tracking-[-0.4px]">{value}</div>
    </div>
  );
}

function ProjectsPanel({ projects, className = '' }) {
  return (
    <div className={`db-card rounded-lg overflow-hidden ${className}`}>
      <PanelHeader title="Projects" hint={`${projects.length} active`} />
      <ul className="divide-y divide-ink-100 dark:divide-white/10">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              to={`/projects/${p.id}`}
              className="block px-4 py-3 hover:bg-ink-50 dark:hover:bg-white/5 transition group"
            >
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[11px] text-ink-400 shrink-0">#{p.id}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{p.name}</div>
                  <div className="text-[12px] text-ink-400 truncate">{p.description}</div>
                </div>
                <IconArrowRight
                  size={14}
                  stroke={1.7}
                  className="text-ink-400 opacity-0 group-hover:opacity-100 transition shrink-0"
                />
              </div>
            </Link>
          </li>
        ))}
        {!projects.length && (
          <li className="px-4 py-8 text-center text-ink-400 text-[12px]">No projects yet.</li>
        )}
      </ul>
    </div>
  );
}

function RecentTasksPanel({ tasks, className = '' }) {
  return (
    <div className={`db-card rounded-lg overflow-hidden ${className}`}>
      <PanelHeader title="Recent tasks" hint={`${tasks.length} total`} />
      <ul className="divide-y divide-ink-100 dark:divide-white/10">
        {tasks.slice(0, 6).map((t) => (
          <li key={t.id} className="px-4 py-3 flex items-center gap-3 hover:bg-ink-50 dark:hover:bg-white/5 transition">
            <span className="font-mono text-[11px] text-ink-400 w-8">#{t.id}</span>
            <span className="flex-1 min-w-0 text-[13px] truncate">{t.title}</span>
            <StatusBadge status={t.status} />
          </li>
        ))}
        {!tasks.length && (
          <li className="px-4 py-8 text-center text-ink-400 text-[12px]">No tasks yet.</li>
        )}
      </ul>
    </div>
  );
}

function PanelHeader({ title, hint }) {
  return (
    <header className="px-4 py-3 flex items-center justify-between border-b border-ink-100 dark:border-white/10">
      <h2 className="text-[13px] font-medium">{title}</h2>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-400">{hint}</span>
    </header>
  );
}
