import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it.each([
    ['primary',   'db-btn-primary'],
    ['secondary', 'db-btn-secondary'],
    ['ghost',     'db-btn-ghost'],
    ['danger',    'db-btn-danger'],
  ])('applies the %s variant class', (variant, cls) => {
    render(<Button variant={variant}>x</Button>);
    expect(screen.getByRole('button')).toHaveClass(cls);
  });

  it('fires onClick when clicked', async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    render(<Button onClick={handler}>Go</Button>);
    await user.click(screen.getByRole('button'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is disabled and dims when disabled prop is set', () => {
    render(<Button disabled>x</Button>);
    const b = screen.getByRole('button');
    expect(b).toBeDisabled();
    expect(b).toHaveClass('opacity-50');
  });
});
