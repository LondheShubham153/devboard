import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  return (
    <div className="h-full flex bg-ink-50 dark:bg-[#18181b]">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 relative">
        <Topbar />
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
