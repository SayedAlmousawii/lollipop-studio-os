## Goal

Move the authenticated Studio OS shell to one persistent protected route-group layout so the main sidebar/topbar behave like a true app-wide shell. Today `AppShell` is mounted separately by each top-level section layout (`orders`, `customers`, `bookings`, etc.), which makes shell-owned UI state fragile across cross-section navigation. This cleanup keeps all public URLs unchanged while making the protected app shell mount once above the protected sections.

## Read First

- `app/layout.tsx` — root providers only; currently also seeds the sidebar-collapse provider from the cookie.
- `src/components/layout/app-shell.tsx` — authenticated shell with `Sidebar`, `Topbar`, permission-driven nav visibility, and the main content column.
- `src/components/layout/sidebar-collapse-provider.tsx` and `src/components/layout/sidebar-collapse-preference.ts` — temporary root-level collapse-state plumbing added after Spec 171; this unit should keep the behavior but relocate it to the persistent protected shell boundary if cleaner.
- Existing section layouts: `app/(dashboard)/layout.tsx`, `app/orders/layout.tsx`, `app/bookings/layout.tsx`, `app/calendar/layout.tsx`, `app/customers/layout.tsx`, `app/editing/layout.tsx`, `app/invoices/layout.tsx`, `app/packages/layout.tsx`, `app/pricing/layout.tsx`, `app/production/layout.tsx`, `app/products/layout.tsx`, `app/session-configurations/layout.tsx`, `app/session-types/layout.tsx`.
- `proxy.ts` — Clerk protection remains middleware-owned; `/sign-in(.*)` is the only public route matcher today.

## Rules

- **No URL changes.** Use Next route groups, not path segments. `/orders`, `/customers`, `/bookings`, `/`, etc. must stay exactly the same.
- **Auth routes stay outside the app shell.** `/sign-in` must not render `AppShell`, `Sidebar`, or `Topbar`.
- **Do not change business logic.** No backend, schema, service, permission, DB, financial, OrderCommit, or workflow changes.
- **Do not change nav contents or permissions.** Preserve `showProductionLink` / `showProductsLink` behavior and all existing nav hrefs.
- **Preserve Spec 171 behavior.** Sidebar collapse must persist across cross-section navigation and full reloads without hydration mismatch or one-frame expansion.
- **Keep file moves mechanical.** Do not refactor pages/actions while moving them; only adjust imports if a relative import breaks.
- **Prefer one persistent protected shell.** `AppShell` should be mounted by one protected route-group layout, not by every section layout.

## Scope

### In Scope

1. **Create a protected route group**:
   - Add a new route group such as `app/(app)/layout.tsx`.
   - Mount one persistent `<AppShell>{children}</AppShell>` there.
   - Move protected route folders/pages into the route group without changing URLs:
     - dashboard/root page currently under `app/(dashboard)/`
     - `bookings`, `calendar`, `customers`, `editing`, `invoices`, `orders`, `packages`, `pricing`, `production`, `products`, `session-configurations`, `session-types`

2. **Remove per-section shell layouts**:
   - Delete the section `layout.tsx` files whose only job is wrapping children in `AppShell pageTitle="..."`.
   - Keep any page/action files otherwise unchanged.

3. **Replace per-section page-title props**:
   - Since one persistent `AppShell` can no longer receive a static section title from each section layout, derive the topbar title centrally from the current pathname.
   - Use a small client component/helper near the layout components, e.g. `TopbarTitle` or a `getPageTitleFromPathname()` helper, with an explicit map:
     - `/` → `Dashboard`
     - `/bookings` → `Bookings`
     - `/calendar` → `Calendar`
     - `/customers` → `Customers`
     - `/orders` → `Orders`
     - `/packages` → `Packages`
     - `/invoices` → `Invoices`
     - `/editing` → `Editing`
     - `/production` → `Production`
     - `/products` → `Products`
     - `/pricing` → `Pricing`
     - `/session-types` → `Session Types`
     - `/session-configurations` → `Session Configurations`
   - Nested pages inherit their section title unless a currently existing route explicitly used a different shell title.

4. **Simplify sidebar collapse state location**:
   - Keep cookie-backed first-paint persistence.
   - Move `SidebarCollapseProvider` from `app/layout.tsx` to the protected route-group layout if that still preserves first-paint correctness.
   - Root `app/layout.tsx` should return to global providers only (`ClerkProvider`, `PointerEventsGuard`, global CSS/font/html/body).

### Out of Scope

- No Sales B1 shell redesign, page-layout restyle, fixed-panel redesign, or POS single-view work.
- No mobile drawer, responsive auto-collapse, keyboard shortcut, or sidebar visual redesign.
- No changes to Clerk middleware rules beyond what is required to keep current public/protected behavior identical.
- No new nav items and no permission-model changes.
- No package moves outside `app/**` and the small layout-component changes required by this cleanup.

## Implementation Direction

Create one protected route group, for example `app/(app)/layout.tsx`, and make it the only place that renders `AppShell`. Move each protected route directory into that group. Route groups do not affect URLs, so `app/(app)/orders/page.tsx` still serves `/orders`, and `app/(app)/(dashboard)/page.tsx` or `app/(app)/page.tsx` still serves `/` depending on the chosen mechanical move. Keep `/sign-in/[[...sign-in]]/page.tsx` outside the group so it remains public and shell-free. Keep `app/unauthorized.tsx` outside the shell unless current behavior proves it already intentionally renders inside `AppShell`.

Remove the old section layouts after the move. The old page title strings they carried should become one central pathname-to-title mapping used by the topbar. Prefer keeping `AppShell` mostly server-owned for auth/permission checks and making only the title display/pathname lookup a small client component, because `usePathname()` is client-only. Do not move permission logic into the client.

After the protected shell is persistent, normal `next/link` sidebar navigation should preserve client state naturally. Keep the cookie-backed collapse provider for reload persistence and first paint, but locate it at the persistent protected shell boundary rather than the global public root if possible. The sidebar should not need native `<a>` navigation workarounds, forced refreshes, or post-mount localStorage correction.

Use `git mv` or equivalent file moves carefully so review shows route relocation rather than page rewrites. After moving, search for relative imports from affected files and fix only broken imports. Most imports should already use `@/`, so churn should be small.

## Observability Checklist

### Dashboards / Metrics

- No runtime metrics or discrepancy logs are added; this is a shell/routing cleanup.

### Rollback Plan

- Revert the route-group move and restore the previous per-section `layout.tsx` wrappers.
- No schema or data migration exists.
- No irreversible data changes.

### Customer-Visible Surface

- URLs stay the same.
- Staff should see the same sidebar, topbar, and page content.
- The sidebar collapse state should feel more stable because the shell no longer remounts on every cross-section navigation.

## Post-Implementation

- Update `context/progress-tracker.md` with a Feature History entry for Spec 172.
- If any route-group decision is non-obvious after implementation, add one concise Key State note under the relevant UI/shell section only if it is not derivable from the code.

## Acceptance Criteria

- One protected route-group layout owns `AppShell` for all authenticated app sections.
- `/sign-in` remains outside `AppShell` and still renders without sidebar/topbar.
- App URLs are unchanged for `/`, `/orders`, `/bookings`, `/calendar`, `/customers`, `/invoices`, `/packages`, `/pricing`, `/production`, `/products`, `/session-types`, and `/session-configurations`.
- Cross-section navigation no longer remounts a separate per-section `AppShell`.
- Sidebar collapse/expand persists across client navigation and full reloads, with no hydration warning and no expanded reset after clicking sidebar nav items.
- Topbar titles match the previous per-section titles for all existing sections and nested routes.
- The sidebar uses normal Next navigation (`Link`) for nav items; no native-anchor or forced-refresh workaround is needed for collapse persistence.
- No backend, schema, service, permission, DB, financial, OrderCommit, or workflow files are changed.
- `npm run build` passes.
- `npm run lint` passes.
