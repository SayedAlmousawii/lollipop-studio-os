---
name: spec-review-loop
description: The per-spec review-and-merge loop for this repo's "Codex implements, I review" workflow. Use whenever the user pastes a Codex implementation plan for a spec, OR says a spec branch has been pushed / is ready / "it's up". Covers both entry points — plan review (verdict before implementation) and post-push code review (open PR → review the real diff → squash-merge to development if clean). Trigger this even when the user doesn't name it explicitly: a pasted plan referencing a spec number, or any "spec NN is pushed / ready for review" cue, is the signal. Also produces the GO / GO-with-nits / NO-GO verdict and the ready-to-paste Codex handoff prompt whenever fixes are needed.
---

# Spec Review Loop

The repeatable loop for shepherding one spec at a time through review and merge. **Codex implements; I review and merge.** Specs live under `context/feature-specs/`; each ships on its own `spec/<NN>-<slug>` branch cut from `development`, squash-merged into `development` after a clean review. This skill has been run across the Phase 6 AW-retirement arc (specs 144–149) and the credit-settlement arc (specs 153–158).

## Two entry points

The loop has exactly two places the user hands me work. Figure out which one I'm at from what the user just said:

1. **Plan review** — user pastes Codex's implementation plan (before any code). I judge the *plan* against the spec and reply with a labeled verdict. **Plan review ≠ code review** — approving a plan never implies the eventual diff is clean.
2. **Post-push review** — user says the branch is pushed / ready / "it's up". I open the PR, review the *actual diff*, and merge if clean.

## Authority (standing, for this workflow)

The user has authorized me to **open PRs, squash-merge to `development`, and push docs directly to `development`** for this track — this overrides the AGENTS.md "user merges" default. A **clean review IS the merge trigger**: do not wait for a separate "merge it" confirmation. The user only steps in when I flag a problem. Reconfirm only if scope changes (e.g. a different base branch, a destructive migration outside the spec).

---

## Entry point 1 — Plan review

The user pastes Codex's plan. Do this:

1. **Read the spec** the plan claims to implement (`context/feature-specs/<NN>-*`) so I'm judging against the real requirement, not the plan's self-description.
2. **Verify the plan's claims against the actual code** — grep for the writes, services, and invariants it names. Don't approve on read-through alone; a plan that misnames a symbol or misses a dependency is a 🟡 at best.
3. **Reply with an explicit, labeled verdict** (always lead with it):
   - **🟢 GO** — plan is sound, implement as-is.
   - **🟡 GO with nits** — proceed now, fold these minor items in during implementation.
   - **🔴 NO-GO** — blockers; must be fixed before starting.
4. List any nits/blockers as **numbered, actionable items** Codex can apply without guessing (the problem + exact file/symbol + the required change). Briefly say why it's this tier and not the one below.
5. **If the verdict is 🟡 or 🔴, also emit a Codex handoff prompt** (see format below) so the user can paste the fixes straight to Codex.

---

## Entry point 2 — Post-push review & merge

The user says the branch is pushed. Execute in **strict order — PR is opened before the review**, so findings can live on the PR:

1. **Open the PR first:**
   ```
   gh pr create --base development --head spec/<NN>-<slug> --fill
   ```
   (Write a proper title/body per `context/git-conventions.md` if `--fill` isn't good enough.)
2. **Review the actual diff** against the spec: fetch the branch, read the diff, grep the writes/invariants the spec names, and **confirm forbidden/out-of-scope paths are untouched**. This is independent of any plan review.
3. **Post the verdict** (same 🟢/🟡/🔴 scale) in my response.
4. **If clean → merge immediately, same turn, no confirmation:**
   ```
   gh pr merge <N> --squash --delete-branch
   ```
   Squash (not `--merge`) per git-conventions — spec branches carry messy WIP commits; squash leaves one clean Conventional Commit on `development`. Then sync local:
   ```
   git checkout development && git pull --ff-only && git fetch -p
   ```
   Confirm HEAD advanced and I'm back on `development` with the spec branch gone.
5. **If fixes are needed → do NOT merge.** Give precise numbered fix notes **and a ready-to-paste Codex handoff prompt** (below). No merge until Codex re-pushes the same branch and I re-review clean.

---

## Codex handoff prompt (required whenever fixes are needed)

Whenever I flag fixes — at plan review (🟡/🔴) or at post-push review before merge — I also produce a self-contained prompt the user can paste straight to Codex. Codex lacks my context, so it must stand alone. Put it in a fenced code block, addressed to Codex:

- **Context line** — which spec + branch/PR, and whether this is *"fold into the plan before implementing"* or *"fix the pushed branch before merge."*
- **Numbered fixes** — each one: the problem, the exact file/symbol/line, and the required change. Concrete enough to apply without guessing (copy the actionable nit verbatim).
- **Guardrails** — what must NOT change (scope fences), and which tests/commands to re-run.
- **Close-out** — branch fixes → *"re-push the same `spec/<NN>` branch; do not merge."* Plan folds → *"update the plan to reflect these, then implement."*

Keep it tight and imperative. The numbered fixes in my verdict and the handoff prompt say the same things — the prompt is just the paste-ready form.

---

## What to scrutinize in a diff

These are the durable review instincts for this codebase (the financial engine is stabilized — math must not drift):

- **Merge gate** = the relevant invariant + regression suite is green on the PR. For financial-engine work that's the full financial-invariant + OrderCommit regression suite.
- **Stay inside the spec.** Confirm the diff touches only what the spec authorizes; flag any out-of-scope file, mutator, or schema change.
- **Derived, not stored** where the architecture says so — reject post-issuance truth mutations on write-once rows; prefer derive-on-demand over new caches unless the spec adds one.
- **Read-layer discipline** — no `@/lib/db` imports under `app/**` or `components/**`; UI renders financial meaning, never derives it.
- **Behavior no-ops must be provable** — if a spec claims "no behavior change," check that existing data passes the reworked invariants unchanged and the untouched functions are byte-identical.
- **Backfills/migrations** must be idempotent and **fail loud** on unclassifiable rows.

Spec-specific gates always live in the spec file and any linked plan in `context/reviews/` — read those for the exact assertions; the list above is the standing baseline.

---

## Guardrails

- **One spec per PR, in dependency order.** If an arc has a hard chain (F1 before B1, etc.), never reorder or parallelize — a later spec's invariants only pass after the earlier one merges green.
- **Never merge on a plan review.** Only entry point 2 merges.
- **Never push to `main` or `development` from a spec branch** — squash-merge via `gh` only.
- When in doubt about whether something is in scope for the spec, treat it as a finding (🟡/🔴), not a silent pass.
