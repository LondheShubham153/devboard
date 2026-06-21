import { useEffect, useRef, useState } from 'react';
import {
  IconChevronDown, IconLogout, IconUserCircle, IconSettings,
  IconKeyboard, IconExternalLink,
} from '@tabler/icons-react';
import { Avatar } from '../ui/Avatar';

// No auth on the fundamentals branch — the profile shows a static demo user.
const DEMO_USER = { name: 'Alice Dev', email: 'alice@devboard.local' };

/**
 * Right-cluster profile dropdown.
 *
 * Click the avatar → a menu opens anchored to the right edge of the button.
 * The button itself shows just the avatar + chevron (no inline name/email);
 * those move into the menu header so the topbar stays quiet.
 */
export function ProfileMenu() {
  const user = DEMO_USER;
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="profile-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`h-8 inline-flex items-center gap-1.5 pl-0.5 pr-1.5 rounded-full transition
          ${open
            ? 'bg-ink-50 dark:bg-white/10'
            : 'hover:bg-ink-50 dark:hover:bg-white/5'}`}
      >
        <span className="relative">
          <Avatar name={user.name} size={26} />
          {/* online dot */}
          <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-white dark:ring-[#1c1c1f]" />
        </span>
        <IconChevronDown
          size={13}
          stroke={1.8}
          className={`text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="profile-menu"
          className="absolute right-0 top-full mt-1.5 w-64 z-40
            rounded-card border border-ink-100 dark:border-white/10
            bg-white dark:bg-[#1c1c1f]
            shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_10px_40px_-12px_rgba(0,0,0,0.6)]
            overflow-hidden"
        >
          {/* signed-in header */}
          <div className="px-3 py-3 flex items-center gap-2.5 border-b border-ink-100 dark:border-white/10">
            <Avatar name={user.name} size={32} />
            <div className="min-w-0">
              <div className="text-[13px] font-medium leading-tight truncate">{user.name}</div>
              <div className="text-[11px] text-ink-400 font-mono leading-tight truncate">
                {user.email}
              </div>
            </div>
          </div>

          {/* menu items */}
          <nav className="py-1 text-[13px]">
            <MenuItem icon={IconUserCircle} label="View profile" onClick={() => setOpen(false)} />
            <MenuItem icon={IconSettings}   label="Settings"      onClick={() => setOpen(false)} />
            <MenuItem
              icon={IconKeyboard}
              label="Keyboard shortcuts"
              meta={<KeyHint k="?" />}
              onClick={() => setOpen(false)}
            />
            <div className="my-1 h-px bg-ink-100 dark:bg-white/10" />
            <MenuItem
              icon={IconExternalLink}
              label="GitHub repo"
              onClick={() => { setOpen(false); window.open('https://github.com/LondheShubham153/devboard', '_blank'); }}
            />
            <div className="my-1 h-px bg-ink-100 dark:bg-white/10" />
            <MenuItem
              icon={IconLogout}
              label="Sign out"
              danger
              onClick={() => setOpen(false)}
              meta={<KeyHint k="⇧⌘Q" />}
            />
          </nav>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, meta, danger }) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className={`w-full px-3 h-8 inline-flex items-center gap-2.5 text-left transition
        ${danger
          ? 'text-[#A32D2D] hover:bg-danger-bg'
          : 'hover:bg-ink-50 dark:hover:bg-white/5'}`}
    >
      <Icon size={14} stroke={1.6} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {meta}
    </button>
  );
}

function KeyHint({ k }) {
  return (
    <span className="font-mono text-[10px] text-ink-400 px-1.5 h-[18px] inline-flex items-center
      rounded border border-ink-100 dark:border-white/10 bg-ink-50 dark:bg-white/5">
      {k}
    </span>
  );
}
