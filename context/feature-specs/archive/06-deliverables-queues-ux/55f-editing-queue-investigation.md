## Goal

Profile the `/editing` page render to identify what is causing the slow load. Document findings. No fix is implemented in this spec — a follow-up unit will fix the bottleneck once the cause is known.

---

## Background

The editing queue page (`/editing`, implemented in Feature 54a) sometimes takes a long time to render. The bottleneck is unknown — it could be a slow DB query, missing pagination, or a heavy client-side render.

---

## Investigation Steps

### 1. Measure DB query time

In the data-fetching function for the editing queue (find it via the `app/editing/page.tsx` server component), add timing around the DB call:

```ts
const start = Date.now();
const result = await getEditingQueue(...);
console.log(`[editing-queue] DB query: ${Date.now() - start}ms`);
```

Load the page with a realistic data set and check the server logs.

### 2. Check for missing pagination

Read the `getEditingQueue` query. Does it have a `take` limit? If not, it loads all editing jobs regardless of count. Note the current record count in the DB.

### 3. Check for N+1 patterns

Review the Prisma query — does it use nested selects or do relation lookups in a loop? Identify any N+1 patterns.

### 4. Check client-side render cost

If the DB query is fast (< 200ms) but the page still feels slow, the issue may be client-side. Check whether the editing queue uses client components that do heavy computation on mount.

### 5. Check if the issue is cold-start

A slow first load that is fast on refresh points to a cold-start / uncached server component issue, not a query or render issue.

---

## Deliverable

Write findings directly in this spec file under a new `## Findings` section at the bottom. Include:
- DB query time
- Total record count
- Whether pagination is present
- Whether N+1 patterns exist
- Suspected primary bottleneck

The findings will be used to write a targeted fix spec (55f-fix).

---

## Post-Investigation

**`context/progress-tracker.md`**
- Update Now section: Feature 55f investigation complete; bottleneck identified (summarize in one line)
- Do not close 55f — mark it as "investigation complete, fix pending"

## Findings

- DB query time: `19ms` for the current local data set when running the same Prisma query used by `getEditingQueue()`.
- Total record count: `1` queue record currently matches the editing-page filter (`SELECTION_COMPLETED` or `EDITING`). The local database has `2` total orders overall.
- Pagination: not present. `fetchEditingQueue()` in `src/modules/orders/order.service.ts` uses `db.order.findMany(...)` with no `take` or cursor/offset limit, so it will load every matching queue row.
- N+1 patterns: none found in the current query path. The editing queue is fetched in a single Prisma query with nested relation selects for `customer`, `booking`, and `editingJob.assignedEditor`.
- Client-side render cost: unlikely to be the culprit. `app/editing/page.tsx` is a server component and `src/components/editing/editing-queue-table.tsx` is a simple table render with no client component boundary, mount effects, or heavy computation.
- Suspected primary bottleneck: cold-start / server-render startup overhead, not the current database query. With only `1` matching row and a `19ms` query time, the data fetch is too small to explain a noticeably slow page on this data set. The missing pagination is still a scalability risk for future larger queues and should be the first thing revisited in `55f-fix`.
- Broader note: if the same slow-first-load behavior is happening across several pages, `55f-fix` should profile shared request overhead before focusing only on `/editing`. The next pass should compare first load vs refresh across a few representative pages and time shared steps such as `requireCurrentAppUserPermission()`, Prisma connection/query warmup, and layout/server-component rendering. If those shared steps dominate, one targeted fix may improve many pages at once.
