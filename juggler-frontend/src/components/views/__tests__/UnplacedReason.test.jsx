import React from 'react';
import { render } from '@testing-library/react';
import UnplacedReason from '../UnplacedReason';

const theme = { amberBg: '#000', amberText: '#fff', amberBorder: '#888', textMuted: '#999' };

describe('UnplacedReason', () => {
  test('renders reason chip for a task with a reason', () => {
    const { container } = render(
      <UnplacedReason task={{ _unplacedReason: 'weather', _unplacedDetail: 'too humid' }} theme={theme} />
    );
    expect(container.textContent).toMatch(/too humid/);
    expect(container.querySelector('span')).toBeTruthy();
  });

  test('falls back to no_slot label when reason unset but task is unscheduled', () => {
    const { container } = render(
      <UnplacedReason task={{ unscheduled: 1 }} theme={theme} />
    );
    // labelFor('no_slot') → 'No free slot'
    expect(container.textContent).toMatch(/No free slot/);
  });

  test('renders nothing for a plain backlog task (not unplaced)', () => {
    const { container } = render(
      <UnplacedReason task={{ id: 'x', text: 'plain' }} theme={theme} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('compact hides the detail string', () => {
    const { container } = render(
      <UnplacedReason task={{ _unplacedReason: 'weather', _unplacedDetail: 'too humid' }} theme={theme} compact />
    );
    expect(container.textContent).not.toMatch(/too humid/);
  });

  test('renders nothing for null task', () => {
    const { container } = render(<UnplacedReason task={null} theme={theme} />);
    expect(container.firstChild).toBeNull();
  });
});
