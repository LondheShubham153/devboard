const VARIANTS = {
  primary: 'db-btn-primary',
  secondary: 'db-btn-secondary',
  ghost: 'db-btn-ghost',
  danger: 'db-btn-danger',
};

export function Button({
  variant = 'primary',
  type = 'button',
  className = '',
  disabled = false,
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`${VARIANTS[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
