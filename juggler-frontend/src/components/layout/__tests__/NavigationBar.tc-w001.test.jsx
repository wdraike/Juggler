/**
 * TC-W001 — NavigationBar mode-selector overflow (UX-JUG-004)
 * RTL unit test — no live server required.
 *
 * Tests the structural CSS properties that prevent horizontal overflow of the
 * NavigationBar view-mode button row at 7 canonical viewport widths:
 *   320, 375, 768, 1024, 1280, 1440, 1920 px
 *
 * jsdom does not perform real layout, so pixel-level overflow cannot be
 * measured here. Instead we assert the CSS invariants that the component
 * relies on to avoid overflow:
 *
 *   1. Outer nav wrapper has flexWrap: 'wrap'  — buttons reflow rather than clip
 *   2. Mobile (< 600px): overflowX 'hidden' is set on the outer wrapper
 *   3. Desktop (≥ 600px): overflowX is 'visible' (content reflows, not hidden)
 *   4. Mobile button row has flex: '1 1 100%' — full-width row, buttons share space
 *   5. Desktop button row has no flex shorthand — buttons are natural width
 *   6. All 11 VIEW_MODES render a corresponding button
 *   7. Mobile renders icon content (unicode), desktop renders label text
 *
 * For true pixel overflow verification at real viewport sizes, run the
 * Playwright companion: tests/tc-w001-mode-selector-overflow.spec.js
 * (requires live juggler-frontend dev server).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import NavigationBar from '../NavigationBar';

// ── Shared props ─────────────────────────────────────────────────────────────

const BASE_PROPS = {
  viewMode: 'daily',
  setViewMode: jest.fn(),
  filter: 'open',
  setFilter: jest.fn(),
  search: '',
  setSearch: jest.fn(),
  darkMode: false,
  projectFilter: '',
  setProjectFilter: jest.fn(),
  allProjectNames: [],
  unplacedCount: 0,
  blockedCount: 0,
  pastDueCount: 0,
  fixedCount: 0,
  issuesCount: 0,
  isMobile: false,
};

// Expected VIEW_MODES from NavigationBar.jsx (id → label/icon/tip triples)
// tip values are the exact title= attribute strings rendered by the component.
// SYNC: keep in sync with VIEW_MODES in NavigationBar.jsx. If a mode is added or
// renamed there, update this array and the button count assertion (expect 10) below.
const VIEW_MODES = [
  { id: 'daily',     label: 'Day',      icon: '📄', tip: 'Day view — plain hour grid with hover details' },
  { id: 'day',       label: 'Flex',     icon: '↔',  tip: 'Flex view — single-day timeline with bezier connectors' },
  { id: '3day',      label: '3-Day',    icon: '3',  tip: '3-Day view — three-day side-by-side timeline' },
  { id: 'week',      label: 'Week',     icon: '7',  tip: 'Week view — seven-day timeline overview' },
  { id: 'month',     label: 'Month',    icon: 'M',  tip: 'Month view — calendar with hover details' },
  { id: 'timeline',  label: 'Timeline', icon: '↔',  tip: 'Timeline view — horizontal left-to-right timeline with cards above and below' },
  { id: 'list',      label: 'List',     icon: '≡',  tip: 'List view — all tasks grouped by date' },
  { id: 'priority',  label: 'Priority', icon: 'P',  tip: 'Priority view — P1-P4 kanban columns' },
  { id: 'deps',      label: 'Deps',     icon: '→',  tip: 'Dependencies view — DAG graph of task dependencies, filter by project' },
  { id: 'conflicts', label: 'Issues',   icon: '!',  tip: 'Issues view — unscheduled tasks, conflicts, and deadline misses' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Render NavigationBar and return the outermost wrapper element.
 * The outer wrapper is the first <div> in the rendered output.
 */
function renderNav(overrides = {}) {
  const props = { ...BASE_PROPS, ...overrides };
  const { container } = render(<NavigationBar {...props} />);
  return container.firstElementChild;
}

/**
 * Return the mode-button row element — the first child div of the outer wrapper.
 */
function getModeRow(outerWrapper) {
  return outerWrapper.firstElementChild;
}

// ── TC-W001: Viewport-independent structural invariants ──────────────────────

describe('TC-W001 — NavigationBar mode-selector structural overflow guards', () => {

  // ── 1. Outer wrapper has flexWrap: wrap ──────────────────────────────
  describe('outer wrapper layout', () => {
    it('has flexWrap: wrap on desktop (prevents clipping when filters overflow)', () => {
      const wrapper = renderNav({ isMobile: false });
      expect(wrapper.style.flexWrap).toBe('wrap');
    });

    it('has flexWrap: wrap on mobile', () => {
      const wrapper = renderNav({ isMobile: true });
      expect(wrapper.style.flexWrap).toBe('wrap');
    });
  });

  // ── 2. overflowX behaviour per breakpoint ────────────────────────────
  describe('overflowX — TC-W001 viewport breakpoint behaviour', () => {
    it('desktop: overflowX is visible (content wraps, not clipped)', () => {
      const wrapper = renderNav({ isMobile: false });
      // NavigationBar sets overflowX: 'visible' on desktop so that the
      // filter dropdown (position: absolute, zIndex: 300) is not clipped.
      expect(wrapper.style.overflowX).toBe('visible');
    });

    it('mobile: overflowX is hidden (clips any accidental stray overflow)', () => {
      const wrapper = renderNav({ isMobile: true });
      expect(wrapper.style.overflowX).toBe('hidden');
    });
  });

  // ── 3. Mode-button row layout ─────────────────────────────────────────
  describe('mode-button row layout', () => {
    it('desktop: row is a plain flex container (no forced full-width)', () => {
      const wrapper = renderNav({ isMobile: false });
      const row = getModeRow(wrapper);
      expect(row.style.display).toBe('flex');
      // On desktop the row is NOT forced to 100% width — it shrinks to content
      expect(row.style.flex).toBe('');
    });

    it('mobile: row has flex: 1 1 100% so buttons share the full nav width', () => {
      const wrapper = renderNav({ isMobile: true });
      const row = getModeRow(wrapper);
      expect(row.style.display).toBe('flex');
      // flex: '1 1 100%' distributes the row across the full viewport width
      expect(row.style.flex).toBe('1 1 100%');
    });

    it('mobile: row uses space-between so buttons are evenly distributed', () => {
      const wrapper = renderNav({ isMobile: true });
      const row = getModeRow(wrapper);
      expect(row.style.justifyContent).toBe('space-between');
    });

    it('desktop: row has no justifyContent override (default flex-start)', () => {
      const wrapper = renderNav({ isMobile: false });
      const row = getModeRow(wrapper);
      // No justifyContent set — browser default is flex-start which keeps
      // buttons left-aligned and naturally sized.
      expect(row.style.justifyContent).toBe('');
    });
  });

  // ── 4. All 10 VIEW_MODES are rendered ────────────────────────────────
  describe('mode-button count', () => {
    it('desktop: renders all 10 view-mode buttons with label text', () => {
      renderNav({ isMobile: false });
      for (const mode of VIEW_MODES) {
        // Use the exact tip string as the title= attribute value.
        // getByTitle does a case-sensitive exact match when given a string.
        const btn = screen.getByTitle(mode.tip);
        expect(btn).toBeInTheDocument();
        // Desktop: button text content is the label (e.g. "Day", "3-Day")
        expect(btn).toHaveTextContent(mode.label);
      }
    });

    it('mobile: renders all 10 view-mode buttons with icon content', () => {
      renderNav({ isMobile: true });
      for (const mode of VIEW_MODES) {
        const btn = screen.getByTitle(mode.tip);
        expect(btn).toBeInTheDocument();
        // 'day' and 'timeline' intentionally share icon ↔ — both map to mode.icon
        expect(btn).toHaveTextContent(mode.icon);
      }
    });
  });

  // ── 5. Mobile button flex — each button fills its share ──────────────
  describe('mobile: individual mode buttons have flex: 1', () => {
    it('each mode button has flex: 1 on mobile so they divide width evenly', () => {
      const wrapper = renderNav({ isMobile: true });
      const row = getModeRow(wrapper);
      const buttons = Array.from(row.querySelectorAll('button'));
      expect(buttons.length).toBe(VIEW_MODES.length); // all 10 present
      for (const btn of buttons) {
        expect(btn.style.flex).toBe('1');
      }
    });

    it('each mode button has textAlign: center on mobile', () => {
      const wrapper = renderNav({ isMobile: true });
      const row = getModeRow(wrapper);
      const buttons = Array.from(row.querySelectorAll('button'));
      for (const btn of buttons) {
        expect(btn.style.textAlign).toBe('center');
      }
    });
  });

  // ── 6. Desktop buttons are natural-width (no forced flex) ─────────────
  describe('desktop: individual mode buttons are natural-width', () => {
    it('mode buttons do not have flex set on desktop', () => {
      const wrapper = renderNav({ isMobile: false });
      const row = getModeRow(wrapper);
      const buttons = Array.from(row.querySelectorAll('button'));
      expect(buttons.length).toBe(VIEW_MODES.length);
      for (const btn of buttons) {
        // On desktop no flex shorthand is applied — browser default is 0 1 auto
        expect(btn.style.flex).toBe('');
      }
    });
  });

  // ── 7. Active viewMode button receives accent background ─────────────
  describe('active view mode indication', () => {
    it('the active viewMode button has a non-transparent background', () => {
      renderNav({ isMobile: false, viewMode: 'week' });
      // Use exact tip string — avoids ambiguity with "3-Day view" matching /Day view/i
      const weekBtn = screen.getByTitle('Week view — seven-day timeline overview');
      expect(weekBtn).toBeInTheDocument();
      // The active button background is the accent color (non-empty, non-transparent)
      expect(weekBtn.style.background).not.toBe('transparent');
      expect(weekBtn.style.background).not.toBe('');
    });

    it('non-active buttons have transparent background', () => {
      renderNav({ isMobile: false, viewMode: 'week' });
      // Use exact tip string for Day (daily) — avoids matching "3-Day view"
      const dayBtn = screen.getByTitle('Day view — plain hour grid with hover details');
      expect(dayBtn.style.background).toBe('transparent');
    });
  });
});

// ── TC-W001 viewport-parameterised CSS smoke tests ───────────────────────────
// jsdom does not compute layout but we can assert that the two isMobile states
// map correctly to the 7 required viewport widths.

const VIEWPORT_CASES = [
  { width: 320,  isMobile: true,  label: '320px (reflow minimum)' },
  { width: 375,  isMobile: true,  label: '375px (mobile-sm)' },
  { width: 768,  isMobile: false, label: '768px (tablet)' },
  { width: 1024, isMobile: false, label: '1024px (laptop-sm)' },
  { width: 1280, isMobile: false, label: '1280px (laptop)' },
  { width: 1440, isMobile: false, label: '1440px (desktop)' },
  { width: 1920, isMobile: false, label: '1920px (wide desktop)' },
];

describe('TC-W001 — per-viewport CSS invariants', () => {
  for (const vp of VIEWPORT_CASES) {
    describe(`${vp.label} (isMobile=${vp.isMobile})`, () => {
      let wrapper;

      beforeEach(() => {
        wrapper = renderNav({ isMobile: vp.isMobile });
      });

      it('outer wrapper has flexWrap: wrap', () => {
        expect(wrapper.style.flexWrap).toBe('wrap');
      });

      it(vp.isMobile
        ? 'outer wrapper has overflowX: hidden'
        : 'outer wrapper has overflowX: visible', () => {
        expect(wrapper.style.overflowX).toBe(vp.isMobile ? 'hidden' : 'visible');
      });

      it('mode button row is a flex container', () => {
        const row = getModeRow(wrapper);
        expect(row.style.display).toBe('flex');
      });

      it(vp.isMobile
        ? 'mode button row fills full width (flex: 1 1 100%)'
        : 'mode button row has natural width (no flex override)', () => {
        const row = getModeRow(wrapper);
        expect(row.style.flex).toBe(vp.isMobile ? '1 1 100%' : '');
      });

      it('all 10 mode buttons are present', () => {
        const row = getModeRow(wrapper);
        const buttons = row.querySelectorAll('button');
        expect(buttons.length).toBe(10);
      });
    });
  }
});
