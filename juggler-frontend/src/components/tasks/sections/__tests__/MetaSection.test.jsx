import React from 'react';
import { render, screen } from '@testing-library/react';
import MetaSection from '../MetaSection';

const TH = { textMuted: '#888', border: '#ccc' };

it('renders created date', () => {
  render(<MetaSection task={{ createdAt: '2026-01-15T10:00:00Z', slackMins: null }} TH={TH} />);
  expect(screen.getByText(/Jan 15, 2026/)).toBeInTheDocument();
});

it('shows ∞ for null slack', () => {
  render(<MetaSection task={{ createdAt: null, slackMins: null }} TH={TH} />);
  expect(screen.getByText('∞')).toBeInTheDocument();
});

it('renders slack in minutes when under 60', () => {
  render(<MetaSection task={{ createdAt: null, slackMins: 45 }} TH={TH} />);
  expect(screen.getByText('45m')).toBeInTheDocument();
});

it('renders slack in hours when 60+', () => {
  render(<MetaSection task={{ createdAt: null, slackMins: 90 }} TH={TH} />);
  expect(screen.getByText('1h 30m')).toBeInTheDocument();
});
