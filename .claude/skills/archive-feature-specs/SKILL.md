---
name: archive-feature-specs
description: Archive feature specs from context/feature-specs/ into context/feature-specs/archive/, grouping related specs into NN-topic folders. Use when the user says things like "archive specs X-Y", "move feature specs into archive", or wants to clean up the active feature-specs directory.
---

# Archive Feature Specs

Moves spec files from `context/feature-specs/` into `context/feature-specs/archive/NN-topic/` folders, following the existing archive convention.

## Convention

- Archive subfolders are named `NN-topic` where `NN` is a zero-padded sequence number that continues from the highest existing folder (e.g., if `09-financial-stabilization` exists, the next group starts at `10-`).
- Each folder groups **related** specs — typically specs that share a feature surface, subsystem, or epic. A single feature with `a/b/c` parts always stays together.
- Specs that share a clear theme across feature numbers (e.g., several specs all touching the adjustment workspace) should be co-located even if numbered differently.
- Standalone specs with no siblings still go into their own `NN-topic` folder — don't leave loose files in `archive/`.

## Procedure

1. **List** `context/feature-specs/` and `context/feature-specs/archive/` to see what's active and what the next sequence number is.
2. **Read spec titles** (the H1 or filename slug is usually enough) for the specs being archived to understand grouping.
3. **Propose groupings** to the user before moving — show which specs go into which `NN-topic` folder and the rationale. Ask for confirmation if grouping isn't obvious.
4. **Create folders + move with `git mv`** so history is preserved. Batch into a single Bash call when possible.
5. **Report** the final layout.

## Notes

- Never archive `SPEC_TEMPLATE.md`.
- Don't modify spec contents — this skill only relocates files.
- If a spec being archived is referenced from `MEMORY.md`, `progress-tracker`, or other context docs, flag it to the user (but don't auto-update — let them decide).
- Prefer `git mv` over `mv` so the move shows up as a rename in git history.
