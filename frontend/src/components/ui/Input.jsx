export function Input({ label, error, className = '', id, ...rest }) {
  const reactId = id || rest.name;
  return (
    <label htmlFor={reactId} className="block">
      {label && (
        <span className="block mb-1 text-[12px] font-medium text-ink-600 dark:text-ink-400">
          {label}
        </span>
      )}
      <input id={reactId} className={`db-input ${error ? 'border-danger' : ''} ${className}`} {...rest} />
      {error && <span className="block mt-1 text-[12px] text-danger">{error}</span>}
    </label>
  );
}
