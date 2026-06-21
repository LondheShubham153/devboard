import { useLocation, useMatch, Link } from 'react-router-dom';
import { IconBell, IconChevronRight, IconCircleFilled } from '@tabler/icons-react';
import { CommandBar } from './CommandBar';
import { ProfileMenu } from './ProfileMenu';
import { ThemeToggle } from './ThemeToggle';
import { useProjects } from '../../hooks/useTasks';

/**
 * Three-zone topbar:
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  workspace › section          [⌘K  command bar]    🔔 ☀ ┃ ●AC ▾   │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * The right cluster is visually demarcated from the rest by a vertical
 * divider and a slightly different surface treatment.
 */
export function Topbar() {
  return (
    <header className="h-14 px-4 flex items-center gap-4 border-b border-ink-100/80 dark:border-white/10
                       bg-white/85 dark:bg-[#1c1c1f]/85 backdrop-blur-md sticky top-0 z-20">
      {/* LEFT: breadcrumb */}
      <div className="hidden md:flex items-center min-w-0 flex-1">
        <Breadcrumb />
      </div>

      {/* CENTER: command bar */}
      <div className="flex-[2] flex items-center justify-center">
        <CommandBar />
      </div>

      {/* RIGHT: notifications · theme · profile (clearly demarcated) */}
      <div className="flex-1 flex items-center justify-end">
        <RightCluster />
      </div>
    </header>
  );
}

function Breadcrumb() {
  const location = useLocation();
  const projectMatch = useMatch('/projects/:id/*');
  const { data } = useProjects();
  const project = data?.projects?.find((p) => String(p.id) === projectMatch?.params?.id);

  const onAI      = location.pathname.endsWith('/ai');
  const onProject = !!projectMatch;
  const onRoot    = location.pathname === '/';

  return (
    <nav className="flex items-center gap-1.5 text-[13px] min-w-0">
      <Link
        to="/"
        className="font-medium text-ink-950 dark:text-white hover:text-accent transition shrink-0"
      >
        DevBoard
      </Link>
      {onRoot && (
        <>
          <IconChevronRight size={12} stroke={2} className="text-ink-400 shrink-0" />
          <span className="text-ink-600 dark:text-ink-400 truncate">Dashboard</span>
        </>
      )}
      {onProject && (
        <>
          <IconChevronRight size={12} stroke={2} className="text-ink-400 shrink-0" />
          <Link
            to={`/projects/${projectMatch.params.id}`}
            className="text-ink-600 dark:text-ink-400 hover:text-ink-950 dark:hover:text-white transition truncate"
          >
            {project?.name || `Project ${projectMatch.params.id}`}
          </Link>
        </>
      )}
      {onAI && (
        <>
          <IconChevronRight size={12} stroke={2} className="text-ink-400 shrink-0" />
          <span className="text-ink-950 dark:text-white truncate">AI assistant</span>
        </>
      )}
    </nav>
  );
}

function RightCluster() {
  return (
    <div
      data-testid="right-cluster"
      className="flex items-center gap-0.5
                    rounded-full border border-ink-100/80 dark:border-white/10
                    bg-ink-50/60 dark:bg-white/[0.04] pl-1 pr-1 py-0.5"
    >
      <NotificationsBell />
      <ThemeToggle />
      <span aria-hidden className="mx-0.5 h-5 w-px bg-ink-100 dark:bg-white/10" />
      <ProfileMenu />
    </div>
  );
}

function NotificationsBell() {
  // Stubbed to 0 unread for now — wires up to the SSE feed when the
  // /api/notifications/stream endpoint lands.
  const unread = 0;
  return (
    <button
      type="button"
      title="Notifications"
      aria-label={`Notifications (${unread} unread)`}
      className="relative h-8 w-8 rounded-full inline-flex items-center justify-center
        text-ink-600 dark:text-ink-400
        hover:bg-ink-50 dark:hover:bg-white/5 hover:text-ink-950 dark:hover:text-white
        transition"
    >
      <IconBell size={15} stroke={1.6} />
      {unread > 0 && (
        <IconCircleFilled
          size={7}
          className="absolute top-1.5 right-1.5 text-accent"
        />
      )}
    </button>
  );
}
