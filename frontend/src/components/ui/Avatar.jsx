const PALETTE = ['#7F77DD', '#639922', '#BA7517', '#E24B4A', '#3C3489', '#5F5E5A'];

function initials(name = '') {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function colorFor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function Avatar({ name, size = 26, title }) {
  return (
    <span
      title={title || name}
      className="inline-flex items-center justify-center font-medium text-white select-none"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: colorFor(name),
        fontSize: Math.max(10, Math.round(size * 0.42)),
      }}
    >
      {initials(name) || '?'}
    </span>
  );
}
