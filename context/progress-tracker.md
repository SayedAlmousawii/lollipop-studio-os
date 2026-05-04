# Progress Tracker

Update this file after every meaningful implementation
change.

## Current Phase

- Feature 3 TBD

## Current Goal

- Implement the next feature spec after the design system.

## Completed

- Feature 02: Design system unit (`context/feature-specs/02-design-system.md`):
  - shadcn/ui installed and configured for Next.js + Tailwind v4
  - `src/lib/utils.ts` with `cn()` helper (clsx + tailwind-merge)
  - `lucide-react` installed
  - 15 shadcn components installed in `src/components/ui/`:
    button, card, dialog, input, label, textarea, select, tabs,
    badge, table, dropdown-menu, separator, sheet, tooltip, sonner
  - Design tokens from `ui-context.md` added to `app/globals.css`
  - Build passes with no TypeScript or compile errors

## In Progress

- None.

## Next Up

- Implement the next feature spec (check `context/feature-specs/` for the next unit).

## Open Questions

- `context/architecture.md` was referenced by the repo instructions but is not present in `context/`.

## Architecture Decisions

- tsconfig `@/*` alias set to `["./src/*", "./*"]` so shadcn imports (`@/lib/utils`, `@/components/ui/*`) resolve to `src/` without requiring `app/` to move inside `src/`.
- `@theme inline` used in `globals.css` so Tailwind color utility classes get values baked in, avoiding CSS custom property shadowing of the `:root` design token declarations.
- shadcn `--color-accent` maps to `#EFE3CF` (soft hover background) per shadcn convention; the gold accent is exposed as `--color-primary` / `bg-primary`. Raw gold is still available as `var(--color-accent)` from `:root`.

## Session Notes

- Read required context files: `project-overview.md`, `ui-context.md`, `code-standards.md`, `ai-workflow-rules.md`, and this tracker.
- Tailwind v4 is in use (`@tailwindcss/postcss`); shadcn/ui configured to work with Tailwind v4.
- `class-variance-authority` was not auto-installed by shadcn add; installed manually.
