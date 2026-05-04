# ui-context.md

# Studio OS – UI Context

## 1. Visual Direction

Studio OS should feel like a luxury neutral operations dashboard.

The interface should be:

- clean
- warm
- premium
- calm
- professional
- readable
- operational, not decorative

The system is for internal studio work, so clarity and speed are more important than flashy visuals.

---

## 2. Design Style

| Area | Direction |
|---|---|
| Mode | Light mode first |
| Feel | Luxury admin dashboard |
| Background | Warm off-white |
| Cards | White / ivory |
| Text | Charcoal |
| Accent | Muted gold / bronze |
| Layout | Sidebar + top bar |
| Components | Tables, cards, badges, tabs |
| Device priority | Desktop-first, tablet-friendly |

---

## 3. Color Tokens

## 3. Color Tokens

| Role           | CSS Variable              | Hex / Value |
|----------------|---------------------------|-------------|
| background     | `--color-background`      | #F7F3EC     |
| surface        | `--color-surface`         | #FFFFFF     |
| surface-soft   | `--color-surface-soft`    | #FBF8F2     |
| border         | `--color-border`          | #E6DED2     |
| text-primary   | `--color-text-primary`    | #1F1F1F     |
| text-secondary | `--color-text-secondary`  | #6F6A63     |
| text-muted     | `--color-text-muted`      | #9A9389     |
| accent         | `--color-accent`          | #B08A4A     |
| accent-dark    | `--color-accent-dark`     | #7A5A2A     |
| accent-soft    | `--color-accent-soft`     | #EFE3CF     |
| success        | `--color-success`         | #2F7D4E     |
| success-soft   | `--color-success-soft`    | #E7F4EC     |
| warning        | `--color-warning`         | #B7791F     |
| warning-soft   | `--color-warning-soft`    | #FFF3D6     |
| danger         | `--color-danger`          | #B42318     |
| danger-soft    | `--color-danger-soft`     | #FDE7E4     |
| info           | `--color-info`            | #3B6478     |
| info-soft      | `--color-info-soft`       | #E5F0F4     |


---

## 4. Typography

Use a readable dashboard font.

Recommended:

text Inter 

Rules:

- Use medium weights for headings
- Use regular weight for body text
- Avoid decorative fonts inside the dashboard
- Keep text compact but readable

Suggested scale:

| Style | Size | Weight | Usage |
|---|---:|---:|---|
| Page title | 28px | 600 | Main page heading |
| Section title | 20px | 600 | Card/section headings |
| Card title | 16px | 600 | Small dashboard cards |
| Body | 14px | 400 | Normal text |
| Small text | 12px | 400 | Metadata, labels |

---

## 5. Border Radius Scale

| Token | Value | Usage |
|---|---:|---|
| radius-sm | 6px | Small badges, inputs |
| radius-md | 10px | Buttons, form controls |
| radius-lg | 14px | Cards, tables |
| radius-xl | 18px | Modals, major panels |

Do not use overly round, playful shapes.

---

## 6. Component Library

Use:

- Tailwind CSS
- shadcn/ui components
- Lucide icons

Rules:

- Use reusable components for common UI
- Do not create one-off button/table/card styles
- Do not use random hex colors in components
- Use tokens and consistent variants

Core reusable components:

- Button
- Input
- Select
- Textarea
- Date picker
- Modal/Dialog
- Card
- Table
- Badge
- Tabs
- Dropdown menu
- Toast/notification
- Status timeline

---

## 7. Layout Pattern

Use a standard admin dashboard layout:

text Left Sidebar Top Bar Main Content Area 

### Sidebar

Should include:

- Dashboard
- Calendar
- Customers
- Bookings
- Orders
- Editing Queue
- Production Queue
- Invoices
- Commissions
- Reports
- Settings

### Top Bar

Should include:

- Global search
- Quick create button
- Notifications
- User menu

### Main Content

Should use:

- page title
- action buttons
- filter/search area
- table/card content
- status badges

---

## 8. Page Patterns

### Dashboard
Use summary cards:

- Today’s sessions
- Pending deposits
- Waiting selection
- Editing delays
- Ready for pickup
- Daily revenue
- Upgrade revenue
- Commission summary

---

### Calendar
Use calendar-first layout:

- day/week/month views
- color-coded session type
- booking status badge
- department filter

---

### Customer Profile
Use tab layout:

- Overview
- Children
- Sessions
- Invoices
- Notes
- History

---

### Order / Session Detail Page
Use sectioned layout:

- Customer info
- Booking details
- Package details
- Invoice/payment
- Photo selection
- Editing
- Production
- Pickup
- Timeline / audit log

---

### Queue Pages
Use tables with filters:

- Editing queue
- Production queue
- Waiting approval
- Ready for pickup

---

## 9. Status Badge Rules

Use badges consistently across the app.

| Status | Style |
|---|---|
| Pending | warning-soft background + warning text |
| Confirmed | success-soft background + success text |
| Waiting Selection | info-soft background + info text |
| Editing | info-soft background + info text |
| Revision | warning-soft background + warning text |
| Approved | success-soft background + success text |
| Production | info-soft background + info text |
| Ready | success-soft background + success text |
| Delivered | success-soft background + success text |
| Delayed | danger-soft background + danger text |
| Cancelled | danger-soft background + danger text |
| No-show | danger-soft background + danger text |
| Paid | success-soft background + success text |
| Unpaid | danger-soft background + danger text |

---

## 10. Table Rules

Use tables for admin-heavy pages.

Tables should include:

- search
- filters
- status badges
- clear actions
- compact rows
- sortable columns where useful

Do not overload tables with too many actions.

Use row click to open detail page.

---

## 11. Card Rules

Use cards for:

- dashboard KPIs
- customer summaries
- order sections
- production blocks
- payment summaries

Cards should be clean, lightly bordered, and spacious.

---

## 12. Forms

Forms should be:

- simple
- sectioned
- clear
- validated

Rules:

- required fields must be obvious
- errors should appear near fields
- save buttons should show loading state
- dangerous actions require confirmation

---

## 13. Icon Usage

Use Lucide icons.

Icon style:

- simple line icons
- no heavy filled icons
- consistent size

Common icons:

- Calendar
- User
- Users
- Baby
- Camera
- Image
- CreditCard
- Package
- FileText
- CheckCircle
- AlertTriangle
- Clock
- Truck
- Settings

---

## 14. Responsiveness

V1 is:

text Desktop-first Tablet-friendly 

Rules:

- Desktop layouts should be optimized first
- Tables may scroll horizontally on tablet
- Sidebar may collapse on smaller screens
- Do not design phone-first for V1

---

## 15. Visual Anti-Patterns

Avoid:

- random colors
- overly bright UI
- playful gradients
- too many shadows
- inconsistent badge colors
- decorative fonts
- crowded tables
- unclear icons
- hidden critical status information

---

## 16. Core UI Rule

text The UI should help staff know: What is happening? What is late? Who is responsible? What needs action next? 

Every screen should support that goal.

---