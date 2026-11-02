import { useState } from 'react';
import { AIChat } from '../components/ai/AIChat';
import { useProjects } from '../hooks/useTasks';

// AI Assistant page. Lets you pick a project, then summarise it or ask questions
// grounded in that project's tasks. Answers stream token-by-token from the
// in-cluster model (Ollama) via the ai-service.
export function AIPage() {
  const { data } = useProjects();
  const projects = data?.projects || [];
  const [projectId, setProjectId] = useState(1);

  return (
    <div className="max-w-3xl mx-auto px-6 py-7 space-y-5">
      <div>
        <h1 className="text-[20px] font-semibold">AI Assistant</h1>
        <p className="text-[13px] text-ink-500 dark:text-ink-400 mt-1">
          Grounded in your project's tasks. Summaries and answers stream live from
          a self-hosted model running in the cluster.
        </p>
      </div>

      <label className="block">
        <span className="block mb-1 text-[12px] font-medium text-ink-600 dark:text-ink-400">
          Project
        </span>
        <select
          className="db-input"
          value={projectId}
          onChange={(e) => setProjectId(Number(e.target.value))}
        >
          {projects.length === 0 && <option value={1}>Project 1</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <div className="db-card p-5 rounded-lg">
        <AIChat projectId={projectId} />
      </div>
    </div>
  );
}
