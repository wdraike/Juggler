// src/components/schedule/__tests__/ScheduleCard.overdue-fork.test.jsx
/**
 * 999.1224 (JUG-UI-OVERDUE-FLAG-FORK) — regression guard for the
 * ScheduleCard.jsx:49 overdue-predicate fork.
 *
 * SSOT (999.671, utils/overdue.js): overdue display MUST be decided via
 * isTaskOverdue(task, isDone) reading the canonical task.overdue field. The
 * scheduler's per-placement `_overdue` flag (set server-side in
 * unifiedScheduleV2.js / runSchedule.js, e.g. `entry._overdue = true`) is a
 * slack-relaxation artifact that wrongly marks floating/anytime tasks
 * overdue and must NEVER drive display on its own.
 *
 * ScheduleCard.jsx:49 currently reads `item._overdue` directly:
 *   var isOverdue = !!item._overdue && !isDone;
 * instead of isTaskOverdue(task, isDone) — so a task the scheduler couldn't
 * fit without ignoring its deadline (item._overdue: true) but which is NOT
 * a real hard commitment (task.overdue: false) is shown overdue when it
 * must not be. This is the exact regression documented in
 * overdue.test.js's "floating task ... NOT overdue even if a caller had a
 * placement _overdue (999.671)" case, reproduced here through the real
 * ScheduleCard render (not the isolated helper).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import ScheduleCard from '../ScheduleCard';

function makeItem(overrides) {
  return Object.assign({
    task: Object.assign({
      id: 'task-fork-1',
      text: 'Floating task, not a hard commitment',
      pri: 'P3',
      dur: 30,
      recurring: false,
      // canonical SSOT field (999.671/R50.6) — NOT overdue.
      overdue: false,
    }, overrides.task),
    // scheduler placement fields (production shape — set server-side by
    // unifiedScheduleV2.js: `if (placement.overdue) entry._overdue = true;`).
    start: 480,
    dur: 30,
    splitTotal: 1,
  }, overrides.item);
}

function renderCard(item) {
  render(
    <div style={{ width: 200, height: 60 }}>
      <ScheduleCard
        item={item}
        status=""
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

describe('ScheduleCard overdue badge (999.1224 predicate fork)', () => {
  test('floating task (task.overdue=false) with a scheduler slack-relaxation _overdue=true placement artifact must NOT render OVERDUE (999.671 SSOT)', () => {
    var item = makeItem({ task: { overdue: false }, item: { _overdue: true } });
    renderCard(item);

    // Per isTaskOverdue({overdue:false, ...}, false) === false (utils/overdue.js
    // + its own regression test), NO overdue badge/warning icon should render.
    expect(screen.queryByText(/OVERDUE/i)).toBeNull();
  });

  test('a genuinely overdue task (task.overdue=true) with NO scheduler placement artifact DOES render OVERDUE', () => {
    var item = makeItem({ task: { overdue: true }, item: {} });
    renderCard(item);
    expect(screen.getByText(/OVERDUE/i)).toBeInTheDocument();
  });

  test('a genuinely overdue task that is already done/terminal must NOT render OVERDUE', () => {
    var item = makeItem({ task: { overdue: true }, item: {} });
    render(
      <div style={{ width: 200, height: 60 }}>
        <ScheduleCard
          item={item}
          status="done"
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
    expect(screen.queryByText(/OVERDUE/i)).toBeNull();
  });

  test('a compact (non-lg) overdue card still surfaces its deadline/date — a bare badge with no context is a bug', () => {
    var item = makeItem({ task: { overdue: true, deadline: '2026-07-07' }, item: {} });
    render(
      <div style={{ width: 200, height: 24 }}>
        <ScheduleCard
          item={item} status="" onStatusChange={null} onDelete={null} onExpand={null}
          darkMode={false} isBlocked={false} isMobile={false} layoutMode="grid"
          cardHeight={24} weatherDay={null}
        />
      </div>
    );
    expect(screen.getByText(/OVERDUE/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-07/)).toBeInTheDocument();
  });

  test('an overdue task whose deadline equals its date is not silently suppressed on a large card', () => {
    var item = makeItem({
      task: { overdue: true, deadline: '2026-07-07', date: '2026-07-07' },
      item: {},
    });
    render(
      <div style={{ width: 200, height: 90 }}>
        <ScheduleCard
          item={item} status="" onStatusChange={null} onDelete={null} onExpand={null}
          darkMode={false} isBlocked={false} isMobile={false} layoutMode="grid"
          cardHeight={90} weatherDay={null}
        />
      </div>
    );
    expect(screen.getByText(/deadline 2026-07-07/)).toBeInTheDocument();
  });
});
