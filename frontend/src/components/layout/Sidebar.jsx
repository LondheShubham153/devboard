import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  IconLayoutDashboard, IconCheck, IconChartBar, IconBell,
  IconSettings, IconChevronRight, IconFolder,
} from '@tabler/icons-react';
import { Logo } from '../ui/Logo';
import { useProjects } from '../../hooks/useTasks';

const NAV = [
  { to: '/',           label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/projects/1', label: 'Tasks',     icon: IconCheck },
];

const SOON = [
  { label: 'Analytics',     icon: IconChartBar },
  { label: 'Notifications', icon: IconBell },
  { label: 'Settings',      icon: IconSettings },
];

export function Sidebar() {
  const { data } = useProjects();
  const projects = data?.projects || [];
  const syncedAt = useMemo(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), [data]);

  return (
    <aside className="w-[228px] shrink-0 border-r border-ink-100 dark:border-white/10
                      bg-white dark:bg-[#1c1c1f] flex flex-col">
      <div className="h-14 flex items-center px-4 border-b border-ink-100 dark:border-white/10">
        <Logo compact />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5 text-[13px]">
        <Section label="Workspace">
          {NAV.map((item) => <SidebarItem key={item.to} {...item} />)}
        </Section>

        <Section label="Projects" count={projects.length}>
          {projects.map((p) => (
            <SidebarItem
              key={p.id}
              to={`/projects/${p.id}`}
              icon={IconFolder}
              label={p.name}
              compact
            />
          ))}
          {projects.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-ink-400 italic">No projects yet</div>
          )}
        </Section>

        <Section label="Coming soon">
          {SOON.map((s) => (
            <div
              key={s.label}
              className="h-8 px-3 flex items-center gap-2 rounded text-ink-400 dark:text-ink-400/70
                select-none cursor-not-allowed"
            >
              <s.icon size={15} stroke={1.6} className="opacity-60" />
              <span className="text-[13px]">{s.label}</span>
              <span className="ml-auto text-[9px] uppercase tracking-wider font-medium px-1.5 h-[15px]
                inline-flex items-center rounded
                bg-ink-50 dark:bg-white/5 text-ink-400">
                soon
              </span>
            </div>
          ))}
        </Section>
      </nav>

      <div className="px-3 py-2.5 border-t border-ink-100 dark:border-white/10
        flex items-center justify-between text-[10px] font-mono text-ink-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
          synced {syncedAt}
        </span>
        <span>v1.0.0</span>
      </div>
    </aside>
  );
}

function Section({ label, count, children }) {
  return (
    <div className="space-y-0.5">
      <div className="px-3 mb-1.5 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.08em] font-medium text-ink-400">
          {label}
        </span>
        {typeof count === 'number' && (
          <span className="font-mono text-[10px] text-ink-400">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function SidebarItem({ to, label, icon: Icon, accent, compact }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `relative group h-8 px-3 flex items-center gap-2 rounded transition
        ${isActive
          ? 'bg-accent-subtle dark:bg-accent/15 text-accent-strong dark:text-white font-medium'
          : 'text-ink-950 dark:text-ink-100 hover:bg-ink-50 dark:hover:bg-white/5'}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-accent"
            />
          )}
          <Icon
            size={15}
            stroke={1.6}
            className={isActive ? 'text-accent dark:text-accent' : (accent ? 'text-accent' : '')}
          />
          <span className={`flex-1 min-w-0 truncate ${compact ? 'text-[12.5px]' : ''}`}>
            {label}
          </span>
          {isActive && (
            <IconChevronRight size={12} stroke={2} className="text-accent opacity-70" />
          )}
        </>
      )}
    </NavLink>
  );
}
