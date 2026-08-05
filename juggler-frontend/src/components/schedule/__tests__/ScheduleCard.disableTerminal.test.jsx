/**
 * 999.5164 — ScheduleCard and DailyViewTaskBlock still pass
 * disableTerminal={!task.scheduledAt}, which disables the done/skip/cancel
 * buttons for tasks without scheduledAt. This contradicts the D-B ruling
 * (2026-07-02): unscheduled tasks ARE resolvable in place — the backend
 * snaps scheduled_at to now. TaskCard and DailyViewUnschedEntry were fixed
 * (disableTerminal removed), but ScheduleCard and DailyViewTaskBlock were not.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import ScheduleCard from '../ScheduleCard';
import TaskBlock from '../../views/DailyViewTaskBlock';
import { getTheme } from '../../../theme/colors';

jest.mock('../../../theme/colors', () => jest.requireActual('../../../theme/colors'));
jest.mock('../../../state/constants', () => jest.requireActual('../../../state/constants'));
jest.mock('../../../shared/task-status', () => jest.requireActual('../../../shared/task-status'));

jest.mock('../../../scheduler/dateHelpers', () => ({
  formatDateKey: (date) => {
    if (!date) return '';
    return date.toISOString ? date.toISOString().split('T')[0] : String(date).split('T')[0];
  },
  formatMinsCompact: (mins) => mins + 'm',
  parseDate: (str) => new Date(str),
}));

jest.mock('../../../scheduler/timeBlockHelpers', () => ({ parseWhen: () => [] }));
jest.mock('../../../utils/taskIcon', () => ({ getTaskIcon: () => null }));
jest.mock('../../../utils/weatherMatch', () => ({ checkWeatherMatch: () => ({ ok: true }), hasWeatherRestrictions: () => false }));
jest.mock('../../../utils/overdue', () => ({ isTaskOverdue: () => false }));
jest.mock('../../../utils/timezone', () => ({ formatMinsCompact: (mins) => mins + 'm' }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), createPortal: (children) => children }));

var theme = getTheme(false);

describe('999.5164 — ScheduleCard: unscheduled task done button enabled (D-B ruling)', () => {
  test('a task with scheduledAt=null can be marked done (RED — disableTerminal blocks it)', () => {
    var onStatusChange = jest.fn();
    var task = {
      id: 'cut-grass-1', text: 'Cut grass', scheduledAt: null,
      pri: 'P2', dur: 30,
    };

    render(
      <ScheduleCard
        item={{ task: task, start: 480, end: 510, splitTotal: 1 }}
        status=""
        onStatusChange={onStatusChange}
        darkMode={false}
        isMobile={false}
        cardHeight={52}
      />
    );

    // The done button has aria-label="Complete" — use that to find it.
    // When disableTerminal blocks it, the title becomes "Schedule task before
    // resolving" and the button is disabled.
    var doneButton = screen.getByLabelText('Complete');
    expect(doneButton).not.toBeDisabled();
    fireEvent.click(doneButton);
    expect(onStatusChange).toHaveBeenCalledWith('done');
  });
});

describe('999.5164 — DailyViewTaskBlock: unscheduled task done button enabled (D-B ruling)', () => {
  test('a task with scheduledAt=null can be marked done (RED — disableTerminal blocks it)', () => {
    var onStatusChange = jest.fn();
    var task = {
      id: 'cut-grass-2', text: 'Cut grass', scheduledAt: null,
      pri: 'P2', dur: 30,
    };

    render(
      <TaskBlock
        item={{ task: task, start: 480, end: 510, splitTotal: 1 }}
        status=""
        top={0} height={40} col={0} totalCols={1}
        onExpand={() => {}}
        onStatusChange={onStatusChange}
        onDelete={() => {}}
        theme={theme}
        darkMode={false}
        isMobile={false}
        isBlocked={false}
        canDrag={false}
        gutterW={40}
        hourHeight={60}
        weatherDay={null}
      />
    );

    var doneButton = screen.getByLabelText('Complete');
    expect(doneButton).not.toBeDisabled();
    fireEvent.click(doneButton);
    expect(onStatusChange).toHaveBeenCalledWith('done');
  });
});