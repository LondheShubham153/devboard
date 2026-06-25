import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

// On the advanced branch these hooks hit the Go + Postgres backend through the
// gateway (/api/*). The component-facing API is identical to the fundamentals
// branch — only this data layer changed (mock store → real REST calls).

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get('/api/projects'),
  });
}

export function useTasks(projectId) {
  return useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.get(`/api/tasks?project_id=${projectId}`),
    enabled: !!projectId,
  });
}

export function useCreateTask(projectId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/api/tasks', { ...body, project_id: projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', projectId] }),
  });
}

export function useUpdateTask(projectId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }) => api.patch(`/api/tasks/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', projectId] }),
  });
}
