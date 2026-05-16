# Reconciliation No-Report Monitor

## Production Monitor

- Vendor: Healthchecks.io
- Check name: Lollipop financial reconciliation nightly report
- Dashboard URL: https://healthchecks.io/projects/<project-id>/checks/<check-id>
- Ping URL secret: `RECONCILIATION_PING_URL`

Replace the placeholder dashboard URL with the private Healthchecks.io check URL after the production check is created. The ping URL itself must stay in secrets and must not be committed.

## Schedule

- Expected runner: GitHub Actions `Financial Reconciliation`
- Runner command: `npm run financial:reconcile`
- Expected cadence: nightly at 02:00 studio-local time (`Asia/Kuwait`, UTC+3)
- Grace period: 4 hours
- Alert condition: no successful ping for more than 24 hours
- Alert destination: on-call financial Slack channel

## Success Semantics

The runner pings the monitor only after reconciliation completes and the Slack report posts successfully. A run that finds financial violations still counts as a delivered report when Slack delivery succeeds, because the no-report monitor is only checking that the nightly report arrived.

Missing `RECONCILIATION_PING_URL` disables pinging without failing the runner, which keeps local development and one-off smoke runs quiet.

## Setup

1. Create a Healthchecks.io check named `Lollipop financial reconciliation nightly report`.
2. Configure it for a daily schedule matching the GitHub Actions cron, with a 4-hour grace period.
3. Connect the check to the on-call financial Slack alert channel.
4. Store the check ping URL in the repository or environment secret `RECONCILIATION_PING_URL`.
5. Add the private dashboard URL above so on-call responders can find the check quickly.
6. Trigger the workflow manually and confirm Healthchecks.io records the ping after the Slack report posts.

## On-Call Response

When the no-report alert fires, check the latest `Financial Reconciliation` workflow run first. If the workflow did not run or failed before Slack delivery, inspect GitHub Actions logs and the configured secrets. If the workflow ran and Slack delivery succeeded, confirm `RECONCILIATION_PING_URL` is still configured and accepted by Healthchecks.io.
