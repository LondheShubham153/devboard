// Renders the assistant's text, with a blinking cursor while tokens stream in.
export function StreamingText({ text, isStreaming }) {
  return (
    <div className="text-[14px] leading-[1.6] whitespace-pre-wrap font-sans text-ink-950 dark:text-ink-100">
      {text || <span className="text-ink-400">Waiting for response…</span>}
      {isStreaming && (
        <span className="inline-block w-[7px] h-[15px] ml-0.5 -mb-0.5 bg-accent animate-pulse rounded-sm" />
      )}
    </div>
  );
}
