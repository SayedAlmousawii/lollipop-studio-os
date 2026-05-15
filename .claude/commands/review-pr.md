---
description: Review a PR against its spec file
argument-hint: <pr-url> <spec-file>
---

Review PR $1 against $2.

Fetch the diff with `gh pr view` and `gh pr diff`. Check it against
the spec's Scope (in/out), Rules, and Verification sections.

Report:
1. Verdict: clean / nits / needs-fix
2. Any deviations from spec (scope creep, missing rules, skipped verification)
3. Any bugs or risks you spotted in the diff itself
4. If needs-fix: a ready-to-paste prompt for the implementing agent
   to address the issues on the same branch.

Do not merge. Do not edit files.
