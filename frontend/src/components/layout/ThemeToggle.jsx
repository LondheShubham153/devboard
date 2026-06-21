import { useEffect, useState } from 'react';
import { IconSun, IconMoon } from '@tabler/icons-react';

const KEY = 'devboard.theme';

function readPreferred() {
  const stored = localStorage.getItem(KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => readPreferred());

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return (
    <button
      type="button"
      onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      aria-label="Toggle theme"
      className="h-8 w-8 rounded-full inline-flex items-center justify-center
        text-ink-600 dark:text-ink-400
        hover:bg-ink-50 dark:hover:bg-white/5 hover:text-ink-950 dark:hover:text-white
        transition"
    >
      {theme === 'dark' ? <IconSun size={15} stroke={1.6} /> : <IconMoon size={15} stroke={1.6} />}
    </button>
  );
}
