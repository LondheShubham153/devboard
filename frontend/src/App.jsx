import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectPage } from './pages/ProjectPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index                element={<DashboardPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
