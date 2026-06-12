## Goal

Add the shared `Note` operational domain — Phase 7 / POS Sales redesign Piece 2, build-order item **F2**. This is a backend-only foundation: a first-class, purpose-typed `Note` entity plus a **surface-agnostic** Notes module/service that any surface (Sales, order-details, future editing/production/delivery workflow tabs) can read and write. Notes are freeform operational annotations only — non-financial, live writes, never through OrderCommit. No UI in this spec — Spec B6 (Notes UI) and the order-details read-only bridge consume this domain later.

## Read First

- `context/reviews/pos-sales-redesign-planning.md` — Piece 2 (Notes): Locked Decisions 1–10, Future Direction, the **Foundational-correctness requirement** (build so the shared-note future is trivial — the entity/service are owned by a Notes module, **not** the Sales page, and are queryable by `(orderId, kind, orderPackageId)`), and Open Items N-1 (resolved) / N-2. Also Piece 3 → S-A and S-B for where notes will eventually surface (UI is out of scope here, but the service shape must support both entry points and both display slices).
- `src/modules/orders/order-activity.service.ts` — `recordOrderActivity(client, input)` is the canonical `OrderActivity` writer; `OrderActivityType.NOTE_ADDED` already exists in the schema enum. Note creation emits a `NOTE_ADDED` activity through this helper in the same transaction.
- `src/modules/albums/album.service.ts` — the sibling F1 module just merged (Spec 169); follow its shape for the new `src/modules/notes/` module: Zod-validated service inputs, a `select` constant + exported row type, an optional transaction-client parameter defaulting to `db`, no `OrderCommitDraft` interaction.
- `src/lib/permissions/index.ts` — `PERMISSIONS` map + `ROLE_PERMISSIONS`; `src/lib/auth/assert-actor-permission.ts` — `assertActorPermission(actorContext, permission)`. Note writes gate on a new `NOTE_WRITE` permission (see Scope); reads stay on `ORDER_READ`.

## Rules

- **Non-financial → live writes, never through OrderCommit** (Locked Decision 6). No `OrderCommitDraft` interaction, no draft guard, no preview/diff, no financial line. Notes are out-of-snapshot operational metadata, like `OrderAlbum` finishing fields.
- **Notes store freeform operational annotations only** (Locked Decision 3). They do **not** store financial events, package/album changes, commit history, discounts, approvals, or audit events — those live in OrderCommit history / FinancialCase history / `AuditLog`. Do not write note records from any financial or commit path.
- **No double-entry with `OrderAlbum`** (Locked Decision 4). Album specs (cover material, thread, layout, cover text) stay structured on `OrderAlbum`. Production-kind notes are freeform print/production remainder only.
- **The Notes module is shared infrastructure from day one** (Foundational-correctness requirement). It lives in `src/modules/notes/`, is owned by no single surface, and is queryable by `(orderId, kind, orderPackageId)` so any consumer can fetch the relevant slice without Sales-specific assumptions. New `Note` records are the single source of truth for typed notes immediately; the legacy per-row `notes String?` fields (`Order.notes`, `EditingJob.notes`, `ProductionJob.notes`, delivery pickup notes, etc.) **coexist untouched** in this pass (Locked Decision 7) — do not absorb, migrate, or write into them.
- **Editable working annotations** (Locked Decision 8). `Note` rows can be updated and hard-deleted; the audit log / activity timeline owns immutable history. Only **creation** emits a `NOTE_ADDED` `OrderActivity` (Locked Decision 9); edits and deletes do not emit activity (they are working-annotation churn, not timeline events).
- Follow `context/code-standards.md` module file pattern: `note.service.ts`, `note.schema.ts`, `note.types.ts`, `note.constants.ts`. Zod-validate all service inputs. No `@/lib/db` imports outside `src/modules/**` / `src/lib/**` / `tests/**`.

## Scope

### In Scope

1. **Schema** (`prisma/schema.prisma`):
   - New enum `NoteKind`: `CUSTOMER | PHOTOGRAPHER | EDITING | PRODUCTION | DELIVERY | INTERNAL` (six kinds, no catch-all "general" — Locked Decision 2).
   - New model `Note`:
     - `id`, `orderId` (required → `Order`, cascade) — the anchor.
     - `orderPackageId` (nullable → `OrderPackage`, **`onDelete: SetNull`**) — set = package-scoped, null = order-level. SetNull (not Cascade) so deleting a package downgrades its notes to order-level rather than destroying the annotation; the body still has value.
     - `kind: NoteKind`
     - `body: String` (text)
     - `authorUserId` (nullable → `User`, `onDelete: SetNull`) — null = customer-relayed, typed by staff on the customer's behalf; otherwise the staff author.
     - `createdAt` / `updatedAt`.
     - Indexes: `@@index([orderId, kind])` and `@@index([orderPackageId])` so the `(orderId, kind, orderPackageId)` query slices are covered.
   - Inverse relations: `notes Note[]` on `Order` and on `OrderPackage`; an author back-relation on `User` (e.g. `authoredNotes Note[]`).
   - Generate the migration.

2. **Permission** (`src/lib/permissions/index.ts`):
   - Add `NOTE_WRITE: "note:write"` to `PERMISSIONS`. Grant it to **every role** in `ROLE_PERMISSIONS` (all roles that hold `ORDER_READ` — annotations are low-risk and every workflow role legitimately writes its kind of note). This is a deliberate, **additive, non-restrictive** permission: it gates create/update/delete so the model is future-proof (a later spec could narrow which roles write which kinds) without restricting anyone today. Reads continue to use the existing `ORDER_READ`.

3. **New module `src/modules/notes/`**:
   - `note.constants.ts` — `NOTE_KIND` constant object (mirroring the `as const` status pattern) + any labels needed by the activity description.
   - `note.types.ts` / `note.schema.ts` — Zod schemas + inferred types for create / update / delete / query inputs, and the exported `NoteRow` payload type.
   - `note.service.ts`:
     - `getOrderNotes({ orderId, kind?, orderPackageId? })` — surface-agnostic query returning raw `Note` rows for the requested slice; `kind` and `orderPackageId` are optional filters (omitted = all). `orderPackageId: null` explicitly filters to order-level notes; omitted = no package filter. Ordered deterministically (e.g. `createdAt asc, id asc`). No projector here — B6 / order-details build their own surface projectors. This is the read the order-details near-term bridge (N-2) consumes.
     - `createNote({ orderId, kind, body, orderPackageId?, authorUserId?, actorContext })` — Zod-validated live write inside a transaction that (a) creates the `Note` row and (b) emits a `NOTE_ADDED` `OrderActivity` via `recordOrderActivity` on the same client. `authorUserId` defaults to the actor's user id; pass an explicit `null` for customer-relayed notes. Gated on `NOTE_WRITE`.
     - `updateNote({ id, body?, kind?, orderPackageId?, actorContext })` — live edit of an existing note's body/kind/scope (matches the eventual modal's editability). Gated on `NOTE_WRITE`. No activity emission.
     - `deleteNote({ id, actorContext })` — hard delete. Gated on `NOTE_WRITE`. No activity emission. (UI adds the confirmation; the service just deletes.)
   - `index.ts` — barrel export of the public service functions, `NoteRow`, and `NOTE_KIND`.

4. **Activity copy**: the `NOTE_ADDED` activity uses a concise title (e.g. "Note added") and a description carrying the kind (e.g. "Customer note added" or the body excerpt — keep it short); metadata includes `{ noteId, kind, orderPackageId }` for timeline rendering. Follow how existing `recordOrderActivity` callers in `invoice.service.ts` / `payment.service.ts` shape title/description/metadata.

### Out of Scope

- **No UI** (B6 — left-panel Notes section, per-package inline customer notes, add-note modal; depends on F2 + B1/B2). No wiring into the Sales page or order-details rendering — this spec ships the read/write service the bridge will consume, not the bridge UI.
- **No absorption or migration of legacy `notes String?` fields** (`Order.notes`, `EditingJob.notes`, `ProductionJob.notes`, delivery pickup notes, booking/customer/invoice/payment note fields). They coexist untouched (Locked Decision 7; later-absorption is Future Direction, not this pass).
- No `OrderCommit` / draft / preview / financial interaction of any kind.
- No new `OrderActivityType` (reuse existing `NOTE_ADDED`). No `AuditLog` entry for notes (they are not in the sensitive-actions list; the activity timeline covers visibility).
- No Album domain (F1, merged) or sidebar collapse (F3) work.

## Implementation Direction

Add the schema first (enum + `Note` model + relations + migration), then the `NOTE_WRITE` permission, then the `src/modules/notes/` module. The service mirrors the just-merged `src/modules/albums/` module's shape — Zod-validated inputs, a `select` constant with an exported row type, an optional transaction-client parameter defaulting to `db` — with two differences: note writes take an `actorContext` and call `assertActorPermission(actorContext, PERMISSIONS.NOTE_WRITE)` before mutating, and `createNote` wraps its row insert + `recordOrderActivity` call in a single transaction so the note and its `NOTE_ADDED` timeline entry are atomic (follow the transaction-plus-activity pattern used by `recordPayment` in `payment.service.ts`).

`getOrderNotes` is intentionally a thin, assumption-free query: callers pass any combination of `orderId` (required) + optional `kind` + optional `orderPackageId`, and get raw rows back. This is what lets order-details read typed notes the moment F2 ships (the N-2 read-only bridge) and what B6 will slice for the Sales left-panel grouping (by kind) and per-package inline customer notes (S-B) — all without the service knowing about any surface. Keep all grouping/labeling/formatting out of the service; those are projector/UI concerns for the consuming specs.

For `authorUserId`: the planning doc's "null = customer-relayed, typed by staff" means the column distinguishes a note the staff member authored themselves from one they typed on the customer's behalf. Default to the actor's user id when not specified; the eventual modal will offer the customer-relayed option that passes `null`.

## Post-Implementation

- Update `context/progress-tracker.md`: add a Feature History entry for Spec 170 and a Key State note (under "POS / orders / composition" or a new "Notes" line) that the shared `Note` domain exists — six kinds, order/package scope, live non-financial writes, `NOTE_ADDED` activity on create, single source of truth for typed notes with legacy `notes` fields coexisting.
- In `context/reviews/pos-sales-redesign-planning.md`, mark Piece 2 Open Item N-2 as satisfied by Spec 170's `getOrderNotes` read (order-details can read typed notes read-only as soon as the bridge UI is built; N-1 was already resolved).

## Acceptance Criteria

- `Note` model + `NoteKind` enum exist in `prisma/schema.prisma` with a generated migration; `Order` and `OrderPackage` expose `notes Note[]`, `User` exposes the author back-relation, `orderPackageId` is `onDelete: SetNull`, and `authorUserId` is `onDelete: SetNull`.
- `NOTE_WRITE` permission exists and is granted to every role; reads use `ORDER_READ`.
- `src/modules/notes/note.service.ts` exposes `getOrderNotes`, `createNote`, `updateNote`, `deleteNote`, all Zod-validated; write functions call `assertActorPermission(..., NOTE_WRITE)` before mutating.
- `createNote` is transactional: it inserts the `Note` row and emits exactly one `NOTE_ADDED` `OrderActivity` (via `recordOrderActivity`) atomically; `updateNote` / `deleteNote` emit no activity.
- `createNote` defaults `authorUserId` to the actor and accepts an explicit `null` for customer-relayed notes.
- `getOrderNotes` returns the correct slice for each `(orderId, kind?, orderPackageId?)` combination, including the order-level-only filter (`orderPackageId: null`), with no surface-specific grouping or formatting in the service.
- No `OrderCommitDraft` / preview / financial code is touched; no legacy `notes` field is read or written; no new `OrderActivityType` or `AuditLog` row for notes.
- New tests cover: `Note` CRUD, the create→`NOTE_ADDED`-activity atomicity, the `(orderId, kind, orderPackageId)` query slices, the permission gate (every role currently passes `NOTE_WRITE`, so assert the gate is enforced via the `assertActorPermission` path — e.g. a missing `actorRole` is rejected — rather than a role-lacks-permission case, which cannot exist under the all-roles grant), and `orderPackageId` SetNull behavior on package delete.
- `npm run build` passes.
- `npm run lint` passes.
