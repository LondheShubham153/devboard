import { useState } from 'react';
import { IconSparkles, IconSend2, IconPlayerStop } from '@tabler/icons-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { StreamingText } from './StreamingText';
import { useAIStream } from '../../hooks/useAIStream';

export function AIChat({ projectId }) {
  const [question, setQuestion] = useState('');
  const { text, isStreaming, error, stream, abort } = useAIStream();

  function ask(e) {
    e.preventDefault();
    if (!question.trim()) return;
    stream('ask', { project_id: String(projectId), question });
  }

  function summarise() {
    stream('summarise', { project_id: String(projectId) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconSparkles size={18} className="text-accent" />
        <h2 className="text-[16px] font-semibold">AI assistant</h2>
        <Button variant="secondary" onClick={summarise} disabled={isStreaming} className="ml-auto">
          Summarise project
        </Button>
      </div>

      <form onSubmit={ask} className="flex gap-2">
        <Input
          name="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about this project…"
          className="flex-1"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <Button variant="danger" onClick={abort} type="button" className="inline-flex items-center gap-1">
            <IconPlayerStop size={14} /> Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!question.trim()} className="inline-flex items-center gap-1">
            <IconSend2 size={14} /> Ask
          </Button>
        )}
      </form>

      {error && (
        <div className="db-card p-3 text-[12px] text-danger border-danger/40">{error}</div>
      )}

      {(text || isStreaming) && (
        <div className="db-card p-4 rounded-lg">
          <StreamingText text={text} isStreaming={isStreaming} />
        </div>
      )}
    </div>
  );
}
