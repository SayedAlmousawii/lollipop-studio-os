# UI Context Summary

## 1. Purpose
Visual design tokens, component rules, layout patterns, and status badge conventions for Studio OS.

---

## 2. Key Rules / Principles

- Light mode, luxury neutral dashboard feel — warm, clean, professional
- Desktop-first; tablet-friendly (no mobile-first design in V1)
- Use Tailwind CSS + shadcn/ui components + Lucide icons
- Always use CSS variables for colors — never raw hex in components
- Use shared reusable components; no one-off button/table/card styles

---

## 3. Required Patterns / Constraints

**Color tokens:**

| Role | CSS Variable | Hex |
|---|---|---|
| background | `--color-background` | #F7F3EC |
| surface | `--color-surface` | #FFFFFF |
| surface-soft | `--color-surface-soft` | #FBF8F2 |
| border | `--color-border` | #E6DED2 |
| text-primary | `--color-text-primary` | #1F1F1F |
| text-secondary | `--color-text-secondary` | #6F6A63 |
| text-muted | `--color-text-muted` | #9A9389 |
| accent | `--color-accent` | #B08A4A |
| accent-dark | `--color-accent-dark` | #7A5A2A |
| accent-soft | `--color-accent-soft` | #EFE3CF |
| success | `--color-success` | #2F7D4E |
| success-soft | `--color-success-soft` | #E7F4EC |
| warning | `--color-warning` | #B7791F |
| warning-soft | `--color-warning-soft` | #FFF3D6 |
| danger | `--color-danger` | #B42318 |
| danger-soft | `--color-danger-soft` | #FDE7E4 |
| info | `--color-info` | #3B6478 |
| info-soft | `--color-info-soft` | #E5F0F4 |

**Typography (font: Inter):**

| Style | Size | Weight | Usage |
|---|---:|---:|---|
| Page title | 28px | 600 | Main page heading |
| Section title | 20px | 600 | Card/section headings |
| Card title | 16px | 600 | Small dashboard cards |
| Body | 14px | 400 | Normal text |
| Small text | 12px | 400 | Metadata, labels |

**Border radius:**

| Token | Value | Usage |
|---|---:|---|
| radius-sm | 6px | Badges, inputs |
| radius-md | 10px | Buttons, form controls |
| radius-lg | 14px | Cards, tables |
| radius-xl | 18px | Modals, major panels |

**Layout:** Left Sidebar + Top Bar + Main Content Area

Sidebar links: Dashboard, Calendar, Customers, Bookings, Orders, Editing Queue, Production Queue, Invoices, Commissions, Reports, Settings

**Status badge rules:**

| Status | Background | Text |
|---|---|---|
| Pending | warning-soft | warning |
| Confirmed | success-soft | success |
| Waiting Selection | info-soft | info |
| Editing | info-soft | info |
| Revision | warning-soft | warning |
| Approved | success-soft | success |
| Production | info-soft | info |
| Ready | success-soft | success |
| Delivered | success-soft | success |
| Delayed | danger-soft | danger |
| Cancelled | danger-soft | danger |
| No-show | danger-soft | danger |
| Paid | success-soft | success |
| Unpaid | danger-soft | danger |

**Core reusable components to use:**
Button, Input, Select, Textarea, DatePicker, Modal/Dialog, Card, Table, Badge, Tabs, DropdownMenu, Toast, Status Timeline

**Page patterns:**
- Dashboard → summary stat cards
- Calendar → day/week/month; color-coded by session type
- Session Types → permission-gated admin table grouped by department, with create/edit dialogs, archive/unarchive actions, calendar label/color controls, and zero-priced extra-photo indicators
- Pricing → permission-gated extra-photo pricing table grouped by department, one row per active session type, with digital/print unit prices edited together in a dialog and non-retroactive invoice banner copy
- Customer Profile → tabs: Overview, Children, Sessions, Invoices, Notes, History
- Order Detail → sections: Customer, Booking, Package, Invoice, Selection, Editing, Production, Pickup, Audit Log; the Financials tab uses the shared read-only `src/components/financial/` surfaces against the POS workspace/FinancialCase linked documents, then shows Price Breakdown from the final invoice locked snapshot.
- Locked Sales View → left column renders the shared normalized CurrentCompositionCard in locked mode; right column uses FinancialSidebarLocked with Payment Summary, Total Source, Linked Financial Documents, and the Open/Resume/Take Over Adjustment Workspace actions; pre-lock sales uses FinancialSidebarDraft and keeps the original computed/snapshot invoice sidebar behavior
- Shared Financial UI → `src/components/financial/` owns read-only Payment Summary, Total Source, Linked Financial Documents, and formatting helpers for FinancialCase-aware displays. POS injects action affordances through component slots; Order Details passes none and stays read-only.
- Adjustment Workspace → main column renders Stage Edits POS mounts, Preview Composition through CurrentCompositionCard in adjustment mode, Pending Changes, then Pending Adjustment Summary with Cancel/Discard; right column uses FinancialSidebarAdjustment with pending-only financial preview and Finalize/Issue action. The three order financial sidebar orchestrators are Draft, Locked, and Adjustment.
- Queue pages → filterable tables (Editing, Production, Waiting Approval, Ready for Pickup)

---

## 4. What to Avoid

- No random hex colors in components — use CSS variable tokens
- No inline styles
- No overly bright UI, playful gradients, or too many shadows
- No decorative fonts inside the dashboard
- No inconsistent badge colors
- No crowded tables — use row click to open detail page
- No phone-first designs in V1
- Do not use overly round shapes (no playful radius)

---

## 5. When to Read Full Document

Read `ui-context.md` when:
- Implementing a new page type not covered above
- Unsure about specific icon choices
- Reviewing full form or card styling guidelines

---

## Recommended Usage
**Read when building or modifying any UI component, page, or layout.**
