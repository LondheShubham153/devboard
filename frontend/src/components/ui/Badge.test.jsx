import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, PriorityBadge } from './Badge';

describe('StatusBadge', () => {
  it.each([
    ['done',        'done'],
    ['in_progress', 'in progress'],
    ['blocked',     'blocked'],
    ['todo',        'todo'],
  ])('renders the %s status with the right label', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('falls back to the todo style for unknown statuses', () => {
    render(<StatusBadge status="something-weird" />);
    // unknown status maps to todo style/label
    expect(screen.getByText('todo')).toBeInTheDocument();
  });
});

describe('PriorityBadge', () => {
  it.each([
    ['high',   'high'],
    ['medium', 'medium'],
    ['low',    'low'],
  ])('renders %s priority', (priority, label) => {
    render(<PriorityBadge priority={priority} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
