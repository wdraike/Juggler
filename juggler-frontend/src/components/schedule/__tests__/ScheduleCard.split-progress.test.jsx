// src/components/schedule/__tests__/ScheduleCard.split-progress.test.jsx
/**
 * 999.1220 (David ruling 2026-07-06) — merged split card progress.
 *
 * done is CHUNK-ONLY, so a merged split block (R56 coalesce) must surface
 * per-chunk progress ("1/3 done") instead of pretending the whole occurrence
 * shares one status. CalendarGrid computes { done, total } via
 * utils/coalesceSplits.splitProgress and passes it as the `splitProgress`
 * prop; targeting of the done tap (next incomplete chunk) is pinned in
 * utils/coalesceSplits.test.js (statusChangeTargets).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import ScheduleCard from '../ScheduleCard';

function makeItem(overrides) {
  return Object.assign({
    task: Object.assign({
      id: 'split-merged-1',
      text: 'Merged split task',
      pri: 'P3',
      dur: 90,
      recurring: false,
      overdue: false,
    }, (overrides && overrides.task) || {}),
    start: 480,
    dur: 90,
    splitTotal: 3,
    _isMergedSplit: true,
    _coalescedIds: ['c1', 'c2', 'c3'],
  }, (overrides && overrides.item) || {});
}

function renderCard(item, splitProgress, status) {
  render(
    <div style={{ width: 200, height: 60 }}>
      <ScheduleCard
        item={item}
        status={status || ''}
        splitProgress={splitProgress}
        onStatusChange={null}
        onDelete={null}
        onExpand={null}
        darkMode={false}
        isBlocked={false}
        isMobile={false}
        layoutMode="grid"
        cardHeight={60}
        weatherDay={null}
      />
    </div>
  );
}

describe('ScheduleCard merged-split progress badge (999.1220)', () => {
  test('shows "1/3 done" when one of three chunks is done', () => {
    renderCard(makeItem(), { done: 1, total: 3 });
    expect(screen.getByText('1/3 done')).toBeInTheDocument();
  });

  test('shows "0/3 done" on an untouched merged split', () => {
    renderCard(makeItem(), { done: 0, total: 3 });
    expect(screen.getByText('0/3 done')).toBeInTheDocument();
  });

  test('renders NO progress badge on a non-split card (splitProgress null)', () => {
    renderCard(makeItem({ item: { splitTotal: 1, _isMergedSplit: undefined, _coalescedIds: undefined } }), null);
    expect(screen.queryByText(/\/\d+ done/)).toBeNull();
  });

  test('partial done must NOT strike the card through (status stays open until all chunks settle)', () => {
    // CalendarGrid passes mergedCardStatus(...) = '' while any chunk is open.
    renderCard(makeItem(), { done: 1, total: 3 }, '');
    var title = screen.getByText('Merged split task');
    expect(title.style.textDecoration).toBe('none');
  });
});
