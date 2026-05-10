## Goal

Surface the `NO_SHOW` status transition for confirmed bookings in the UI. The service already supports it — this is a UI-only gap.

---

## Read First

- `src/components/bookings/booking-status-actions.tsx` — the `STATUS_ACTIONS` map; currently `Confirmed` only has `Cancel Booking`
- `src/modules/bookings/booking.service.ts` — verify `updateBookingStatus()` handles `NO_SHOW` and what transition guard (if any) is in place for a CONFIRMED → NO_SHOW transition; confirm it is treated as a terminal state (no further transitions)
- `app/bookings/actions.ts` — `updateBookingStatusAction` already wires through to the service; no new action needed

---

## Rules

- No schema changes
- No service changes unless a blocking guard is discovered
- UI change only: extend `STATUS_ACTIONS` map

---

## Implementation Direction

Add `{ label: "Record No-Show", nextStatus: "NO_SHOW" }` to the `Confirmed` entry in `STATUS_ACTIONS`. Mark it as destructive so the confirmation dialog fires (same `isDestructive` flag used for cancel). The confirmation message should distinguish from cancellation — "Mark this booking as a no-show?" is sufficient. No service changes are needed. No schema changes. Verify in the service that a confirmed booking with or without base payment can transition to NO_SHOW (the business needs this path open regardless of payment state — a no-show means the customer didn't arrive, not that they paid). If the service has an unexpected guard blocking this, document it and ask before working around it.

---

## Acceptance Criteria

- [ ] "Record No-Show" button appears on CONFIRMED bookings
- [ ] Confirmation dialog fires before submission
- [ ] Booking transitions to NO_SHOW status on confirm
- [ ] NO_SHOW bookings show no further action buttons (terminal state)
- [ ] No-show is visually distinct from cancelled in the status badge (verify `booking-status-badge.tsx` has a NO_SHOW case)
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
