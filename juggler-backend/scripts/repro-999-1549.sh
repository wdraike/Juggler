#!/bin/bash
# Self-contained RED repro for 999.1549 (bugfix_repro — no pre_fix_ref available since
# the leg tree is uncommitted). Temporarily re-inserts the marker field into userHash(),
# runs the C1-7 regression test, then restores the fixed file unconditionally.
set -u
cd "$(dirname "$0")/.."
ln -sfn "/Users/david/Documents/Software Dev/raike-and-sons/juggler/juggler-backend/node_modules" node_modules 2>/dev/null
cp src/controllers/cal-sync-helpers.js /tmp/csh-repro-999-1549.bak
python3 - <<'PYEOF'
c = open('src/controllers/cal-sync-helpers.js').read()
old = "    task.notes || '',\n"
new = "    task.marker ? 'marker' : '',\n" + old
assert old in c
open('src/controllers/cal-sync-helpers.js', 'w').write(c.replace(old, new, 1))
PYEOF
npx jest tests/cal-sync/characterization/W0-characterization.test.js -t "C1-7"
EX=$?
cp /tmp/csh-repro-999-1549.bak src/controllers/cal-sync-helpers.js
exit $EX
