# Retro — juggler-hex-h5-ai — 2026-06-12

## Metrics this cycle
refactor | WARN | blocks=3 | warns=2 (both deferred, human-approved) | fix_loop_iters=2 | muppets=5
Project: 27 legs, 18% first-pass.

## Process observations
1. **Orphaned-leg gap (NEW — root cause of this whole session).** session.json was `idle` while uncommitted
   H5 work sat on `leg/juggler-hex-h5-ai` (tracking lost, likely a /clear). `kermit --resume` on idle would
   normally say "nothing to resume" and MISS it — only manual branch + review-artifact inspection surfaced the
   orphan. No automatic signal exists for "idle session + dirty leg/* branch".
2. **Fix-loop over-reach (caught, folded).** iter1 bert wired a real AbortController when the WARN only asked
   to correct a comment → 2 new BLOCKs (telemetry leak + runner crash), open-BLOCK 1→2. Oscillation guard
   flagged non-strict-decrease; iter2 scope-tightened to 0. Lesson folded to Scooter KG.
3. **Gate earned its cost (WIN).** Snuffy caught the missing E2 test (UNDER_SCOPED, near-binding honored);
   zoe caught a tautological false-pass (BLOCK-1) + both fix-induced BLOCKs by source-mutation. For an
   AI/quota surface with the H4 cache-coherence-trap precedent, 5 muppets on ~300 ln was RIGHT-sized, not over.

## Proposed process fixes (NOT applied — human approval required; editing the muppet system is gated)
- **P1 — SessionStart orphan detector.** Add a SessionStart hook (settings.json) that flags
  `session.json.status==idle && git HEAD on leg/* && working tree dirty` → "orphaned leg-work — run kermit --resume".
  Would have auto-surfaced this leg instead of relying on manual inspection. Effect: closes the lost-tracking hole.
- **P2 — fixer scope-discipline contract.** Add to bert's dispatch/agent contract: "fix ONLY the cited finding;
  an out-of-scope improvement is REFERRED UP as a new item, never applied inline." Encodes the folded lesson so
  the next fixer doesn't re-learn it. File: bert agent / AGENT-STANDARD fixer section.

## Status: retro ran 2026-06-12; cadence counter reset.
