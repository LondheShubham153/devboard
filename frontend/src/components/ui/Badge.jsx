const STATUS_STYLES = {
  done:        { bg: 'bg-success-bg',  fg: 'text-[#3B6D11]', label: 'done' },
  in_progress: { bg: 'bg-accent-subtle', fg: 'text-accent-muted', label: 'in progress' },
  blocked:     { bg: 'bg-danger-bg',   fg: 'text-[#A32D2D]', label: 'blocked' },
  todo:        { bg: 'bg-ink-50',      fg: 'text-ink-600',   label: 'todo' },
  overdue:     { bg: 'bg-warning-bg',  fg: 'text-[#854F0B]', label: 'overdue' },
};

const PRIORITY_STYLES = {
  high:   { bg: 'bg-danger-bg',    fg: 'text-[#A32D2D]', label: 'high' },
  medium: { bg: 'bg-warning-bg',   fg: 'text-[#854F0B]', label: 'medium' },
  low:    { bg: 'bg-ink-50',       fg: 'text-ink-600',   label: 'low' },
};

export function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.todo;
  return (
    <span className={`inline-flex items-center ${s.bg} ${s.fg} text-[11px] font-medium px-2 py-[3px] rounded-[5px]`}>
      {s.label}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const s = PRIORITY_STYLES[priority] || PRIORITY_STYLES.medium;
  return (
    <span className={`inline-flex items-center ${s.bg} ${s.fg} text-[11px] font-medium px-2 py-[3px] rounded-[5px]`}>
      {s.label}
    </span>
  );
}
