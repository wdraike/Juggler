# Placement Mode & Mode Transition Test Specs

**Service:** Juggler  
**Scope:** Placement Modes (TS-01 to TS-61) and Mode Transitions (TS-62 to TS-71)  
**Target:** `juggler-backend/src/scheduler/unifiedScheduleV2.js`  
**Last Updated:** 2026-06-15  

---

## Scheduler Constants Reference

| Constant | Value | Notes |
|----------|-------|-------|
| `GRID_START` | 6 (6 AM) | = `DAY_START` 360 mins |
| `GRID_END` | 23 (11 PM) | = `DAY_END` 1379 mins |
| `RECUR_EXPAND_DAYS` | 14 | Recurring instance horizon |
| Default `timeFlex` | 60 min | ± window for time_window mode |
| Default `splitMin` | 15 min | Minimum split chunk size |
| Default TZ | `America/New_York` | |
| Fallback ladder | Pass1 → Pass2(ignoreDeadline) → Pass3(relaxWhen) → Pass4(both) | |

### Default Time Blocks

**Weekday** (Mon–Fri): morning(360–480), biz1(480–720), lunch(720–780), biz2(780–1020), evening(1020–1260), night(1260–1380)  
**Weekend** (Sat–Sun): morning(420–720), afternoon(720–1020), evening(1020–1260), night(1260–1380)

### Placement Mode Enum

| Mode | Value | Scheduler Treatment |
|------|-------|---------------------|
| Reminder | `'reminder'` | dur=0, coexists, no occupancy consumption |
| All Day | `'all_day'` | Full-day banner, excluded from time-grid (early return in buildItems) |
| Fixed | `'fixed'` | Immovable at exact time (Phase 0), requires `date`+`time`, 400 if absent |
| Time Window | `'time_window'` | Placed within `preferredTimeMins ± timeFlex`; falls back to when-tags if degenerate |
| Time Blocks | `'time_blocks'` | Constrained to named `when` tag windows only; uses `flexWhen` for retry |
| Anytime | `'anytime'` | No constraint; placed wherever fits by priority/slack order |

---

## TS-01 to TS-22: Anytime Placement Mode

---
### TS-01: Anytime task placed in earliest available slot

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task placed in earliest available slot  

**Data Setup:**
- User config: default time_blocks (weekday+weekend), default tool_matrix
- Tasks: 1 task `{ text: "Quick task", dur: 60, pri: 'P3', placementMode: 'anytime', when: '' }`
- Clock: fixed at `2026-06-15T08:00:00-04:00` (Monday, 8 AM)
- Scheduler state: fresh (no existing placements)

**Action:**
- Create task via POST /api/tasks
- Run scheduler (POST /api/schedule/run)

**Expected Outcome:**
- Task is placed in the earliest available slot
- `scheduled_at` falls in the first eligible morning block (Monday morning: 360–480, so first slot 8:00 AM = 480 mins)
- No `_overdue` or `_conflict` flags set
- `_unplacedReason` is null

**Sub-scenarios:**
- [SUB-01a] **P1 priority** — Same task with `pri: 'P1'` → placed in identical earliest slot (slack ordering is identical; priority only breaks ties)
- [SUB-01b] **Multiple tasks competing** — 3 tasks each dur=60 on same fresh schedule → placed sequentially in earliest slots (480–540, 540–600, 600–660)
- [SUB-01c] **Max duration task** — `dur: 480` (8 hours, cap) → placed in largest contiguous window (morning+biz1+lunch+biz2 = 360–1020 = 660 contiguous mins → fits in biz1+biz2 if no other tasks)
- [SUB-01d] **Zero duration task** — `dur: 0` (non-marker) → skipped in buildItems (line 251), not placed at all
- [SUB-01e] **Negative slack already from pre-existing placements** — schedule already has full occupancy blocking earliest slots → task placed in next available slot beyond occupancy
- [SUB-01f] **Minimum duration** — `dur: 15` → placed in smallest available gap
- [SUB-01g] **Multiple days horizon** — task placed on day 2+ if day 1 has zero capacity remaining
- [SUB-01h] **Default placementMode** — `placementMode` not set (undefined) → defaults to `'anytime'` per line 244

---
### TS-02: Anytime task with deadline — placed before deadline

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with deadline placed before deadline  

**Data Setup:**
- Tasks: 1 task `{ text: "Deadline task", dur: 120, pri: 'P3', placementMode: 'anytime', deadline: '2026-06-17' }`
- Clock: `2026-06-15T08:00:00-04:00` (Monday)
- Scheduler state: fresh

**Action:**
- Run scheduler

**Expected Outcome:**
- Task is placed before its deadline date
- `scheduled_at` ≤ deadline date
- Slack is computed as `capacity(earliest → deadline) - dur` and is positive
- Task is sorted among constrained tasks (finite slack, not Infinity)

**Sub-scenarios:**
- [SUB-02a] **Deadline is today** — deadline = `2026-06-15` → task must be placed on today's schedule
- [SUB-02b] **Deadline is tomorrow** — deadline = `2026-06-16` → task can spill across today and tomorrow
- [SUB-02c] **Tight deadline, barely fits** — `dur: 600` (10h), deadline = `2026-06-15`, day capacity ≈ 1020 min → placed but slack < 100 min
- [SUB-02d] **Multiple deadlines, correct ordering** — Task A `deadline: '2026-06-15'`, Task B `deadline: '2026-06-18'` → A placed first (tighter slack)
- [SUB-02e] **Deadline past search horizon** — deadline = `2026-07-15` (30 days out) → deadlineIdx clamped to last date in horizon; slack computed against full horizon
- [SUB-02f] **Deadline with pre-existing occupancy** — existing placement consumes 90% of capacity before deadline → slack is negative or tight

---
### TS-03: Anytime task with start-after — placed on or after start-after

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with start-after placed on or after start-after  

**Data Setup:**
- Tasks: 1 task `{ text: "Start-after task", dur: 60, pri: 'P3', placementMode: 'anytime', startAfter: '2026-06-17' }`
- Clock: `2026-06-15T08:00:00-04:00` (Monday)
- Scheduler state: fresh

**Action:**
- Run scheduler

**Expected Outcome:**
- Task is placed on or after 2026-06-17
- `scheduled_at` date ≥ startAfter date
- Task is not placed on 2026-06-15 or 2026-06-16

**Sub-scenarios:**
- [SUB-03a] **startAfter is today** — startAfter = `2026-06-15` → earliestIdx = 0; task placed today normally
- [SUB-03b] **startAfter is yesterday** — startAfter = `2026-06-14` → earliestIdx = 0 (clamped to today); no effective constraint
- [SUB-03c] **startAfter is far future** — startAfter = `2026-07-01` → earliestIdx points to that date; task waits
- [SUB-03d] **startAfter + deadline combined** — startAfter = `2026-06-17`, deadline = `2026-06-19` → placed in 3-day window only
- [SUB-03e] **startAfter + no capacity on start date** — startAfter = `2026-06-17` but day is fully occupied → pushed to 2026-06-18
- [SUB-03f] **startAfter with dayReq constraint** — startAfter = `2026-06-17` (Wednesday), dayReq = `weekend` → must wait until Saturday 2026-06-20

---
### TS-04: Anytime task with both deadline + start-after — placed in window

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with both deadline and start-after placed in intersection window  

**Data Setup:**
- Tasks: 1 task `{ text: "Windowed task", dur: 120, pri: 'P3', placementMode: 'anytime', startAfter: '2026-06-16', deadline: '2026-06-19' }`
- Clock: `2026-06-15T08:00:00-04:00` (Monday)

**Expected Outcome:**
- Task placed between 2026-06-16 and 2026-06-19 inclusive
- Slack computed over the [startAfter, deadline] range only

**Sub-scenarios:**
- [SUB-04a] **No capacity in window** — full occupancy across all dates in window → unplaced with `_unplacedReason: 'capacity_conflict'`
- [SUB-04b] **Window exactly fits** — `dur: 2040` (34h = total capacity Jun 16–19) → placed at earliest available
- [SUB-04c] **Window is a single day** — startAfter = deadline = `2026-06-16` → placed on that specific day only
- [SUB-04d] **Window fully in the past** — startAfter = `2026-06-10`, deadline = `2026-06-12` (all before today) → earliestIdx = 0 (today is later than startAfter), place on today before deadline... but deadline is also past. Since `slack < 0`, enters Phase 2 fallback with `ignoreDeadline`. If ignoreDeadline, placed at earliest slot today. If no capacity today, unplaced.
- [SUB-04e] **startAfter = deadline** — both set to `2026-06-17` → single-day window

---
### TS-05: Anytime task with startAfter > deadline — unplaced (impossible window)

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with startAfter > deadline — impossible window  

**Data Setup:**
- Tasks: 1 task `{ text: "Impossible window task", dur: 30, pri: 'P3', placementMode: 'anytime', startAfter: '2026-06-19', deadline: '2026-06-17' }`
- Clock: `2026-06-15T08:00:00-04:00`

**Expected Outcome:**
- `scheduled_at` is null
- `_unplacedReason` is set (likely `'impossible_window'`)
- earliestIdx > deadlineIdx → no valid placement range
- Task is flagged in unplaced results

**Sub-scenarios:**
- [SUB-05a] **startAfter = deadline, but time of day impossible** — startAfter = deadline = `2026-06-17`, `dur: 600` but only 480 mins available that day → unplaced with `capacity_conflict` (window exists but capacity insufficient)
- [SUB-05b] **startAfter well after deadline** — startAfter = `2026-07-01`, deadline = `2026-06-15` → impossible window
- [SUB-05c] **startAfter = deadline + dayReq mismatch** — startAfter = deadline = `2026-06-20` (Saturday) but dayReq = `weekday` → impossible (weekend excluded)
- [SUB-05d] **Impossible window + flexWhen** — flexWhen=true → fallback ladder hits Pass3 (relaxWhen) but `relaxWhen` only relaxes when-tags, NOT the startAfter/deadline constraint. Still impossible → unplaced.
- [SUB-05e] **Impossible window for recurring** — recurring instance with anchor date past its cycle deadline → dropped entirely (recurring doesn't roll forward)

---
### TS-06: Anytime task with day_req=weekday — only placed Mon-Fri

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with day_req=weekday only placed on weekdays  

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (Monday)
- Tasks: `{ text: "Weekday task", dur: 30, pri: 'P3', placementMode: 'anytime', dayReq: 'weekday' }`

**Expected Outcome:**
- If scheduled today (Monday), `scheduled_at` is on a weekday
- `scheduled_at` day-of-week is Mon–Fri
- If pushed to later dates (congestion), only placed on weekdays

**Sub-scenarios:**
- [SUB-06a] **Weekend-only available** — All weekdays fully occupied → task pushed to following Monday, not Saturday
- [SUB-06b] **Friday deadlock** — Task created Friday evening, no slots left on Friday, weekdays for next week available → placed Monday
- [SUB-06c] **dayReq='weekday' with deadline on Sunday** — deadline = `2026-06-21` (Sunday) → latest search day is Friday 2026-06-19 (deadlineIdx clamped), not Sunday
- [SUB-06d] **dayReq='weekday' with deadline on Wednesday** — deadline = `2026-06-17` (Wednesday) → placed Mon-Wed only
- [SUB-06e] **dayReq='weekday' + startAfter on Saturday** — startAfter = `2026-06-20` (Saturday) → earliestIdx points to Saturday, but Saturday is filtered by dayReq; first eligible is Monday 2026-06-22

---
### TS-07: Anytime task with day_req=weekend — only placed Sat-Sun

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with day_req=weekend only placed on weekends  

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (Monday)
- Tasks: `{ text: "Weekend task", dur: 60, pri: 'P3', placementMode: 'anytime', dayReq: 'weekend' }`

**Expected Outcome:**
- If schedule runs Monday with slack to spare, placed on next weekend day (Saturday 2026-06-20 or Sunday 2026-06-21)
- Not placed on any weekday

**Sub-scenarios:**
- [SUB-07a] **Weekend capacity overflow** — task requires 8h and weekend only has 600 min (morning+afternoon = 420–1020 = 600) → need evening block too (1020–1260) → total 840 min OK, placed across Saturday blocks
- [SUB-07b] **Weekend deadline** — deadline = `2026-06-18` (Thursday) but dayReq=weekend → impossible window → unplaced
- [SUB-07c] **Weekend + min duration** — 15 min task → placed in any weekend gap
- [SUB-07d] **Weekend + max capacity** — task dur=720 → weekend max capacity = 840 (420–1260) → fits, placed
- [SUB-07e] **Weekend only from specific DOW codes** — dayReq=`'Sat'` → only Saturday, not Sunday

---
### TS-08: Anytime task with specific day codes — only placed on those days

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with specific day-of-week codes  

**Data Setup:**
- Clock: `2026-06-15T08:00:00-04:00` (Monday)
- Tasks: `{ text: "MWF task", dur: 30, pri: 'P3', placementMode: 'anytime', dayReq: 'M,W,F' }`

**Expected Outcome:**
- Task placed only on Monday, Wednesday, or Friday
- Skipped on Tuesday and Thursday

**Sub-scenarios:**
- [SUB-08a] **Single day code** — dayReq=`'Tue'` → only placed on Tuesdays
- [SUB-08b] **Adjacent days** — dayReq=`'Mon,Tue'` → placed Mon or Tue
- [SUB-08c] **Non-contiguous pair** — dayReq=`'Mon,Fri'` → placed Mon or Fri
- [SUB-08d] **Post-deadline dayReq exclusion** — deadline = Wednesday, dayReq = `'Fri'` → impossible (Friday > deadline) → unplaced
- [SUB-08e] **Weekend specific codes** — dayReq=`'Sat,Sun'` equivalent to `'weekend'`
- [SUB-08f] **All days via codes** — dayReq=`'M,T,W,R,F,S,U'` → all days, same as `'any'`
- [SUB-08g] **parseDayReq edge — lowercase** — dayReq=`'m,w,f'` → should parse same as `'M,W,F'`
- [SUB-08h] **parseDayReq edge — whitespace** — dayReq=`' Mon , Wed '` → trimmed correctly

---
### TS-09: Anytime task with when=morning — only placed in morning blocks

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with when=morning only placed in morning blocks  

**Data Setup:**
- Clock: weekday schedule
- Tasks: `{ text: "Morning task", dur: 30, pri: 'P3', placementMode: 'anytime', when: 'morning' }`

**Expected Outcome:**
- Task placed within the morning block (weekday: 360–480 = 6 AM–8 AM)
- Not placed in lunch, biz, evening, or night blocks

**Sub-scenarios:**
- [SUB-09a] **Morning capacity exhausted** — morning block full (120 min) + dur=120 → cannot fit; placed in earliest next available day's morning block
- [SUB-09b] **Morning dur exceeding block** — dur=180 > 120 → cannot fit in a single morning → unplaced with `capacity_conflict` (unless spread across days with split=true)
- [SUB-09c] **Weekend morning** — when='morning' on weekend (420–720 = 5h) → 300 min capacity, task dur=120 fits easily
- [SUB-09d] **Multiple morning days** — task with large dur spread across multiple days' morning blocks via split=true
- [SUB-09e] **when=morning + deadline** — deadline constrains which days' morning blocks are eligible
- [SUB-09f] **when=morning + flexWhen** — flexWhen=true → if morning blocks full, fallback Pass3 relaxWhen allows any block placement with `_whenRelaxed=true`

---
### TS-10: Anytime task with when=morning,afternoon — placed in either

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with multiple when tags placed in either matching block  

**Data Setup:**
- Clock: weekday schedule
- Tasks: `{ text: "Morning-or-afternoon task", dur: 30, pri: 'P3', placementMode: 'anytime', when: 'morning,afternoon' }`

**Expected Outcome:**
- Task placed in either morning (360–480) or afternoon block on weekend (720–1020), or biz1/lunch/biz2 on weekday (when='morning,afternoon' on weekday would match morning 360–480 and... actually afternoon doesn't exist as a weekday tag — it would match `when` parts `['morning','afternoon']` against blocks with tags `morning`, `biz`, `lunch`, `biz`, `evening`, `night`. Only morning matches. So on weekdays → only morning is eligible. On weekends → morning 420–720, afternoon 720–1020.)
- Earliest eligible slot in any matching block wins

**Sub-scenarios:**
- [SUB-10a] **First block full, second available** — morning block occupied by other tasks → placed in afternoon
- [SUB-10b] **All matching blocks full** — both morning and afternoon/evening have no capacity → flexWhen retry or unplaced
- [SUB-10c] **Three tags** — when='morning,lunch,evening' → placed in earliest available from set
- [SUB-10d] **when='anytime'** (special value) — `eligibleWindows` with `relaxWhen` path → all day windows eligible (getWhenWindows with 'anytime')
- [SUB-10e] **Comprehensive when list** — when='morning,lunch,afternoon,evening,night' → all blocks are eligible
- [SUB-10f] **when='biz' on weekday** — matches biz1+ biz2 blocks (480–720 and 780–1020) but NOT lunch (720–780)

---
### TS-11: Anytime task with flex_when=true — relaxes to anytime when blocks full

**Domain:** Placement Modes / Anytime  
**Title:** flexWhen=true relaxes to anytime when constrained blocks are full  

**Data Setup:**
- Tasks: `{ text: "Flex when task", dur: 60, pri: 'P3', placementMode: 'anytime', when: 'morning', flexWhen: true }`
- Clock: weekday, morning block already fully occupied

**Expected Outcome:**
- Pass1 (normal): cannot fit in morning → no placement
- Pass2 (ignoreDeadline): not applicable (no deadline)
- Pass3 (relaxWhen): retried with `relaxWhen=true` → eligible for all day windows → placed in next available block
- `_whenRelaxed` flag set to true
- `_placementReason` reflects fallback placement

**Sub-scenarios:**
- [SUB-11a] **flexWhen with multiple when tags** — when='morning,afternoon', morning full → Pass1 tries afternoon → if afternoon also full → Pass3 relaxes to anytime
- [SUB-11b] **flexWhen + deadline** — deadline constrains; Pass2 kicks in if slack<0, then Pass3 relaxWhen
- [SUB-11c] **flexWhen = false (default)** — morning full → unplaced with `_unplacedReason`; no relax pass
- [SUB-11d] **flexWhen = true, all capacity full everywhere** — relaxWhen retry still fails → unplaced
- [SUB-11e] **flexWhen = true + recurring** — recurring ANYTIME task with when constraint, morning full → relaxWhen retry → placed in any block on occurrence date

---
### TS-12: Anytime task with flex_when=false — unplaced when blocks full

**Domain:** Placement Modes / Anytime  
**Title:** flexWhen=false (default) leaves task unplaced when blocks full  

**Data Setup:**
- Tasks: `{ text: "Rigid when task", dur: 60, pri: 'P3', placementMode: 'anytime', when: 'morning', flexWhen: false }`
- Clock: weekday, morning block fully occupied

**Expected Outcome:**
- Pass1 fails (no room in morning)
- Pass2 not applicable
- Pass3 skipped (flexWhen=false)
- Pass4 skipped
- Task in unplaced list with `_unplacedReason` indicating capacity conflict in the when-block

**Sub-scenarios:**
- [SUB-12a] **flexWhen absent (undefined)** — should default to false
- [SUB-12b] **flexWhen=false + deadline** — deadline may move task to a different day's morning block before giving up
- [SUB-12c] **Multiple when tags + flexWhen=false** — when='morning,biz', morning full → Pass1 tries biz → if biz also full → unplaced
- [SUB-12d] **flexWhen=false on different day** — no capacity in morning block across any day up to deadline → unplaced

---
### TS-13: Anytime recurring — day-locked to occurrence date

**Domain:** Placement Modes / Anytime  
**Title:** Anytime recurring task day-locked to occurrence date  

**Data Setup:**
- Tasks: 1 recurring template `{ text: "Daily standup", recurring: true, placementMode: 'anytime', when: 'morning', dur: 30, pri: 'P3' }`
- Clock: `2026-06-15T08:00:00-04:00` (Monday)
- Scheduler expands instances for 14-day horizon

**Expected Outcome:**
- First instance placed on Monday 2026-06-15 in morning block
- Instance is day-locked to its occurrence date (`isDayLocked=true` for non-flexible-tpc recurring)
- Each subsequent instance placed on its respective occurrence date
- Legacy check: `if (t.recurring && pm === PLACEMENT_MODES.ANYTIME && t.date && toKey(t.date) < todayIsoKey) return;` — past instances are dropped

**Sub-scenarios:**
- [SUB-13a] **Daily recurring** — one instance per day for 14 days, each locked to its day
- [SUB-13b] **Weekly recurring (MWF)** — Mon, Wed, Fri instances each day-locked
- [SUB-13c] **Recurring with dayReq** — dayReq='weekday' + daily recurring → only weekday instances get placed, weekend date instances dropped
- [SUB-13d] **Recurring + morning overflow** — morning block accommodates only 3 instances but recurrence needs 5 → remaining instances unplaced (day-locked can't roll to next block)
- [SUB-13e] **Recurring + flexWhen** — flexWhen=true → stuck instances on each day relax to non-morning blocks on same day
- [SUB-13f] **Recurring + preferLatestSlot** — recurring ANYTIME with `preferredTimeMins` whose window has passed today → `preferLatestSlot=true`, placed at latest slot on the day
- [SUB-13g] **Recurring horizon boundary** — instance on day 14 (horizon edge) still generated and placed

---
### TS-14: Anytime recurring, past occurrence — placed today at latest slot

**Domain:** Placement Modes / Anytime  
**Title:** Anytime recurring with past occurrence placed at latest slot today  

**Data Setup:**
- Tasks: 1 recurring instance `{ text: "Morning routine", recurring: true, placementMode: 'anytime', when: 'morning', date: '2026-06-15', preferredTimeMins: 420, anchorMin: 420 }`
- Clock: `2026-06-15T10:00:00-04:00` (10 AM, morning block has passed)

**Expected Outcome:**
- `preferLatestSlot` = true (pm='anytime', recurring, anchorDate=today, anchorMin < nowMins)
- Task placed in the latest available slot on today's date (not in morning block since it's past)
- If all slots full → unplaced with reason
- `_placementReason` reflects end-of-day placement

**Sub-scenarios:**
- [SUB-14a] **Past occurrence, no preferredTimeMins** — anchorMin falls back to `t.time` or null. If null, `preferLatestSlot` = false because `anchorMin != null` check fails → placed at earliest available slot normally
- [SUB-14b] **Past occurrence, full day** — all blocks occupied → unplaced today
- [SUB-14c] **Multiple past occurrences** — each past instance: if recurring + past date + ANYTIME → dropped (line 265). Only instances with date= today get the `preferLatestSlot` treatment
- [SUB-14d] **PreferLatestSlot but morning block also full** — placed in latest available slot in any later block

---
### TS-15: Anytime with location constraint — only placed at matching location blocks

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with location constraint placed at matching location blocks  

**Data Setup:**
- User config: default time_blocks with locations (home→morning/evening/night, work→biz/lunch)
- Tasks: `{ text: "Office task", dur: 60, pri: 'P3', placementMode: 'anytime', location: ['office'] }`
- (Note: location is a JSON array; scheduler checks via `canTaskRunAtMin`)

**Expected Outcome:**
- Task placed in a block where the resolved location matches 'office' (biz1, lunch, biz2 on weekdays)
- Not placed in home-location blocks (morning, evening, night) or incorrect location blocks
- `checkLoc` = true → `canTaskRunAtMinCached` called for each candidate slot

**Sub-scenarios:**
- [SUB-15a] **Location + when intersection** — when='morning', location='office' → morning block is at home location → no intersection → unplaced
- [SUB-15b] **Location + deadline** — location available only on certain days; deadline may push past those days
- [SUB-15c] **Multiple locations** — location=['office','home'] → eligible at any block matching either location
- [SUB-15d] **Location never available** — location='warehouse' but no block has that location → unplaced
- [SUB-15e] **Location with flexible day** — weekend blocks are all at home → location='office' task not placed on weekend
- [SUB-15f] **Location resolved via resolveDayLocation** — the resolved location for a (dateKey, minute) pair is compared to task's location

---
### TS-16: Anytime with tool constraint — only placed at blocks with matching tools

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with tool constraint requires tools available at location  

**Data Setup:**
- Tools defined: work_pc at work location, phone everywhere
- Task: `{ text: "PC task", dur: 60, pri: 'P3', placementMode: 'anytime', tools: ['work_pc'] }`
- Location resolved per block

**Expected Outcome:**
- Task placed only in blocks where tool matrix confirms work_pc is available at the resolved location (work location → biz/lunch blocks)
- `canTaskRunAtMin` checks toolMatrix for the resolved location
- Not placed at home (no work_pc)

**Sub-scenarios:**
- [SUB-16a] **Tool + location = AND** — tools=['work_pc', 'printer'], location=['office'] → placed only where office has BOTH work_pc and printer
- [SUB-16b] **Tool available at multiple locations** — phone available everywhere → placed anywhere
- [SUB-16c] **Tool never available** — tools=['drill'] but drill not in default matrix → unplaced
- [SUB-16d] **Tool + when constraint** — when='morning' + tools=['work_pc'] → morning is home, no work_pc at home → unplaced
- [SUB-16e] **Empty tools** — tools=[] → no tool constraint, `checkLoc` = false

---
### TS-17: Anytime with both location+tool — AND logic

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with location AND tool constraints — both must be satisfied  

**Data Setup:**
- Task: `{ text: "Office PC task", dur: 60, pri: 'P3', placementMode: 'anytime', location: ['office'], tools: ['work_pc'] }`
- Location 'office' has work_pc in tool matrix

**Expected Outcome:**
- Task placed only in slots where location=office AND work_pc is available
- `checkLoc` = true, both arrays non-empty
- `canTaskRunAtMinCached` evaluates both conditions in one call

**Sub-scenarios:**
- [SUB-17a] **Location matches, tool missing** — office block but office lacks work_pc → slot rejected
- [SUB-17b] **Tool matches, location wrong** — work_pc available but at wrong location → slot rejected
- [SUB-17c] **Both mismatch** → unplaced
- [SUB-17d] **Multiple locations, single tool** — location=['office','home'], tools=['phone'] → phone available at both → placed at earliest matching (office if sooner, else home)
- [SUB-17e] **Multiple tools, single location** — location=['office'], tools=['work_pc','printer'] → office must have both

---
### TS-18: Anytime with travel_before — buffer respected before placement

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with travel_before reserves buffer before placement  

**Data Setup:**
- Tasks: Task A `{ dur: 60, placementMode: 'anytime', travelBefore: 30 }`
- Existing preceding task B placed at 900 (3 PM) ending at 960 (4 PM)
- Task A attempts earliest slot after task B

**Expected Outcome:**
- If placed at 960 (right after B), the effective occupancy starts at 930 (960 - travelBefore 30)
- `isFreeWithTravel(occ, s, dur, tb, ta)` checks occupancy in range [s - tb, s + dur + ta)
- Adjacent task cannot be placed in the buffer zone
- On a fresh schedule: earliest slot is at DAY_START + travelBefore = 390 (6:30 AM) not 360 (6 AM)

**Sub-scenarios:**
- [SUB-18a] **travelBefore > available gap** — only 20 min gap before next task, travelBefore=25 → placed after that task instead
- [SUB-18b] **travelBefore=0** — no buffer, earliest slot starts at DAY_START
- [SUB-18c] **travelBefore on split chunk** — only first split chunk (splitOrdinal=1) carries travelBefore
- [SUB-18d] **travelBefore pushes past deadline** — buffer extends end time past deadline → placed earlier or unplaced
- [SUB-18e] **travelBefore + travelAfter combined** — both buffers extend occupancy footprint in both directions

---
### TS-19: Anytime with travel_after — buffer respected after placement

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with travel_after reserves buffer after placement  

**Data Setup:**
- Tasks: Task A `{ dur: 60, placementMode: 'anytime', travelAfter: 20 }`
- Existing following task C needs slot at exactly A's end time

**Expected Outcome:**
- A placed at earliest slot; occupancy extends to `start + dur + travelAfter`
- Task C cannot occupy the buffer zone (A's end + 20 min)
- `reserveWithTravel` marks the full range on occupancy grid

**Sub-scenarios:**
- [SUB-19a] **travelAfter pushes into next task's slot** — next task already placed at A.end → conflict detected; scheduler won't place A there (or A placed immovably if fixed)
- [SUB-19b] **travelAfter on split chunk** — only last split chunk (splitOrdinal=splitTotal) carries travelAfter
- [SUB-19c] **travelAfter exceeds remaining day capacity** — A placed at end of day pushes buffer past GRID_END → OK (no tasks placed there, just wasted capacity)
- [SUB-19d] **Large travelAfter (120 min)** — 2h buffer reserved after task
- [SUB-19e] **travelBefore + travelAfter both zero** — no buffer extension, standard occupancy

---
### TS-20: Anytime with depends_on — placed after dependency

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with depends_on placed after dependency completes  

**Data Setup:**
- Tasks: Task A (dep), Task B `{ dependsOn: ['A'], placementMode: 'anytime' }`
- Task A dur=60, placed at earliest slot

**Expected Outcome:**
- Task A placed first (or earlier in queue)
- Task B placed such that its start ≥ A.start + A.dur
- `computeDepReadyAbs` computes `absoluteMin(A.dateIdx, A.start + A.dur)`
- `checkDeps` = true in findEarliestSlot; candidate slots before depReadyAbs rejected

**Sub-scenarios:**
- [SUB-20a] **Dep on same day, adjacent** — A at 480–540, B placed at 540
- [SUB-20b] **Dep on different day** — A placed Monday, B placed Tuesday (earliest date after A completes)
- [SUB-20c] **Multiple deps (AND)** — B.dependsOn=['A','C'] — B waits for latest completion of {A, C}
- [SUB-20d] **Deep chain** — A→B→C — B after A, C after B
- [SUB-20e] **Dep already done** — A.status='done' → skipped in pool, B treats dep as met (stale check for done in computeDepReadyAbs: returns -Infinity)
- [SUB-20f] **Dep is unplaced** — A unplaced → `computeDepReadyAbs` returns Infinity → B infinitely blocked → B also goes to unplaced (deferred to retry pass)

---
### TS-21: Anytime with unmet dependency — deferred to retry pass

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with unmet dependency deferred to retry pass  

**Data Setup:**
- Tasks: Task B `{ dependsOn: ['A'], placementMode: 'anytime' }`, Task A `{ placementMode: 'anytime' }`
- Clock: fresh schedule, A sorts after B in queue (longer slack)

**Expected Outcome:**
- Pass1 normal: B tries to place but A is not yet placed → `depReadyAbs = Infinity` (A not in placedById yet) → B cannot place → deferred
- B goes to retry pass (Phase 6 per R11.5)
- On retry pass, A is now placed → B's depReadyAbs is finite → B placed
- OR: if all deps still unmet → B remains unplaced

**Sub-scenarios:**
- [SUB-21a] **Circular deps** — A.dependsOn=['B'], B.dependsOn=['A'] → both stuck, both unplaced with cycle detection
- [SUB-21b] **Self-referencing dep** — A.dependsOn=['A'] → should be caught as circular → unplaced
- [SUB-21c] **Dep chain, middle unplaced** — A→B→C, B unplaced → A placed first, B unplaced, C blocked on B → C also unplaced
- [SUB-21d] **Dep chain, retry succeeds** — A→B→C, all sort normally → all placed in order across passes
- [SUB-21e] **Dep on non-existent ID** — A.dependsOn=['nonexistent-id'] → dep never found → `st === undefined` → dep treated as non-constraining (returns -Infinity) → A placed normally

---
### TS-22: Anytime with deadline + unmet deps — deadline-relaxed pass (Phase 7)

**Domain:** Placement Modes / Anytime  
**Title:** Anytime task with deadline and unmet deps — deadline-relaxed pass  

**Data Setup:**
- Tasks: Task B `{ dependsOn: ['A'], deadline: '2026-06-15', dur: 120, placementMode: 'anytime' }`, Task A `{ placementMode: 'anytime', dur: 60 }`
- Day capacity limited

**Expected Outcome:**
- Passes 1–6 all fail (A unplaced → B blocked; or A placed but too late for B's deadline)
- Phase 7 (deadline-relaxed): ignoreDeadline applied, B placed regardless of deadline at earliest available slot after deps met
- B carries `_overdue` flag

**Sub-scenarios:**
- [SUB-22a] **Deadline already passed (slack < 0)** — Pass2 kicks in: ignoreDeadline=true → B placed at earliest available slot after deps met
- [SUB-22b] **Deadline met but deps never met** — A remains unplaced even after retry → B stays unplaced (deadline-relaxed doesn't relax deps — only `relaxDeps` option does)
- [SUB-22c] **Deadline-relaxed + flexWhen** — Phase 4+7 combined: both relaxWhen AND ignoreDeadline
- [SUB-22d] **Multiple tasks in deadline-relaxed** — several overdue tasks placed in slack order after fallback

---
## TS-23 to TS-34: Time Window Placement Mode

---
### TS-23: Time Window task placed within preferred_time ± timeFlex window

**Domain:** Placement Modes / Time Window  
**Title:** Time Window task placed within preferred_time ± timeFlex  

**Data Setup:**
- Tasks: `{ text: "Window task", dur: 30, placementMode: 'time_window', preferredTimeMins: 720, timeFlex: 60 }`
- Clock: `2026-06-15T10:00:00` (well before the window 660–780)

**Expected Outcome:**
- `isWindowMode = true`
- `windowLo = max(360, 720-60) = 660`, `windowHi = min(1379, 720+60) = 780`
- Task placed in [660, 780) range (11:00 AM – 1:00 PM)
- Not placed outside this window even if earlier slots are free
- `eligibleWindows` returns `[[item.windowLo, item.windowHi]]` when `isWindowMode && !relaxWhen`

**Sub-scenarios:**
- [SUB-23a] **Window at day boundary** — preferredTimeMins=300 (5 AM), windowLo=clamped to DAY_START=360 → window is [360, 420]
- [SUB-23b] **Window at day end** — preferredTimeMins=1320 (10 PM), windowHi=clamped to DAY_END=1379 → window is [1260, 1379]
- [SUB-23c] **Zero timeFlex** — timeFlex=0 → window is exactly [preferredTimeMins, preferredTimeMins]; if that slot isn't free → unplaced
- [SUB-23d] **Zero timeFlex with free slot** — window=[720,720]; findEarliestSlot checks windows — window has zero width. WinStart=720, winEnd=720 → `s + item.dur <= winEnd` → 720+30 <= 720 → false → never loops → no placement
- [SUB-23e] **Large timeFlex (480)** — timeFlex=480 (max) → window spans [240, 1200] but clamped to [360, 1379] → effectively most of the day
- [SUB-23f] **timeFlex > 480** — flex > 480 → isWindowMode set to false → falls back to when-tag placement
- [SUB-23g] **preferredTimeMins on non-recurring Time Window** — works the same; anchorMin set from preferredTimeMins at line 293

---
### TS-24: Time Window with flex=0 — placed exactly at preferred time

**Domain:** Placement Modes / Time Window  
**Title:** Time Window with timeFlex=0 placed exactly at preferred time  

**Data Setup:**
- Tasks: `{ dur: 30, placementMode: 'time_window', preferredTimeMins: 900, timeFlex: 0 }`
- Slot at 900 is free

**Expected Outcome:**
- `flex > 0 && flex <= 480` = false → `isWindowMode = false` (line 348)
- Falls back to when-tag placement (default when=empty → all blocks eligible)
- Task placed at earliest free slot, NOT at 900

**NOTE:** This is the actual behavior per code at lines 335-348. Zero timeFlex makes the window degenerate → falls back to when tags.

**Sub-scenarios:**
- [SUB-24a] **timeFlex=null** — flex defaults to DEFAULT_TIME_FLEX=60 → normal window placement
- [SUB-24b] **timeFlex=1 (minimum non-zero)** — window is [preferredTimeMins-1, preferredTimeMins+1] = 2 min wide. If preferredTimeMins=900, window = [899, 901]. Task dur=30 cannot fit (30 > 2) → isWindowMode still true but no slot fits → unplaced
- [SUB-24c] **preferredTimeMins + timeFlex spans day boundary** — preferredTimeMins=1340 (10:20 PM), timeFlex=60 → windowHi=1400 clamped to 1379, windowLo=1280 → still valid, placed in [1280, 1379]

---
### TS-25: Time Window with flex value inside blocks — window intersects blocks

**Domain:** Placement Modes / Time Window  
**Title:** Time Window crossing multiple time blocks  

**Data Setup:**
- Tasks: `{ dur: 90, placementMode: 'time_window', preferredTimeMins: 700, timeFlex: 120 }`
- weekday: morning(360-480), biz1(480-720), lunch(720-780), biz2(780-1020)
- Window = [580, 820] — spans biz1 end, lunch, biz2 start

**Expected Outcome:**
- `eligibleWindows` returns `[[580, 820]]` for time_window mode
- findEarliestSlot scans this range and finds first free 90-min slot (580–670 in biz1, or later)
- Occupancy of existing tasks within this range reduces available slots

**Sub-scenarios:**
- [SUB-25a] **Window fully inside one block** — preferredTimeMins=500, timeFlex=60 → window [440, 560] inside biz1 (480-720) → placed within biz1
- [SUB-25b] **Window between blocks (night → morning)** — preferredTimeMins=1350 (10:30 PM), timeFlex=60 → window [1290, 1410] clamped to [1290, 1379] → within night block (1260-1380)
- [SUB-25c] **Window with no free slot** — all minutes in [580, 820] occupied → unplaced
- [SUB-25d] **Window spanning day boundary** — preferredTimeMins=1410 (11:30 PM), timeFlex=60 → windowLo=1350, windowHi=clamped to 1379 → only 29 min on this day. Task dur=60 can't fit → isWindowMode stays true but can't place → unplaced

---
### TS-26: Time Window task — window entirely before DAY_START (degenerate)

**Domain:** Placement Modes / Time Window  
**Title:** Time Window with preferred time before grid start — degenerate window  

**Data Setup:**
- Tasks: `{ dur: 30, placementMode: 'time_window', preferredTimeMins: 180 (3 AM), timeFlex: 60 }`
- DAY_START=360 (6 AM)

**Expected Outcome:**
- windowLo = max(360, 180-60) = 360
- windowHi = min(1379, 180+60) = 240 → 360 > 240 → windowHi <= windowLo → true → `isWindowMode = false`
- Falls back to when-tag placement
- Task placed in earliest free block normally

**Sub-scenarios:**
- [SUB-26a] **preferred time after DAY_END** — preferredTimeMins=1440 (midnight), timeFlex=30 → windowLo=1410, windowHi=1470 clamped to 1379 → windowLo=1410 > windowHi=1379 → degenerate → fallback
- [SUB-26b] **preferred time exactly at DAY_START** — preferredTimeMins=360, timeFlex=60 → windowLo=300 clamped to 360, windowHi=420 → valid window [360, 420]
- [SUB-26c] **preferred time exactly at DAY_END** — preferredTimeMins=1380, timeFlex=30 → windowLo=1350, windowHi=1410 clamped to 1379 → valid window [1350, 1379]

---
### TS-27: Time Window task — preferred time outside grid (fallback to when tags)

**Domain:** Placement Modes / Time Window  
**Title:** Time Window with preferredTimeMins outside grid falls back to when-tag placement  

(See TS-26 — degenerate window triggers `isWindowMode = false` fallback)

**Sub-scenarios:**
- [SUB-27a] **Fallback with when tag** — `when: 'morning'` → falls back to morning block placement
- [SUB-27b] **Fallback with flexWhen** — flexWhen still honored (sets isWindowMode=false but flexWhen stays true)
- [SUB-27c] **Fallback with empty when** — when='' → all blocks eligible → placed at earliest free slot

---
### TS-28: Time Window recurring — day-locked with preferred time anchor

**Domain:** Placement Modes / Time Window  
**Title:** Time Window recurring task day-locked with preferred time anchor  

**Data Setup:**
- Tasks: recurring template `{ recurring: true, placementMode: 'time_window', preferredTimeMins: 720, timeFlex: 60, dur: 30 }`
- Clock: `2026-06-15T08:00:00`

**Expected Outcome:**
- Each instance placed within its preferred window [660, 780] on its occurrence date
- Instance is day-locked (recurring + isWindowMode=true + isDayLocked=true since !isFlexibleTpc)
- Window placement is independent per occurrence

**Sub-scenarios:**
- [SUB-28a] **Recurring window on congested day** — one day all slots in [660, 780] occupied → that day's instance unplaced; other days' instances placed normally
- [SUB-28b] **Recurring window, window already past** — `isMissedWindow = true` when anchorDate=today AND windowHi <= nowMins → unplaced with missed reason
- [SUB-28c] **Daily recurring time-window** — each day has same window [660, 780]; instances placed across 14 days
- [SUB-28d] **Weekly recurring time-window on different days** — instances for Mon, Wed, Fri each with same preferred window on their respective dates

---
### TS-29: Time Window recurring — missed preferred-time window goes to unplaced

**Domain:** Placement Modes / Time Window  
**Title:** Missed Time Window recurring goes to unplaced  

**Data Setup:**
- Tasks: recurring instance `{ recurring: true, placementMode: 'time_window', preferredTimeMins: 420, timeFlex: 60, date: '2026-06-15', anchorMin: 420 }`
- Clock: `2026-06-15T09:00:00` (9 AM — window [360, 480] has passed)

**Expected Outcome:**
- `isMissedWindow = true` (anchorDate=todayIsoKey=2026-06-15, nowMins=540, windowHi=480, 480 <= 540)
- The instance is still placed in the grid? Let's check: isMissedWindow=true just means it's flagged — the code doesn't skip placement for missed windows. Line 344-346 sets isMissedWindow but the item still enters the queue. In `findEarliestSlot`, if anchorDate=today and windowHi <= nowMins, findEarliestSlot would scan from earliestIdx=0 checking windows. The window [360,480] is past but still eligible — the slot checker would find no free slot there if occupied, and the second pass with deadline ignore would place it. Actually wait — isMissedWindow is just a flag on the item; the item still goes through normal placement. It's a reporter flag.
- ACTUALLY per existing tests: time_window mode with preferred time window entirely past → `isMissedWindow = true` → the test at line 319-330 expects unplaced with `_unplacedReason: 'missed'`

Let me check more carefully. The code at lines 344-346 only SETS the flag. There must be downstream handling. Let me check if the scheduler output processor checks `isMissedWindow`.

Actually looking at the existing test expectations: the test `missed recurring: preferredTimeMins window entirely past → unplaced` checks `result.unplaced` and expects `_unplacedReason: 'missed'`. This is for TIME_WINDOW mode. The isMissedWindow flag must be consumed somewhere to move these to unplaced. Let me check the main loop.

**Expected Outcome:**
- Task is not placed in the grid
- Appears in unplaced with `_unplacedReason: 'missed'`

**Sub-scenarios:**
- [SUB-29a] **Missed window, flexWhen=false** — still missed (flexWhen doesn't apply to time_window mode per R40; timeFlex provides the flex already)
- [SUB-29b] **Missed window, flexWhen=true** — R40 says flexWhen is hidden for time_window mode; still missed
- [SUB-29c] **Window partially past** — windowHi > nowMins but more than half the window is in the past → still eligible for remaining window portion
- [SUB-29d] **Window entirely in future** — no missed flag; normal window placement

---
### TS-30: Time Window with deadline — window and deadline intersect

**Domain:** Placement Modes / Time Window  
**Title:** Time Window with deadline — placement respects both constraints  

**Data Setup:**
- Tasks: `{ dur: 60, placementMode: 'time_window', preferredTimeMins: 720, timeFlex: 120, deadline: '2026-06-17' }`
- Clock: `2026-06-15` (Monday)

**Expected Outcome:**
- Window = [600, 840] on each eligible day
- Deadline constrains latest date to 2026-06-17
- Task placed in window on earliest date with free capacity ≤ deadline
- Slack computed against deadline (not window end)

**Sub-scenarios:**
- [SUB-30a] **Window available before deadline** — placed on first day within both window and deadline
- [SUB-30b] **Window unavailable before deadline** — no free window slot before deadline → unplaced
- [SUB-30c] **Window available only after deadline** — days Mon-Wed have no capacity in [600,840], Thu is past deadline → unplaced
- [SUB-30d] **startAfter + window + deadline** — three constraints, intersection determines feasible region

---
### TS-31: Time Window with start-after — placed on or after start-after within window

**Domain:** Placement Modes / Time Window  
**Title:** Time Window with start-after, placed in intersection  

(See TS-30 pattern with startAfter replacing deadline)

**Sub-scenarios:**
- [SUB-31a] **startAfter before window availability** — earliest eligible slot is max(startAfter date, day of earliest window)
- [SUB-31b] **startAfter after deadline** — impossible window → unplaced
- [SUB-31c] **startAfter in middle of window** — earliestIdx clamped to startAfter date; window still constrains time-of-day

---
### TS-32: Time Window with flexWhen — window overrides (flexWhen hidden)

**Domain:** Placement Modes / Time Window  
**Title:** flexWhen is hidden/inactive for time_window mode  

**Data Setup:**
- Tasks: `{ dur: 60, placementMode: 'time_window', preferredTimeMins: 720, timeFlex: 60, flexWhen: true }`
- Window [660, 780] fully occupied

**Expected Outcome:**
- flexWhen=true but R40 states flexWhen is hidden for time_window mode (timeFlex already provides flex)
- Fallback ladder: Pass1 (window placement fails) → Pass2 (ignoreDeadline if slack<0) → Pass3 (relaxWhen) → **but relaxWhen only relaxes when-tags, not the window constraint. If isWindowMode=true and relaxWhen=true, look at line 491: `if (item.isWindowMode && !relaxWhen) { return [[item.windowLo, item.windowHi]]; }` — so relaxWhen=true makes it fall through to when-tag placement! So flexWhen DOES work for time_window mode via the relaxWhen pass.**
- Actually, the code at line 491: if `isWindowMode && !relaxWhen` → window. If `isWindowMode && relaxWhen` → falls through to when-tag logic. So Phase 3 (relaxWhen) for a time_window task would bypass its window constraint and try when-tags instead.

**Sub-scenarios:**
- [SUB-32a] **flexWhen hidden, still uses when-tag fallback** — when='morning', window full → relaxWhen=true → eligibleWindows returns morning block instead of window → placed in morning
- [SUB-32b] **flexWhen=false, window full** — relaxWhen never triggered → unplaced (window can't accommodate, no fallback)
- [SUB-32c] **flexWhen=true, default when='' (any)** — relaxWhen=true → eligibleWindows returns all day windows → placed anywhere

---
### TS-33: Time Window non-recurring — ignored preferredTimeMins

**Domain:** Placement Modes / Time Window  
**Title:** Non-recurring time_window task uses preferredTimeMins (not ignored)  

**Data Setup:**
- Tasks: `{ recurring: false, placementMode: 'time_window', preferredTimeMins: 720, timeFlex: 60, dur: 30 }`

**Expected Outcome:**
- For time_window mode, `preferredTimeMins` IS used even for non-recurring tasks (line 293: `if ((pm === PLACEMENT_MODES.FIXED || pm === PLACEMENT_MODES.TIME_WINDOW) && t.preferredTimeMins != null && anchorMin == null)` — anchorMin is set)
- For regular ANYTIME non-recurring, preferredTimeMins is also used (line 290)
- Task placed in [660, 780] window

**Sub-scenarios:**
- [SUB-33a] **preferredTimeMins null on time_window** — anchorMin also null → windowLo/windowHi computed from preferredTimeMins... but if preferredTimeMins is null, windowLo=NaN, windowHi=NaN. This breaks the flex check at line 335: `t.timeFlex != null` → true, flex=60, but `t.preferredTimeMins` used in subtraction gives NaN → `Math.max(DAY_START, NaN - 60)` = NaN. Then `windowHi <= windowLo` → NaN <= NaN = false → isWindowMode stays true. Then eligibleWindows returns [[NaN, NaN]]... This is a bug edge case to test.
- [SUB-33b] **Non-recurring time_window with time set** — t.time present → anchorMin set from time (since pm !== 'anytime' and !(pm==='fixed' && t.when)) — anchorMin from time is used alongside window placement

---
### TS-34: Time Window — preferred time anchor with time field conflict

**Domain:** Placement Modes / Time Window  
**Title:** Time Window prefers preferredTimeMins over time field  

**Data Setup:**
- Tasks: `{ placementMode: 'time_window', time: '9:00 AM', preferredTimeMins: 720, timeFlex: 60, dur: 30 }`
- anchorMin logic: `t.time && pm !== PLACEMENT_MODES.ANYTIME` → true, so anchorMin = parseTimeToMinutes('9:00 AM') = 540. Then line 293: `pm === PLACEMENT_MODES.TIME_WINDOW && t.preferredTimeMins != null && anchorMin == null` → anchorMin is NOT null (540), so preferredTimeMins doesn't override anchorMin.

**Expected Outcome:**
- anchorMin = 540 (from time field)
- Window is still [660, 780] based on preferredTimeMins=720 ± timeFlex=60
- anchorMin (540) doesn't affect window placement — it's only for the `preferLatestSlot` check and tryPlaceAtTime
- Task placed within [660, 780] (window), not at 540

**Sub-scenarios:**
- [SUB-34a] **No time, no preferredTimeMins** — anchorMin=null, window computed from null preferredTimeMins → degenerate → falls back to when-tags
- [SUB-34b] **Time set but preferredTimeMins also set, time within window** — anchorMin=540, window=[660,780] → task placed in window, anchorMin not used for placement (not fixed mode)

---
## TS-35 to TS-41: Time Blocks Placement Mode

---
### TS-35: Time Blocks — placed only within matching named block tags

**Domain:** Placement Modes / Time Blocks  
**Title:** Time Blocks task placed only within matching named block tags  

**Data Setup:**
- User config: default time blocks with tags: morning, biz, lunch, evening, night
- Tasks: `{ dur: 30, placementMode: 'time_blocks', when: 'biz' }`

**Expected Outcome:**
- Task placed only within biz-tagged blocks (biz1 480–720, biz2 780–1020 on weekdays)
- Not placed in morning (360–480) or lunch (720–780) or other blocks
- `eligibleWindows` uses `getWhenWindows('biz', wins)` which matches biz block windows

**Sub-scenarios:**
- [SUB-35a] **Multiple tags** — when='biz,morning' → placed in either biz or morning blocks
- [SUB-35b] **Empty when=''** — all blocks eligible → placed at earliest free slot anywhere
- [SUB-35c] **when='lunch' on weekday** — only lunch block (720–780, 60 min), task dur=45 fits
- [SUB-35d] **when='morning' on weekend** — weekend morning (420–720 = 300 min), task dur=240 fits
- [SUB-35e] **when matching no blocks** — when='deep_work' but no block has tag 'deep_work' → eligibleWindows returns [] → unplaced

---
### TS-36: Time Blocks with flexWhen — relaxes to anytime when blocks full

**Domain:** Placement Modes / Time Blocks  
**Title:** Time Blocks with flexWhen relaxes to anytime when named blocks are full  

**Data Setup:**
- Tasks: `{ dur: 60, placementMode: 'time_blocks', when: 'morning', flexWhen: true }`
- Morning block fully occupied

**Expected Outcome:**
- Pass1: morning full → no placement
- Pass3 (relaxWhen=true): `eligibleWindows` called with `relaxWhen=true` → uses whenExpr='anytime' → all day windows eligible → placed in next available block
- `_whenRelaxed` flag set

**Sub-scenarios:**
- [SUB-36a] **flexWhen=false (default)** — morning full → unplaced
- [SUB-36b] **flexWhen=true, all blocks full** — relaxWhen retry also fails → unplaced
- [SUB-36c] **flexWhen=true + multiple tags** — when='morning,lunch', morning full → Pass1 tries lunch → if lunch also full → Pass3 relaxes to anytime
- [SUB-36d] **flexWhen=true + deadline** — Pass1 fails (block full), Pass2 (ignoreDeadline if slack<0), Pass3 (relaxWhen) → tries all blocks before deadline
- [SUB-36e] **flexWhen=true + recurring** — each recurring instance independently relaxable

---
### TS-37: Time Blocks recurring — day-locked to occurrence date within blocks

**Domain:** Placement Modes / Time Blocks  
**Title:** Time Blocks recurring task day-locked to occurrence date  

**Data Setup:**
- Tasks: recurring template `{ recurring: true, placementMode: 'time_blocks', when: 'morning,evening', dur: 30 }`
- Clock: `2026-06-15` (Monday)

**Expected Outcome:**
- Each instance placed within morning or evening block on its occurrence date
- Day-locked (isDayLocked = true for recurring non-flexible-tpc)
- Past instances (date < todayIsoKey) dropped for ANYTIME recurring but what about TIME_BLOCKS? Let's check: the past-drop logic at line 265 only applies to `pm === PLACEMENT_MODES.ANYTIME`. So TIME_BLOCKS past instances are NOT dropped.

Actually wait — `placement_mode: 'time_blocks'`. The past-drop check is `if (t.recurring && pm === PLACEMENT_MODES.ANYTIME && t.date && toKey(t.date) < todayIsoKey) return;` — only ANYTIME. So time_blocks past instances are still processed. But if they're past and day-locked, they'd try to place on a past date. This seems like a bug or intentional gap.

**Sub-scenarios:**
- [SUB-37a] **Recurring blocks on congested day** — no free slot in matching blocks on occurrence date → that instance unplaced
- [SUB-37b] **Recurring dayReq + blocks** — dayReq='weekend' but when='biz' → biz blocks may not exist on weekend (default weekend blocks are morning, afternoon, evening, night — no biz) → unplaced
- [SUB-37c] **Past recurring time_blocks instance** — not dropped (only ANYTIME instances dropped) → gets day-locked to past date → placed on past date? Actually, scheduler only processes dates from today forward. Past dates aren't in the dates[] array → instance can't be placed → falls to unplaced.

---
### TS-38: Time Blocks — multiple block tags, earliest eligible wins

**Domain:** Placement Modes / Time Blocks  
**Title:** Time Blocks with multiple tags, earliest eligible block wins  

**Data Setup:**
- Tasks: `{ dur: 90, placementMode: 'time_blocks', when: 'morning,evening' }`
- Weekday: morning(360–480), evening(1020–1260)

**Expected Outcome:**
- `eligibleWindows` returns morning [360,480] and evening [1020,1260]
- If morning has a free 90-min slot → placed in morning (earliest)
- If morning doesn't → placed in evening (only other option)

**Sub-scenarios:**
- [SUB-38a] **Tag ordering doesn't matter** — when='evening,morning' → same as when='morning,evening' (parseWhen splits on commas)
- [SUB-38b] **Three tags, first two full** — when='morning,lunch,evening', morning+lunch full → placed in evening
- [SUB-38c] **Tags spanning multiple days** — when='biz' on weekday, weekend only has morning/afternoon/evening/night (no biz) → weekdays preferred over weekends

---
### TS-39: Time Blocks — custom block tags work

**Domain:** Placement Modes / Time Blocks  
**Title:** Time Blocks with custom (user-defined) block tags  

**Data Setup:**
- User config: custom block `{ tag: 'deep_work', start: 480, end: 720, name: 'Deep Work' }`
- Tasks: `{ dur: 120, placementMode: 'time_blocks', when: 'deep_work' }`

**Expected Outcome:**
- Task placed within the custom 'deep_work' block (480–720)
- Custom tags are matched via `getWhenWindows('deep_work', wins)` which looks up block.tag

**Sub-scenarios:**
- [SUB-39a] **Custom tag on specific days** — deep_work only defined for Mon–Wed → not placed Thu–Fri
- [SUB-39b] **Custom tag + default tag** — when='deep_work,morning' → placed in either
- [SUB-39c] **Custom tag removed mid-schedule** — deep_work block deleted by user between schedule runs → when='deep_work' now matches nothing → unplaced

---
### TS-40: Time Blocks — strict mode: never relaxes to non-matching blocks

**Domain:** Placement Modes / Time Blocks  
**Title:** Time Blocks strict mode (flexWhen=false) never places outside matching blocks  

**Data Setup:**
- Tasks: `{ dur: 120, placementMode: 'time_blocks', when: 'morning', flexWhen: false }`
- Morning block only has 60 min remaining capacity

**Expected Outcome:**
- Morning block: only 60 min free → cannot place dur=120
- flexWhen=false → no fallback
- Task unplaced with `_unplacedReason` indicating block capacity issue

**Sub-scenarios:**
- [SUB-40a] **Multiple blocks, partial capacity** — when='morning,biz', morning full, biz has 90 min free, task dur=120 → not enough → unplaced
- [SUB-40b] **Strict + deadline** — different days may have different block capacity; if any day can accommodate within deadline → placed
- [SUB-40c] **Strict + recurring** — each instance independently day-locked and block-constrained

---
### TS-41: Time Blocks — block tag + deadline: deadline overrides day lock for non-recurring

**Domain:** Placement Modes / Time Blocks  
**Title:** Time Blocks with deadline — placement spans multiple days if needed  

**Data Setup:**
- Tasks: `{ dur: 240, placementMode: 'time_blocks', when: 'biz', deadline: '2026-06-17' }`
- Each day has only ~120 min free in biz blocks

**Expected Outcome:**
- Single day can't accommodate → search spans multiple days up to deadline
- Each day checked for biz block capacity
- Placed on earliest day with ≥240 biz capacity, or split across days if split=true

**Sub-scenarios:**
- [SUB-41a] **No day has enough biz capacity** — each day max 120 biz min, task needs 240 → unplaced
- [SUB-41b] **Biz block span across days (non-recurring, no split)** — must fit in single contiguous block on one day → day-locked by biz window, not by recurrence. Non-recurring time_blocks tasks can span multiple days within deadline range.

Actually non-recurring: `isDayLocked` is only set when `recurring && (pm === PLACEMENT_MODES.FIXED || !isFlexibleTpc)` (line 415). So non-recurring time_blocks is NOT day-locked. It can search across days.
- [SUB-41c] **Biz block + startAfter** — earliest day constrained by startAfter as well

---
## TS-42 to TS-51: Fixed Placement Mode

---
### TS-42: Fixed task — placed at exact time, immovable

**Domain:** Placement Modes / Fixed  
**Title:** Fixed task placed at exact time, never displaced  

**Data Setup:**
- Tasks: `{ placementMode: 'fixed', date: '2026-06-15', time: '9:00 AM', dur: 60 }`

**Expected Outcome:**
- `isFixedWhen = true` (non-recurring fixed)
- `anchorMin = parseTimeToMinutes('9:00 AM') = 540`
- Placed via `tryPlaceAtTime` in Phase 0 (immovables)
- `scheduled_at` = 2026-06-15 9:00 AM
- `locked: true` in placement entry
- Even if other tasks occupy that slot, fixed task still reserves it (`reserveWithTravel` unconditionally)
- Other tasks route around this locked slot

**Sub-scenarios:**
- [SUB-42a] **Fixed task with 3 overlapping fixed tasks** — all placed via tryPlaceAtTime; they overlap with `_conflict` only for rigid recurring, not for fixed. Fixed tasks overwrite each other's occupancy (latest wins in the loop but they all go through Phase 0). Actually, let me check — tryPlaceAtTime is called for each immovable. They all call `reserveWithTravel`. If Fixed A at 540–600, Fixed B at 570–630, both reserve → B's occupancy overlaps A's. But since they're both `locked: true`, there's no conflict detection for non-recurring fixed tasks against each other (only against rigid recurring). So they co-exist overlapping. This is by design — fixed means user locked it and accepts overlap.
- [SUB-42b] **Fixed + flexible tasks competing** — fixed at 540–600, flexible tasks placed around it (before 540 or after 600)
- [SUB-42c] **Fixed task with travelBefore/travelAfter** — buffer extends locked occupancy range
- [SUB-42d] **Fixed task at day boundary** — time='5:30 AM' (5:30 AM = 330, before DAY_START=360) → anchorMin=330, but tryPlaceAtTime still places it at 330 regardless of DAY_START
- [SUB-42e] **Multiple fixed tasks at same time** — both placed, overlapping occupancy

---
### TS-43: Fixed task without date or time — server returns 400

**Domain:** Placement Modes / Fixed  
**Title:** Fixed mode requires date+time, 400 if absent  

**Data Setup:**
- API request with `placementMode: 'fixed'` but missing `date` or `time`

**Expected Outcome:**
- Server returns 400 with validation error
- Validation: `fixed` requires both `date` and `time` fields

**Sub-scenarios:**
- [SUB-43a] **Missing date** — `{ placementMode: 'fixed', time: '9:00 AM' }` → 400
- [SUB-43b] **Missing time** — `{ placementMode: 'fixed', date: '2026-06-15' }` → 400
- [SUB-43c] **Both missing** → 400
- [SUB-43d] **Empty strings** — `date: '', time: ''` → 400
- [SUB-43e] **Invalid time format** — `time: '25:00'` → 400 (parseTimeToMinutes fails)

---
### TS-44: Fixed non-recurring — cannot be displaced by other tasks

**Domain:** Placement Modes / Fixed  
**Title:** Fixed non-recurring task cannot be displaced  

**Data Setup:**
- Fixed task A at 540–600 (locked), flexible task B (dur=120)
- Only free slot is 480-600... but A occupies 540-600

**Expected Outcome:**
- B is placed around A (starting at 480, ending at 540, leaving 540-600 for A... but B needs 120 min, 480-540 is only 60 min → B pushed to 600-720)
- A remains at 540-600 untouched
- Later schedule runs preserve A's placement (not rescheduled)

**Sub-scenarios:**
- [SUB-44a] **A fixed, B fixed overlapping** — both placed, overlapping
- [SUB-44b] **A fixed, many flexible tasks** — all flexibles route around A's locked slot
- [SUB-44c] **Re-schedule preserves fixed** — run scheduler twice; A's position unchanged

---
### TS-45: Fixed recurring (rigid) — placed at preferred time, can be force-placed with conflict

**Domain:** Placement Modes / Fixed  
**Title:** Fixed recurring (rigid recurring) placed at preferred time with _conflict flag if overlapping  

**Data Setup:**
- Tasks: recurring `{ recurring: true, placementMode: 'fixed', time: '7:00 AM', dur: 30 }`
- Existing fixed task at 7:00 AM on same day

**Expected Outcome:**
- Recurring fixed → `isRigid = true` (line 430: `isRigid: pm === PLACEMENT_MODES.FIXED`), but `isFixedWhen = false` because `fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring` (line 272)
- And `isDayLocked = true` (line 415: `recurring && (pm === PLACEMENT_MODES.FIXED || !isFlexibleTpc)`)
- Placed via tryPlaceAtTime at 420 (7 AM)
- If another task occupies that slot → `_conflict = true` flag set on entry
- `warnings.push({ type: 'recurringConflict' })`
- `reserveWithTravel` still reserves the slot

**Sub-scenarios:**
- [SUB-45a] **Rigid recurring non-conflicting** — no prior occupancy → placed normally, no _conflict flag
- [SUB-45b] **Rigid recurring conflicting with another rigid recurring** — both force-placed, both have _conflict flag
- [SUB-45c] **Rigid recurring conflicting with a fixed task** — fixed is `locked: true`, rigid recurring gets _conflict = true
- [SUB-45d] **Rigid recurring overlapping flexible tasks** — flexible tasks routed around both rigid placements

---
### TS-46: Fixed recurring without time — falls back to anytime

**Domain:** Placement Modes / Fixed  
**Title:** Recurring + fixed without time falls back to anytime  

**Data Setup:**
- Tasks: recurring `{ recurring: true, placementMode: 'fixed' }` — no time specified
- per R26.3: the scheduler falls back to anytime

**Expected Outcome:**
- UI shows "not available" for fixed on recurring
- Scheduler treats as ANYTIME instead of FIXED
- `isRigid` would be true (pm === FIXED) but `isFixedWhen` is false (recurring)
- Without a time, anchorMin is null → tryPlaceAtTime returns false → falls through to normal placement queue
- Actually, the code at line 288: `anchorMin = (t.time && pm !== PLACEMENT_MODES.ANYTIME && !(pm === PLACEMENT_MODES.FIXED && t.when)) ? parseTimeToMinutes(t.time) : null` — if t.time is null/undefined, anchorMin is null. Then tryPlaceAtTime checks `if (!item.anchorDate || item.anchorMin == null) return false` — returns false.
- Item enters the queue with `isRigid=true`, `isFixedWhen=false`, anchorMin=null. In `findEarliestSlot`, since `isFixedWhen=false`, the day-locking at line 812 doesn't apply. Recurring day-locking at line 831 applies (isRecurring=true, anchorDate exists, isDayLocked=true). So it's day-locked to its occurrence date but has no time anchor → placed at earliest slot on that day.

Wait, let me re-check. Line 415: `isDayLocked = recurring && (pm === PLACEMENT_MODES.FIXED || !isFlexibleTpc)` → true. So it's day-locked to anchorDate. And earliest/latest both = anchorDate. So it MUST place on anchorDate, but at the earliest available slot.

**Expected Outcome:**
- Task placed on its occurrence date at earliest available slot (not at a specific time)
- Treated as FIXED mode but without a time anchor, day-locked

**Sub-scenarios:**
- [SUB-46a] **Rigid recurring without time, congested day** — can't fit on occurrence date → unplaced
- [SUB-46b] **Rigid recurring with time but no date** — `anchorDate` = null → tryPlaceAtTime returns false (no anchorDate). But `isRecurring=true` and `isDayLocked=true` with null anchorDate... in findEarliestSlot, line 831: `if (item.isRecurring && item.anchorDate)` → false → no day-locking. It's a recurring without a date → placed at earliest available slot (generally today).

---
### TS-47: Fixed mode exit — changing to anytime frees the slot

**Domain:** Placement Modes / Fixed  
**Title:** Changing fixed to anytime frees the slot for rescheduling  

**Data Setup:**
- Task A fixed at 540–600
- Schedule run: A placed at 540
- User changes A to `placementMode: 'anytime'`
- Schedule re-run: A is now flexible, slot 540–600 freed for other tasks

**Expected Outcome:**
- A may be moved to a different slot on re-run
- The previously reserved slot 540–600 is available for other tasks
- `isFixedWhen = false` → A enters the queue normally

**Sub-scenarios:**
- [SUB-47a] **Mode change, slot immediately claimed** — another task B fills the old 540–600 slot
- [SUB-47b] **Mode change to 'time_window'** — fixed→time_window: A now has window constraint around preferred time
- [SUB-47c] **Mode change to 'time_blocks'** — fixed→time_blocks: A constrained to named blocks
- [SUB-47d] **Mode change to 'all_day'** — fixed→all_day: A becomes a banner, removed from time grid entirely

---
### TS-48: Fixed recurring — no anchor date (generated without date) placed at earliest slot

**Domain:** Placement Modes / Fixed  
**Title:** Fixed recurring without anchor date placed at earliest slot  

**Data Setup:**
- Tasks: recurring instance `{ recurring: true, placementMode: 'fixed', date: null, time: '9:00 AM' }`

**Expected Outcome:**
- anchorDate = null (no date)
- tryPlaceAtTime returns false (no anchorDate)
- Falls through to normal queue with `isRigid=true`, `isFixedWhen=false`
- In findEarliestSlot, recurring check at line 831: `isRecurring=true` but `anchorDate` is null → no day-locking
- Task placed at earliest available slot starting today
- This is edge-case behavior — normally recurring instances always have a date from expandRecurring

**Sub-scenarios:**
- [SUB-48a] **No date, no time** — falls through to normal queue; placed at earliest free slot

---
### TS-49: Fixed task without when tag — time-only fixed placement

**Domain:** Placement Modes / Fixed  
**Title:** Fixed task without when tag uses time from time field  

**Data Setup:**
- Tasks: `{ placementMode: 'fixed', date: '2026-06-15', time: '2:00 PM', dur: 30, when: '' }`

**Expected Outcome:**
- `anchorMin = parseTimeToMinutes('2:00 PM') = 840` (since `!(pm === PLACEMENT_MODES.FIXED && t.when)` → when is empty string, falsy → condition is true → anchorMin from time)
- `isFixedWhen = true`
- Placed at 840 via tryPlaceAtTime

**Sub-scenarios:**
- [SUB-49a] **Fixed with when tag** — when='morning' → `t.when` is truthy → `!(pm === PLACEMENT_MODES.FIXED && t.when)` = false → anchorMin NOT set from time. But line 293: `pm===FIXED && preferredTimeMins != null && anchorMin==null` → sets anchorMin from preferredTimeMins. If no preferredTimeMins either → anchorMin=null → tryPlaceAtTime returns false → falls through to normal queue with isFixedWhen=true. Then eligibleWindows at line 482: `if (item.isFixedWhen && item.anchorMin != null)` → anchorMin is null → this check fails → falls through to when-tag matching window. So a fixed task WITH a when tag but WITHOUT preferredTimeMins would be placed according to its when tag in the normal queue. Is this correct behavior? The comment says "For FIXED with a when-tag, the when-block is authoritative — do NOT use t.time (it may be stale)."

---
### TS-50: Calendar-synced task locked to fixed — mode change requires takeOwnership

**Domain:** Placement Modes / Fixed  
**Title:** Calendar-synced task locked to fixed mode  

**Data Setup:**
- Calendar-synced task (source is external calendar)
- Has `placementMode: 'fixed'` by default

**Expected Outcome:**
- UI blocks placement mode change
- API: mode change rejected until `takeOwnership` is called
- After `takeOwnership`, mode becomes changeable

**Sub-scenarios:**
- [SUB-50a] **takeOwnership then change to anytime** — allowed
- [SUB-50b] **takeOwnership then delete** — allowed
- [SUB-50c] **Drag-to-change time before takeOwnership** — blocked; must take ownership first

---
### TS-51: Fixed recurring — allowed (orthogonal)

**Domain:** Placement Modes / Fixed  
**Title:** Fixed recurring is supported (recurrence orthogonal to placement mode)  

**Data Setup:**
- Tasks: recurring `{ recurring: true, placementMode: 'fixed', time: '7:00 AM', dur: 30, recur: { type: 'daily' } }`

**Expected Outcome:**
- Per R11.4: `recurring` is orthogonal to placement mode. Fixed recurring is allowed.
- Each instance placed at 7:00 AM on its occurrence date
- Past instances: since this is FIXED mode (not ANYTIME), past instances are NOT dropped by the line 265 check
- Each instance carries `isRigid=true`

**Sub-scenarios:**
- [SUB-51a] **Daily fixed recurring** — each day at 7 AM
- [SUB-51b] **Weekly fixed recurring (MWF)** — Mon, Wed, Fri at 7 AM
- [SUB-51c] **Fixed recurring yesterday** — instance from yesterday: FIXED mode (not ANYTIME) → NOT dropped → gets day-locked to yesterday → can't be placed (yesterday not in dates[]) → unplaced
- [SUB-51d] **Fixed recurring conflict with self across days** — no cross-day conflict; each day independent

---
## TS-52 to TS-57: All Day Placement Mode

---
### TS-52: All Day task — placed as banner, excluded from time grid

**Domain:** Placement Modes / All Day  
**Title:** All Day task is a banner entry, excluded from time-grid placement  

**Data Setup:**
- Tasks: `{ placementMode: 'all_day', date: '2026-06-15' }`

**Expected Outcome:**
- `isAllDay = true` (line 426: `isAllDay: pm === PLACEMENT_MODES.ALL_DAY`)
- buildItems at line 257: `if (pm === PLACEMENT_MODES.ALL_DAY) return;` — early return, item NOT pushed to items[]
- Task NOT in the placement queue → not placed in time grid
- All-day entry rendered as banner in UI
- No time occupancy consumed on the grid

**Sub-scenarios:**
- [SUB-52a] **All Day with dur set** — dur=120 ignored (all-day occupies full day, not just 120 min)
- [SUB-52b] **All Day with when/morning** — when ignored (all-day overrides when constraints)
- [SUB-52c] **All Day with location/tools** — location/tools ignored (all-day doesn't occupy time blocks)
- [SUB-52d] **Multiple all-day tasks on same day** — all appear as banners, no time-grid conflict

---
### TS-53: All Day — any time set is cleared/ignored

**Domain:** Placement Modes / All Day  
**Title:** All Day ignores any time setting  

**Data Setup:**
- Tasks: `{ placementMode: 'all_day', date: '2026-06-15', time: '9:00 AM' }`

**Expected Outcome:**
- Early return in buildItems before time is processed
- `scheduled_at` set to banner date, no time component used
- Frontend renders as all-day banner, never as time-grid block

**Sub-scenarios:**
- [SUB-53a] **All Day with preferredTimeMins** — ignored
- [SUB-53b] **All Day with timeFlex** — ignored
- [SUB-53c] **All Day with deadline** — deadline retained for visual/UI purposes but not used for time-grid placement (since task isn't placed on grid)

---
### TS-54: All Day recurring — each occurrence is a banner

**Domain:** Placement Modes / All Day  
**Title:** All Day recurring task — each occurrence is a banner  

**Data Setup:**
- Tasks: recurring `{ recurring: true, placementMode: 'all_day', recur: { type: 'daily' } }`

**Expected Outcome:**
- Each instance is a banner on its occurrence date
- No time-grid occupancy for any instance
- 14-day horizon generates 14 all-day banners

**Sub-scenarios:**
- [SUB-54a] **Weekly all-day recurring** — Mon, Wed, Fri banners
- [SUB-54b] **Monthly all-day recurring** — 1st and 15th banners
- [SUB-54c] **All-day recurring + dayReq** — dayReq filters which occurrence dates get banners

---
### TS-55: All Day with deadline — deadline date affects banner positioning

**Domain:** Placement Modes / All Day  
**Title:** All Day with deadline — deadline affects banner positioning in UI  

**Data Setup:**
- Tasks: `{ placementMode: 'all_day', date: '2026-06-15', deadline: '2026-06-20' }`

**Expected Outcome:**
- Banner placed on 2026-06-15 (or earliest available date)
- Deadline is informational for UI (color coding, visual urgency)
- No time-grid placement check occurs
- Schedule output includes all-day entries separately from time-grid placements

**Sub-scenarios:**
- [SUB-55a] **All Day past deadline** — banner still shown (deadline doesn't affect all-day rendering)
- [SUB-55b] **All Day + startAfter** — startAfter may shift the banner date

---
### TS-56: All Day changed from another mode — time cleared

**Domain:** Placement Modes / All Day  
**Title:** Changing to all-day mode clears time and moves to banner  

**Data Setup:**
- Task was fixed at 9:00 AM on 2026-06-15
- User changes to `placementMode: 'all_day'`

**Expected Outcome:**
- `time` field cleared (set to null in write path)
- `date` preserved
- Task removed from time grid on next schedule run
- Banner appears on preserved date

**Sub-scenarios:**
- [SUB-56a] **anytime → all_day** — existing scheduled_at time cleared
- [SUB-56b] **time_window → all_day** — preferredTimeMins preserved but ignored
- [SUB-56c] **time_blocks → all_day** — when tags preserved but ignored

---
### TS-57: All Day — not placed on TBD date

**Domain:** Placement Modes / All Day  
**Title:** All Day task with TBD date is skipped  

**Data Setup:**
- Tasks: `{ placementMode: 'all_day', date: 'TBD' }`

**Expected Outcome:**
- Line 252: `if (t.date && String(t.date).toUpperCase() === 'TBD') return;` — skipped regardless of mode
- Not placed as banner or time-grid entry

---
## TS-58 to TS-61: Reminder Placement Mode

---
### TS-58: Reminder — dur forced to 0, no occupancy consumption

**Domain:** Placement Modes / Reminder  
**Title:** Reminder placed with dur=0, coexists with other tasks  

**Data Setup:**
- Tasks: Reminder `{ placementMode: 'reminder', date: '2026-06-15' }`, Task B `{ dur: 60 }`

**Expected Outcome:**
- `isMarker = true` (line 245)
- `dur = 0` (line 248: `isMarker ? 0 : effectiveDuration(t)`)
- Reminder placed at earliest available slot
- Since dur=0 and `isFreeWithTravel` checks `occ[m]` — with zero duration, the slot range starts at s and ends at s+0 → only minute s itself. `isFree` checks `occ[s]` — if nothing occupies that exact minute, it's free.
- Actually, `reserve` only marks minutes from `start` to `start+dur` (exclusive). With dur=0, it marks `[start, start)` — no minutes at all. So reminders consume ZERO occupancy.
- Task B placed independently; reminder doesn't block B's slot even if they share the same minute.

**Sub-scenarios:**
- [SUB-58a] **Reminder with overlapping times** — multiple reminders at same minute → all placed (no occupancy consumed)
- [SUB-58b] **Reminder with time set** — `time: '9:00 AM'` → reminder placed at 540, coexists with other tasks at 540
- [SUB-58c] **Reminder with anchorMin from preferredTimeMins** — anchorMin = preferredTimeMins if set

---
### TS-59: Reminder — hidden controls (dur, split, etc grayed out)

**Domain:** Placement Modes / Reminder  
**Title:** Reminder mode hides duration, split, and other scheduling controls  

**Data Setup:**
- Task with `placementMode: 'reminder'`
- Frontend WhenSection

**Expected Outcome:**
- Duration control hidden/disabled (dur forced to 0)
- Split toggle hidden/disabled
- Time blocks/window controls hidden
- Only date/time picker shown
- UI shows reminder-specific styling

**Sub-scenarios:**
- [SUB-59a] **Reminder with dur set** — backend ignores it (dur=0 forced)
- [SUB-59b] **Reminder with deadline** — deadline retained for visual purposes but not used for scheduling
- [SUB-59c] **Reminder with location/tools** — location/tools ignored (reminder consumes no grid occupancy)

---
### TS-60: Reminder recurring — each occurrence is a zero-occupancy marker

**Domain:** Placement Modes / Reminder  
**Title:** Reminder recurring — each occurrence is a marker  

**Data Setup:**
- Tasks: recurring `{ recurring: true, placementMode: 'reminder', recur: { type: 'daily' } }`

**Expected Outcome:**
- Each instance is a reminder (dur=0, isMarker=true)
- No time-grid occupancy across 14 instances
- Each instance placed at earliest available time on its occurrence date
- Instances coexist with other tasks on same day

**Sub-scenarios:**
- [SUB-60a] **Daily reminder recurring** — 14 banners/markers
- [SUB-60b] **Reminder recurring with preferredTimeMins** — placed near preferred time if window available
- [SUB-60c] **Reminder recurring + dayReq** — dayReq filters which days get reminders
- [SUB-60d] **Reminder recurring conflict** — never conflicts (zero occupancy)

---
### TS-61: Reminder — placed at earliest available slot

**Domain:** Placement Modes / Reminder  
**Title:** Reminder always placed at earliest available slot (zero duration)  

**Data Setup:**
- Tasks: Reminder `{ placementMode: 'reminder' }` on a completely full day

**Expected Outcome:**
- Even with full occupancy, reminder can be placed (dur=0 → needs only 1 free minute)
- `isFreeWithTravel(occ, s, 0, 0, 0)` → `isFree(occ, s, 0)` → `s + 0 <= s` → empty loop → returns true for ANY `s` (since no minutes to check)
- Reminder placed at earliest minute (DAY_START=360)

**Sub-scenarios:**
- [SUB-61a] **Many reminders on full day** — all placed at earliest slot (360) coexisting
- [SUB-61b] **Reminder with travelBefore** — travelBefore=15 → `isFreeWithTravel(occ, s, 0, 15, 0)` → checks minutes `s-15` to `s`. If those are occupied, reminder can't be placed at that s. On fresh schedule → earliest slot at 360 with travelBefore=15 → checks 345–360 → all free → placed at 360.
- [SUB-61c] **Reminder with travelAfter** — similar to travelBefore

---
## TS-62 to TS-71: Mode Transitions

---
### TS-62: Mode Transition — anytime → fixed

**Domain:** Mode Transitions  
**Title:** Changing placementMode from anytime to fixed  

**Data Setup:**
- Task A with `placementMode: 'anytime'`, currently placed at 480–540
- User changes to `placementMode: 'fixed'`, set `time: '3:00 PM'`

**Action:**
- PUT /api/tasks/:id with `{ placementMode: 'fixed', time: '3:00 PM' }`
- Run scheduler

**Expected Outcome:**
- On next schedule run, A is placed at 900 (3:00 PM) via tryPlaceAtTime
- Previously occupied slot 480–540 is released for other tasks
- `isFixedWhen = true`
- `locked: true` on placement

**Sub-scenarios:**
- [SUB-62a] **anytime → fixed without time** — 400 error (fixed requires time+date)
- [SUB-62b] **anytime → fixed, time conflicts with existing fixed** — A placed at 900, overlapping if other task also at 900; both locked, overlapping occupancy
- [SUB-62c] **anytime → fixed on recurring task** — UI shows "not available", scheduler falls back to anytime (R26.3)
- [SUB-62d] **anytime → fixed + travelBefore** — buffer added to locked occupancy

---
### TS-63: Mode Transition — fixed → anytime

**Domain:** Mode Transitions  
**Title:** Changing placementMode from fixed to anytime  

**Data Setup:**
- Task A fixed at 540–600 (locked)
- User changes to `placementMode: 'anytime'`

**Expected Outcome:**
- `isFixedWhen = false`, `anchorMin` no longer read from time field (line 288: `pm !== PLACEMENT_MODES.ANYTIME` → false → anchorMin not set from time)
- If preferredTimeMins set → anchorMin = preferredTimeMins (line 290)
- Falls into slack-sorted queue
- May be moved to a different slot on next schedule run
- Previously locked slot 540–600 freed

**Sub-scenarios:**
- [SUB-63a] **fixed → anytime, slot immediately claimed** — another task occupies 540–600
- [SUB-63b] **fixed → anytime on calendar-synced task** — requires takeOwnership first
- [SUB-63c] **fixed → anytime, preferredTimeMins set** — anchorMin from preferredTimeMins anchors placement preference (but NOT locked)

---
### TS-64: Mode Transition — anytime → time_window

**Domain:** Mode Transitions  
**Title:** Changing placementMode from anytime to time_window  

**Data Setup:**
- Task A anytime, placed wherever
- User changes to `placementMode: 'time_window'`, sets `preferredTimeMins: 720, timeFlex: 60`

**Expected Outcome:**
- `isWindowMode = true`
- `windowLo = 660, windowHi = 780`
- On next schedule run, A is constrained to [660, 780]
- If A was previously outside this window → moved inside
- `eligibleWindows` now returns `[[660, 780]]`

**Sub-scenarios:**
- [SUB-64a] **anytime → time_window, window fully occupied** — A unplaced (window has no capacity)
- [SUB-64b] **anytime → time_window, zero timeFlex** — degenerate window → falls back to when-tags
- [SUB-64c] **anytime → time_window, preferredTimeMins null** — degenerate → falls back to when-tags
- [SUB-64d] **anytime → time_window on recurring** — each instance constrained to window on its occurrence date

---
### TS-65: Mode Transition — time_window → time_blocks

**Domain:** Mode Transitions  
**Title:** Changing placementMode from time_window to time_blocks  

**Data Setup:**
- Task A time_window with preferredTimeMins=720, timeFlex=60
- User changes to `placementMode: 'time_blocks'`, sets `when: 'morning'`

**Expected Outcome:**
- `isWindowMode = false`
- `isAllDay = false`
- `when = 'morning'`
- On next schedule run, A constrained to morning block (360–480)
- No longer constrained to [660, 780] window

**Sub-scenarios:**
- [SUB-65a] **time_window → time_blocks, morning full, flexWhen=true** — relaxWhen fallback → placed in any block
- [SUB-65b] **time_window → time_blocks, morning full, flexWhen=false** — unplaced
- [SUB-65c] **time_window → time_blocks on recurring** — each instance constrained to blocks on occurrence date

---
### TS-66: Mode Transition — time_blocks → anytime

**Domain:** Mode Transitions  
**Title:** Changing placementMode from time_blocks to anytime  

**Data Setup:**
- Task A time_blocks with when='morning', placed at 400
- User changes to `placementMode: 'anytime'`

**Expected Outcome:**
- No when constraint (default when='' → all blocks eligible)
- On next schedule run, A may be moved to earliest free slot anywhere
- Previously constrained tag matching removed

**Sub-scenarios:**
- [SUB-66a] **time_blocks → anytime, flexWhen preserved** — flexWhen flag persists but is now less relevant (anytime always has full flexibility)
- [SUB-66b] **time_blocks → anytime on recurring** — instances no longer constrained to blocks; day-locked but any block on occurrence date

---
### TS-67: Mode Transition — anytime → all_day

**Domain:** Mode Transitions  
**Title:** Changing placementMode from anytime to all_day  

**Data Setup:**
- Task A anytime, placed at 480–540
- User changes to `placementMode: 'all_day'`

**Expected Outcome:**
- BuildItems line 257: `if (pm === PLACEMENT_MODES.ALL_DAY) return;` — task not pushed to items[]
- Task removed from time-grid
- Banner appears on its date
- Previously occupied slot 480–540 freed

**Sub-scenarios:**
- [SUB-67a] **anytime → all_day with deadline** — deadline retained info, task removed from grid
- [SUB-67b] **anytime → all_day on recurring** — each occurrence becomes a banner
- [SUB-67c] **anytime → all_day with when tags** — when tags ignored
- [SUB-67d] **anytime → all_day on TBD date** — skipped (TBD check fires before mode check? Let me check: line 252 checks TBD, then line 257 checks all_day. Order: TBD → early return regardless of mode.)

---
### TS-68: Mode Transition — anytime → reminder

**Domain:** Mode Transitions  
**Title:** Changing placementMode from anytime to reminder  

**Data Setup:**
- Task A anytime, placed at 480–540
- User changes to `placementMode: 'reminder'`

**Expected Outcome:**
- `isMarker = true`
- `dur = 0`
- Task placed at earliest slot with zero occupancy consumption
- Previously occupied slot freed for other tasks
- Listed as marker entry (not time-grid placement)

**Sub-scenarios:**
- [SUB-68a] **anytime → reminder with deadline** — deadline retained for visual use
- [SUB-68b] **anytime → reminder on recurring** — each occurrence becomes a marker

---
### TS-69: Mode Transition — calendar-sync lock prevents mode change

**Domain:** Mode Transitions  
**Title:** Calendar-synced task locked to fixed mode, mode change blocked  

**Data Setup:**
- Task synced from Google Calendar
- `placementMode: 'fixed'` (set by sync)
- User tries to change to `placementMode: 'anytime'`

**Expected Outcome:**
- API call rejected with error requiring takeOwnership
- UI shows mode selector as disabled with lock icon/info
- After `takeOwnership` endpoint called, mode becomes changeable

**Sub-scenarios:**
- [SUB-69a] **Calendar-synced, change to time_window** — blocked
- [SUB-69b] **Calendar-synced, change to time_blocks** — blocked
- [SUB-69c] **Calendar-synced, change to all_day** — blocked
- [SUB-69d] **Calendar-synced, takeOwnership then change** — allowed

---
### TS-70: Mode Transition — takeOwnership → allowed to change mode

**Domain:** Mode Transitions  
**Title:** takeOwnership unlocks mode change for calendar-synced tasks  

**Data Setup:**
- Task synced from external calendar
- `placementMode: 'fixed'`

**Action:**
1. POST /api/tasks/:id/take-ownership
2. PUT /api/tasks/:id with `{ placementMode: 'anytime' }`

**Expected Outcome:**
- Step 1 succeeds: task is now user-owned
- Step 2 succeeds: mode changed to anytime
- Next sync: external calendar changes do not overwrite ownership
- Scheduler treats task as normal anytime task

**Sub-scenarios:**
- [SUB-70a] **takeOwnership then change to time_window** — allowed
- [SUB-70b] **takeOwnership then change to fixed (different time)** — allowed
- [SUB-70c] **takeOwnership then set as all_day** — allowed
- [SUB-70d] **takeOwnership, revert to fixed at same time** — allowed (owner's choice)

---
### TS-71: Mode Transition — drag to fixed (via calendar drag-and-drop)

**Domain:** Mode Transitions  
**Title:** Drag-and-drop on calendar implicitly changes mode to fixed  

**Data Setup:**
- Task A anytime, currently placed at arbitrary slot
- User drags A to a specific time slot (9:00 AM) on calendar grid

**Expected Outcome:**
- Drop handler calls PUT /api/tasks/:id with `{ date: '2026-06-15', time: '9:00 AM', placementMode: 'fixed' }`
- On next schedule run, A is fixed at 9:00 AM
- `isFixedWhen = true`
- Previously occupied slot freed
- Drag effectively acts as a mode transition to fixed + time assignment

**Sub-scenarios:**
- [SUB-71a] **Drag anytime task onto another task** — fixed task placed at drop time, overlapping with existing task (fixed always places regardless of conflict)
- [SUB-71b] **Drag time_window to new time** — drag changes preferredTimeMins and mode to fixed; previously windowed placement abandoned
- [SUB-71c] **Drag time_blocks to new time** — mode becomes fixed, block constraint removed
- [SUB-71d] **Drag fixed task to new time** — fixed→fixed (same mode, different time)
- [SUB-71e] **Drag all_day task to time grid** — all_day→fixed; all-day mode changes to fixed with specified time
- [SUB-71f] **Drag reminder to time grid** — reminder→fixed; reminder becomes timed task with occupancy
- [SUB-71g] **Drag calendar-synced task** — requires takeOwnership first; drag denied until owned
- [SUB-71h] **Drag recurring instance** — drag converts instance (not master) to effectively fixed for that occurrence (generated instances with date pivot; master's mode unchanged)