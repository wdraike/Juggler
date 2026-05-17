import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WhereSection from '../WhereSection';

const TH = { accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff' };
const LOCS = [
  { id: 'home', name: 'Home', icon: '🏠' },
  { id: 'office', name: 'Office', icon: '🏢' },
];

it('renders location buttons', () => {
  render(<WhereSection locations={LOCS} taskLoc={[]} onChange={() => {}} TH={TH} isMobile={false} />);
  expect(screen.getByText(/Home/)).toBeInTheDocument();
  expect(screen.getByText(/Office/)).toBeInTheDocument();
});

it('calls onChange with location id when clicked', () => {
  const onChange = jest.fn();
  render(<WhereSection locations={LOCS} taskLoc={[]} onChange={onChange} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByText(/Home/));
  expect(onChange).toHaveBeenCalledWith(['home']);
});

it('calls onChange with empty array when Anywhere clicked', () => {
  const onChange = jest.fn();
  render(<WhereSection locations={LOCS} taskLoc={['home']} onChange={onChange} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByText(/Anywhere/));
  expect(onChange).toHaveBeenCalledWith([]);
});
