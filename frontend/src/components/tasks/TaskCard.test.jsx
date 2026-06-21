import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskCard } from './TaskCard';

const baseTask = {
  id: 42,
  title: 'Ship the v1',
  status: 'in_progress',
  priority: 'high',
  due_date: '2026-07-15',
  assignee_id: 7,
};

describe('TaskCard', () => {
  it('renders task id, title, status, priority', () => {
    render(<TaskCard task={baseTask} />);
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Ship the v1')).toBeInTheDocument();
    expect(screen.getByText('in progress')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('renders the assignee avatar when assigneeName is passed', () => {
    render(<TaskCard task={baseTask} assigneeName="Alice Chen" />);
    expect(screen.getByTitle('Alice Chen')).toBeInTheDocument();
  });

  it('handles a missing due_date without crashing', () => {
    const t = { ...baseTask, due_date: null };
    render(<TaskCard task={t} />);
    expect(screen.getByText('Ship the v1')).toBeInTheDocument();
  });
});
