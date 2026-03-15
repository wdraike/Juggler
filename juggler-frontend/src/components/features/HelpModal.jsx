/**
 * HelpModal — comprehensive help guide and keyboard shortcuts
 */

import React from 'react';
import { getTheme } from '../../theme/colors';

var SHORTCUTS = [
  { key: '\u2190 / \u2192', desc: 'Navigate days' },
  { key: 'Shift + \u2190 / \u2192', desc: 'Navigate weeks' },
  { key: 'J / K', desc: 'Navigate tasks' },
  { key: 'S', desc: 'Cycle task status' },
  { key: 'Ctrl/Cmd + Z', desc: 'Undo' },
  { key: 'Esc', desc: 'Close expanded panel' },
];

function Section({ title, children, theme }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: "'EB Garamond', serif", fontSize: 16, fontWeight: 500, color: theme.text, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid ' + theme.border }}>{title}</div>
      <div style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

function P({ children }) {
  return <div style={{ marginBottom: 6 }}>{children}</div>;
}

function B({ children }) {
  return <strong>{children}</strong>;
}

function Kbd({ children, theme }) {
  return (
    <kbd style={{
      background: theme.bgTertiary, padding: '1px 5px', borderRadius: 3,
      fontSize: 11, fontFamily: 'monospace', border: '1px solid ' + theme.border
    }}>{children}</kbd>
  );
}

export default function HelpModal({ onClose, darkMode, isMobile }) {
  var theme = getTheme(darkMode);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: isMobile ? 0 : 2,
        width: isMobile ? '100%' : 560, maxWidth: isMobile ? '100%' : '95vw',
        height: isMobile ? '100%' : undefined, maxHeight: isMobile ? '100%' : '85vh',
        overflow: 'auto', padding: 20,
        boxShadow: isMobile ? 'none' : ('0 2px 8px ' + theme.shadow)
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, color: theme.text }}>Help Guide</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: theme.textMuted, fontSize: 20, cursor: 'pointer' }}>&times;</button>
        </div>

        {/* 1. Getting Started */}
        <Section title="1. Getting Started" theme={theme}>
          <P>Raike &amp; Sons StriveRS is an auto-scheduling task manager. You create tasks with time windows, locations, tool requirements, priorities, and deadlines — then the scheduler places them into available time slots on your calendar. Never stops striving.</P>
          <P>The basic workflow is: <B>add tasks</B> with constraints (when, where, how long), then hit <B>Reschedule</B> to let the scheduler place them automatically. You can also drag tasks manually and mark them done/wip/skipped as you go.</P>
          <P>Tasks that the scheduler can&apos;t place (due to conflicts, lack of available time, or missing tools at a location) appear in the <B>Unplaced</B> filter and the <B>Issues</B> view.</P>
        </Section>

        {/* 2. How the Scheduler Works */}
        <Section title="2. How the Scheduler Works" theme={theme}>
          <P>When you press <B>Reschedule</B> (&#x1F504;), the scheduler runs through all open, non-rigid tasks and tries to fit them into available time blocks.</P>
          <P><B>Priority order:</B> P1 tasks are placed first, then P2, P3, P4. Within each priority, tasks with tighter constraints (fewer valid time windows, specific locations) are placed before more flexible ones.</P>
          <P><B>Constraint matching:</B> The scheduler respects each task&apos;s <em>when</em> windows (morning, lunch, afternoon, evening), <em>location</em> requirements (only scheduled when you&apos;re at a matching location), and <em>tools</em> requirements (only scheduled where those tools are available).</P>
          <P><B>Rigid/fixed tasks</B> are never moved by the scheduler — they stay pinned to their set time.</P>
          <P><B>Date-pinned tasks</B> remain on their assigned date but can be moved within that day.</P>
          <P><B>Dependencies:</B> A task with dependencies won&apos;t be scheduled until all its dependencies are complete or scheduled earlier.</P>
          <P><B>Splitting:</B> Tasks with split enabled can be broken into multiple chunks across different time blocks or even days, with each chunk at least <em>splitMin</em> minutes long.</P>
          <P>Tasks that can&apos;t fit anywhere are marked <B>unplaced</B>. Check the Issues view for details on why.</P>
        </Section>

        {/* 3. Task Properties */}
        <Section title="3. Task Properties" theme={theme}>
          <P>Each task in the editor has these fields:</P>
          <P><B>Title:</B> The task name displayed on cards and in lists.</P>
          <P><B>Priority (P1-P4):</B> Determines scheduling order. P1 = urgent/important, P4 = low priority.</P>
          <P><B>Date:</B> The date the task is assigned to. Leave blank for the scheduler to pick.</P>
          <P><B>Time:</B> A specific start time. Leave blank for flexible scheduling within <em>when</em> windows.</P>
          <P><B>Duration (dur):</B> How long the task takes in minutes. Defaults to 30.</P>
          <P><B>When:</B> Time windows the task can be scheduled in — morning, lunch, afternoon, evening. Select multiple for flexibility.</P>
          <P><B>Location:</B> Which locations this task can be done at. If none selected, any location works.</P>
          <P><B>Tools:</B> Tools required for this task (e.g., laptop, phone). The scheduler checks the Tool Matrix to see which locations have these tools.</P>
          <P><B>Due date:</B> Deadline — the scheduler tries to place the task on or before this date.</P>
          <P><B>Start after:</B> Earliest date the task can be scheduled.</P>
          <P><B>Rigid:</B> Locks the task to its set date and time — the scheduler won&apos;t move it.</P>
          <P><B>Date pinned:</B> Keeps the task on its assigned date, but the scheduler can still adjust the time within that day.</P>
          <P><B>Habit:</B> Recurring daily task. Habit tasks appear every day and can be batch-marked done with the &#x2713;hab button.</P>
          <P><B>Split:</B> Allows the scheduler to break this task into multiple smaller chunks. Set the minimum chunk size with <em>splitMin</em>.</P>
          <P><B>Depends on:</B> Other tasks that must complete before this one can start. Open the dependency chain editor to visualize and manage links.</P>
          <P><B>Day requirement (dayReq):</B> Restrict to weekdays, weekends, or a specific day of the week.</P>
          <P><B>Project:</B> Group tasks by project for filtering and organization.</P>
          <P><B>Notes:</B> Free-text notes shown on the card and in the editor.</P>
        </Section>

        {/* 4. Schedule Templates */}
        <Section title="4. Schedule Templates" theme={theme}>
          <P>Templates define your daily structure — time blocks and the location for each part of the day.</P>
          <P><B>Time blocks</B> are named periods (e.g., &quot;Morning Work&quot;, &quot;Lunch&quot;, &quot;Evening&quot;) with a start time, end time, default location, color, and icon. The scheduler uses blocks to know when and where you&apos;re available.</P>
          <P><B>Day defaults:</B> Each day of the week maps to a template (e.g., weekdays use &quot;Weekday&quot;, weekends use &quot;Weekend&quot;). Change these in Settings &gt; Templates.</P>
          <P><B>Date overrides:</B> Override the default template for specific dates (e.g., use &quot;WFH&quot; template on a specific Friday).</P>
          <P><B>Location painting:</B> In the template editor, select a location brush and click/drag on the timeline bar to paint 15-minute slots with different locations. This lets you customize exactly where you&apos;ll be at any time of day.</P>
          <P><B>Block edge dragging:</B> Drag the edges of time blocks on the bar to adjust their start/end times visually.</P>
          <P><B>Preset blocks:</B> Quick-add common blocks (Morning, Lunch, Afternoon, etc.) with one click.</P>
          <P><B>Expand button:</B> Opens a detailed slot-by-slot location editor for fine-grained control.</P>
        </Section>

        {/* 5. Views */}
        <Section title="5. Views" theme={theme}>
          <P><B>Day (1):</B> Single-day timeline grid. Tasks appear as cards connected to time markers on a center strip. Scroll vertically through hours.</P>
          <P><B>3-Day (3):</B> Three-day side-by-side timeline. Compare today, tomorrow, and the day after.</P>
          <P><B>Week (7):</B> Seven-day timeline overview with compact cards. Good for seeing your whole week at a glance.</P>
          <P><B>Month (M):</B> Monthly date grid. Each date shows task dots or small cards. Drag tasks between dates to reschedule.</P>
          <P><B>List (&#x2261;):</B> All tasks grouped by date in a flat list. Inline status controls let you quickly mark tasks done.</P>
          <P><B>Priority (P):</B> Kanban-style board with P1, P2, P3, P4 columns. Drag tasks between columns to change priority.</P>
          <P><B>Issues (!):</B> Shows unplaced tasks (couldn&apos;t fit in schedule), conflicts (overlapping tasks), and deadline misses.</P>
        </Section>

        {/* 6. Filters */}
        <Section title="6. Filters" theme={theme}>
          <P><B>Open:</B> Tasks that are not done, cancelled, or skipped. This is the default view.</P>
          <P><B>Action:</B> Open tasks plus tasks currently in progress (WIP). Focused on what needs attention right now.</P>
          <P><B>All:</B> Every task regardless of status.</P>
          <P><B>Done:</B> Only completed tasks.</P>
          <P><B>WIP:</B> Only tasks currently in progress.</P>
          <P><B>Blocked:</B> Tasks waiting on incomplete dependencies. The red badge shows how many. These can&apos;t proceed until their dependencies are done.</P>
          <P><B>Unplaced:</B> Tasks the scheduler couldn&apos;t place into any time slot. The red badge shows how many. Check the Issues view for details.</P>
          <P><B>Hide Habits:</B> Toggle to hide recurring habit tasks from the view, reducing clutter when you want to focus on one-off tasks.</P>
        </Section>

        {/* 7. AI Commands */}
        <Section title="7. AI Commands" theme={theme}>
          <P>The AI input in the header bar accepts natural language commands to modify tasks and settings.</P>
          <P><B>Offline shortcuts</B> (no API needed):</P>
          <P style={{ paddingLeft: 12 }}>
            &bull; <Kbd theme={theme}>wfh</Kbd> — Set all weekday blocks to home location<br />
            &bull; <Kbd theme={theme}>wfh monday</Kbd> — Set Monday blocks to home<br />
            &bull; <Kbd theme={theme}>office</Kbd> / <Kbd theme={theme}>office friday</Kbd> — Set blocks to work location<br />
            &bull; <Kbd theme={theme}>wfh 3/15</Kbd> — Set a specific date&apos;s location to home
          </P>
          <P><B>Online AI commands</B> (requires API):</P>
          <P style={{ paddingLeft: 12 }}>
            &bull; &quot;Move groceries to Friday&quot;<br />
            &bull; &quot;Reschedule my afternoon tasks&quot;<br />
            &bull; &quot;Set all P1 tasks to 30 minutes&quot;<br />
            &bull; &quot;Add a task: buy milk, 15 min, P2&quot;
          </P>
          <P>The chat log dropdown (&#x1F4AC;) shows command history and AI responses. It auto-hides after 8 seconds.</P>
        </Section>

        {/* 8. Calendar Sync */}
        <Section title="8. Calendar Sync" theme={theme}>
          <P><B>Connect:</B> Click the calendar icon (&#x1F4C5;) in the header, then &quot;Connect Google Calendar&quot; to authorize with your Google account via OAuth.</P>
          <P><B>Auto-sync:</B> When enabled, Raike &amp; Sons syncs with your calendars every 5 minutes while the app is open. Toggle this on/off in the sync panel.</P>
          <P><B>Sync Now:</B> Manually trigger a sync at any time.</P>
          <P><B>Bidirectional:</B> Changes flow both ways:</P>
          <P style={{ paddingLeft: 12 }}>
            &bull; <B>Pushed</B> = Tasks sent to your calendar<br />
            &bull; <B>Pulled</B> = Calendar events imported into your tasks<br />
            &bull; <B>Deleted</B> = Removed items synced in both directions
          </P>
          <P><B>Disconnect:</B> Revokes access and stops syncing. Your tasks remain safe.</P>
        </Section>

        {/* 9. MCP Integration */}
        <Section title="9. MCP Integration" theme={theme}>
          <P><B>What is MCP?</B> Model Context Protocol lets AI assistants like Claude, Cursor, and others connect directly to StriveRS. Your AI can manage your tasks and schedule through natural conversation.</P>
          <P><B>Capabilities:</B> Through MCP, an AI assistant can:</P>
          <P style={{ paddingLeft: 12 }}>
            &bull; Create, update, and delete tasks with full scheduling options<br />
            &bull; Run the scheduler to auto-place tasks<br />
            &bull; Query your schedule, projects, and configuration<br />
            &bull; Set task statuses and manage dependencies<br />
            &bull; Batch create multiple tasks at once
          </P>
          <P><B>Compatible with:</B> Claude Code, Claude Desktop, Cursor, and any MCP-compatible client.</P>
          <P><B>Setup:</B> The MCP server runs locally and connects to your StriveRS backend. Add the server config to your AI client&apos;s MCP settings and authenticate with your token.</P>
        </Section>

        {/* 10. Keyboard Shortcuts */}
        <Section title="10. Keyboard Shortcuts" theme={theme}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {SHORTCUTS.map(function(s, i) {
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6 }}>
                  <kbd style={{
                    background: darkMode ? '#334155' : '#E2E8F0', color: theme.text,
                    padding: '2px 8px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace',
                    fontWeight: 600, minWidth: 120, textAlign: 'center',
                    border: '1px solid ' + theme.border
                  }}>{s.key}</kbd>
                  <span style={{ fontSize: 12, color: theme.textSecondary }}>{s.desc}</span>
                </div>
              );
            })}
          </div>
        </Section>

        {/* 11. Tips */}
        <Section title="11. Tips" theme={theme}>
          <P>&bull; Click hour labels in Day view to change the location for that hour.</P>
          <P>&bull; Drag tasks between days, times, or priority columns.</P>
          <P>&bull; Use &#x2713;hab to batch-mark all habits done for the day.</P>
          <P>&bull; Ctrl/Cmd + scroll to zoom the timeline grid.</P>
          <P>&bull; Pinch to zoom on mobile.</P>
          <P>&bull; Hover over any button or badge for a tooltip explaining what it does.</P>
        </Section>

      </div>
    </div>
  );
}
