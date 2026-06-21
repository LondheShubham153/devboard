import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTask, listProjects, listTasks, updateTask } from '../mock/store';

// On the fundamentals branch these hooks read from the in-memory mock store
// (src/mock/store.js) instead of the network. The component-facing API is
// identical to the advanced branch, so nothing above this layer changes.

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  });
}

export function useTasks(projectId) {
  return useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => listTasks(projectId),
    enabled: !!projectId,
  });
}

export function useCreateTask(projectId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => createTask({ ...body, project_id: projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', projectId] }),
  });
}

export function useUpdateTask(projectId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }) => updateTask(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', projectId] }),
  });
}
