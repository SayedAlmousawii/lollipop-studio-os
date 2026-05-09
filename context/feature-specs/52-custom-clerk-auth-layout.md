## Goal

Redesign the current sign-in page so it no longer feels like the default Clerk screen and instead presents a Studio OS branded authentication experience.

This unit should keep Clerk's built-in authentication flow and base UI components, especially `<SignIn />`, while wrapping them in a custom Studio OS layout and styling system that matches the rest of the product.

---

## Read First

- `agents.md`
- `context/ai-workflow-summary.md`
- `context/code-standards-summary.md`
- `context/ui-context.md`
- `context/feature-specs/50-auth-and-staff-identity-foundation.md`
- inspect the current sign-in route and auth layout structure before finalizing file paths

---

## Rules

- Keep this unit focused on auth page presentation only
- Clerk continues to own authentication logic, session handling, validation states, and auth flows
- Use Clerk base components such as `<SignIn />`; do not replace them with a fully custom form
- Use Clerk's `appearance` prop to style the embedded Clerk UI so it feels native to Studio OS
- Match the Studio OS visual system from `context/ui-context.md`
- Use existing CSS variables and design tokens; do not hardcode random hex colors inside components
- Prefer Tailwind, shadcn/ui primitives, and existing reusable card/layout patterns where possible
- Do not change auth backend behavior, Clerk config strategy, or linked-user logic in this unit
- Do not add role-based redirect logic unless the current app already supports it
- Do not change dashboard auth guards unless a minimal route/layout adjustment is truly required for the UI shell

---

## Scope

### In Scope

- redesign the sign-in page layout around the existing Clerk sign-in flow
- create a two-column desktop auth layout
- add a Studio OS branding/information panel on the left side
- place a Studio OS styled sign-in card on the right side containing Clerk's `<SignIn />`
- style Clerk base UI through the `appearance` prop and surrounding layout wrappers
- apply responsive behavior so the layout stacks cleanly on tablet and smaller screens
- reuse existing tokens, spacing, card surfaces, and typography direction already established for Studio OS

### Out of Scope

- custom auth backend
- custom password handling
- building custom email/password fields when Clerk already provides them
- replacing Clerk's internal auth logic
- role-based redirects unless already supported
- dashboard auth guard changes unless required for the page to render correctly
- broader redesign of app chrome beyond the auth entry experience

---

## Layout Direction

The page should feel like a premium internal Studio OS entry screen rather than a generic auth template.

Desktop layout requirements:

- two-column layout
- left column = branding / information panel
- right column = sign-in card with Clerk `<SignIn />`

Left branding/info panel should support content such as:

- Studio OS name or lockup
- short product positioning text
- a concise internal-use or operations-focused supporting message
- optional lightweight visual treatment or status/value highlights if they fit the existing design system

Right sign-in area should:

- center or comfortably align the sign-in card within its column
- use an ivory / white card surface
- preserve a calm, high-trust, admin-dashboard feel
- keep Clerk's built-in actions, links, and validation UX intact

Tablet and smaller-screen requirements:

- stack into a single-column layout
- keep branding content above or around the sign-in card without crowding the form
- maintain comfortable spacing and card readability
- avoid clipped panels, horizontal overflow, or cramped Clerk UI states

---

## Visual Direction

The auth experience should match the existing Studio OS look:

- warm off-white page background
- ivory / white card surfaces
- charcoal text
- muted gold / bronze accents
- clean luxury admin-dashboard tone

Use the tokens from `context/ui-context.md`, especially the existing color variables such as:

- `--color-background`
- `--color-surface`
- `--color-surface-soft`
- `--color-border`
- `--color-text-primary`
- `--color-text-secondary`
- `--color-accent`
- `--color-accent-dark`
- `--color-accent-soft`

Requirements:

- do not introduce random one-off colors inside React components
- prefer token-backed Tailwind utilities or existing theme mappings already used by the app
- keep typography readable, compact, and operational rather than decorative
- preserve the premium neutral dashboard feel from the UI context

---

## Clerk Styling Direction

This unit should style the embedded Clerk UI through the supported `appearance` API rather than replacing Clerk internals.

Requirements:

- use Clerk `<SignIn />`
- style the outer auth card and surrounding layout in app code
- style Clerk-owned sub-elements through `appearance`
- ensure buttons, inputs, borders, text, links, and focus states visually align with Studio OS tokens
- preserve Clerk features such as:
  - validation errors
  - forgot password flow
  - sign-up link if enabled
  - social login buttons if configured

Do not:

- rebuild the sign-in form from scratch
- replace Clerk validation or submission handling
- create parallel auth state management for the page

---

## Reuse Direction

Prefer existing project patterns before inventing new auth-only UI structures.

Look for reuse opportunities such as:

- existing page-shell spacing patterns
- existing `Card` or card-like wrappers
- shared typography or section header patterns
- shared container/max-width conventions
- shared button/input visual language where it can inform Clerk `appearance` styling

If the existing app already has a reusable auth wrapper or neutral marketing-style split layout, reuse or extend it instead of duplicating structure.

---

## Likely Files To Touch

Inspect the actual app structure before finalizing paths, but this unit will likely touch files such as:

- `app/sign-in/[[...sign-in]]/page.tsx`
- `app/layout.tsx` only if the current Clerk provider or auth page wrapper needs a minimal appearance-related adjustment
- a shared auth layout wrapper or auth-specific presentational component under a path such as:
  - `src/components/auth/`
  - `src/components/layout/`
- any token-aware styling helpers already used for theme or Clerk appearance mapping

Do not assume these exact files are correct without checking the current app structure first.

---

## Acceptance Criteria

- the sign-in page presents a Studio OS branded auth layout instead of the default Clerk-looking screen
- the desktop layout uses a two-column structure with:
  - left branding/info panel
  - right sign-in card containing Clerk's `<SignIn />`
- tablet and smaller screens use a clean stacked layout
- Clerk auth logic remains unchanged and still uses Clerk base components
- Clerk `<SignIn />` is styled through supported `appearance` customization
- the page uses existing Studio OS tokens from `context/ui-context.md`
- no random hardcoded hex colors are introduced in components
- the login page renders correctly
- Clerk sign-in still works
- Google or other social login still works if configured
- forgot password and sign-up links still work if enabled
- the responsive layout works across desktop, tablet, and smaller screens
- no hydration errors are introduced
- TypeScript passes
- `npm run build` passes
- `npm run lint` passes

---

## Testing / Checklist

- login page renders
- Clerk sign-in still works
- Google/social login still works if configured
- forgot password/sign-up links still work if enabled
- responsive layout works
- no hardcoded styling outside approved tokens
- no hydration errors

---

## Assumptions

- Feature 50 already established the working Clerk provider, sign-in route, and auth protection foundation
- the current app should continue treating Clerk as the source of auth behavior, not custom page logic
- Studio OS already has the required design tokens or CSS variable mappings available for reuse
- if Clerk appearance customization has practical limits, the layout and surrounding surfaces should carry the primary branding while keeping Clerk internals supported and maintainable
