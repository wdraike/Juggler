import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolsSection from '../ToolsSection';

const TH = { accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff' };
const TOOLS = [
  { id: 'car', name: 'Car', icon: '🚗' },
  { id: 'laptop', name: 'Laptop', icon: '💻' },
];

it('renders tool buttons', () => {
  render(<ToolsSection tools={TOOLS} taskTools={[]} onChange={() => {}} TH={TH} isMobile={false} />);
  expect(screen.getByText(/Car/)).toBeInTheDocument();
  expect(screen.getByText(/Laptop/)).toBeInTheDocument();
});

it('calls onChange with tool id when clicked', () => {
  const onChange = jest.fn();
  render(<ToolsSection tools={TOOLS} taskTools={[]} onChange={onChange} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByText(/Car/));
  expect(onChange).toHaveBeenCalledWith(['car']);
});

it('calls onChange removing tool when clicked again', () => {
  const onChange = jest.fn();
  render(<ToolsSection tools={TOOLS} taskTools={['car']} onChange={onChange} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByText(/Car/));
  expect(onChange).toHaveBeenCalledWith([]);
});
