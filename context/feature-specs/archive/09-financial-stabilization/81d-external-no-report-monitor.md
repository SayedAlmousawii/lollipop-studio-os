## Goal

The nightly financial reconciliation runner posts results to Slack. Its failure mode today is *silent*: if cron, the runner, or Slack delivery fails, nobody knows until the next manual check. Add an external "no-report-in-24h" monitor that pages or alerts when the expected report does not arrive.

Closes roadmap item **O5**.

---

## Read First

- `context/reviews/77-post-verification-hardening-roadmap.md` — §8 O5
- `context/reviews/77-phase-g-production-reconciliation-review.md` — Ops §D
- Cron / runner configuration — search for `npm run financial:reconcile` invocations in CI configs and any scheduled-task config files
- Slack webhook integration code path — search `slack` / `webhook` in `src/`

---

## Rules

- The monitor is **external** to this codebase. Healthchecks.io or an equivalent service receives a "ping" every successful run; the absence of a ping for >24h fires an alert to the on-call channel.
- The runner pings the monitor only on **successful completion** — meaning: invariants ran, Slack post succeeded. A partial-failure run does not ping (failure path already alerts via Slack; absence of any signal is what this monitor catches).
- No new server-side state — the ping is fire-and-forget HTTPS.
- The ping URL is configured via env var (`RECONCILIATION_PING_URL` or similar). Missing env var disables pinging without error (so local dev runs don't try to ping).

---

## Scope

### In Scope

**Runner pinger**

In the reconciliation runner (`npm run financial:reconcile` entry point — locate the actual file via grep), after a successful end-to-end run:

```ts
const pingUrl = process.env.RECONCILIATION_PING_URL;
if (pingUrl) {
  try {
    await fetch(pingUrl, { method: 'POST' });
  } catch (err) {
    console.warn('Reconciliation ping failed (non-fatal):', err);
  }
}
```

A failed ping does *not* fail the run — the run was successful; the monitoring channel is the only impacted surface.

**External monitor setup**

Out-of-band (not committed to code): create a check on Healthchecks.io (or equivalent) with:
- Schedule: nightly (matching the cron schedule).
- Grace period: 4 hours (allow for runner latency).
- Alert channel: the team's on-call / oncall-financial Slack channel.

Document the dashboard URL and the env-var setup in `context/ops/reconciliation-monitor.md` (new file).

**Smoke test**

Manual: trigger the runner on dev with `RECONCILIATION_PING_URL` set to a test endpoint (Healthchecks.io has a test mode). Confirm the ping reaches the monitor.

### Out of Scope

- Persisted `reconciliation_runs` table (A6 — deferred per §12).
- Failure-channel alerting — already wired through Slack failure path.
- Per-invariant alerting granularity — the monitor is binary (ran/didn't run). Per-invariant detail is in the Slack report itself.
- Alternative monitor implementations (Datadog, Sentry, custom cron-monitor) — Healthchecks.io is the chosen vendor; switch later if ops prefers.

---

## Implementation Direction

**Risk:** Low. ~10 lines of code in the runner, plus external-config documentation.

**Order of work:**

1. Locate the reconciliation runner entry point. Confirm the success path.
2. Add the ping block after the last successful step (post-Slack-success).
3. Set up the Healthchecks.io check. Capture URL.
4. Document in `context/ops/reconciliation-monitor.md`.
5. Test by triggering the runner with the URL set; confirm ping arrives.

**Rollback:** revert the PR; delete the Healthchecks.io check.

---

## Verification

- `npm run build` passes.
- `npm run lint` passes.
- Manual: dev runner with test URL → ping reaches monitor.
- Manual: dev runner without `RECONCILIATION_PING_URL` → no ping attempt, no error.
- The `context/ops/reconciliation-monitor.md` doc exists and includes the monitor URL + onboarding steps for new oncalls.

---

## Post-Implementation

- Update `context/reviews/77-post-verification-hardening-roadmap.md`: mark O5 as completed.
- Update `progress-tracker.md`.
