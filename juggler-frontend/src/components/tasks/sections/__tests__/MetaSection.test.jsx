import React from 'react';
import { render, screen } from '@testing-library/react';
import MetaSection from '../MetaSection';

const TH = { textMuted: '#888', border: '#ccc' };

// 999.15686: use a local-midnight string (no Z) so new Date() parses it as
// midnight LOCAL time — getDate() then returns 15 in any host timezone.
// A Z-anchored instant like '2026-01-15T10:00:00Z' renders as Jan 16 on
// hosts east of UTC+14 (the instant's local midnight is the next day).
// A date-only string '2026-01-15' is ES5 UTC — also wrong in eastern zones.
it('renders created date', () => {
  render(<MetaSection task={{ createdAt: '2026-01-15T00:00:00', slackMins: null }} TH={TH} />);
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
