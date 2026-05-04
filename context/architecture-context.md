# architecture.md

# Studio OS – Architecture

## 1. Stack Table

| Layer | Technology | Role |
|---|---|---|
| Frontend | Next.js + React | Admin dashboard and staff UI |
| Language | TypeScript | Type safety across frontend/backend |
| Styling | Tailwind CSS | Fast, consistent UI styling |
| Backend | Node.js API / NestJS recommended | Business logic, workflows, permissions, invoices, reports |
| Database | PostgreSQL | Main source of truth for customers, bookings, orders, payments, jobs |
| ORM | Prisma | Database schema, migrations, typed queries |
| Auth | Auth.js / Clerk / custom JWT | User login, sessions, role-based access |
| File Storage | Synology NAS manually linked in V1 | Stores actual photos/files outside database |
| Calendar | Internal booking calendar first | System owns bookings; Google Calendar sync later |
| Payments | Manual recording in V1 | Payment gateway integration later |
| Notifications | Manual/semi-template in V1 | WhatsApp/email automation later |
| Hosting | Hybrid recommended | Cloud app + local Synology media storage |

---

## 2. High-Level Architecture

Studio OS is a web-based internal operations system.

The database is the source of truth.

Google Calendar, payment links, WhatsApp, and Synology should be integrations — not the main source of truth.

text Staff Browser    ↓ Next.js Admin Dashboard    ↓ Backend API / Services    ↓ PostgreSQL Database    ↓ Optional Integrations: Google Calendar / Payment Gateway / WhatsApp / Synology 

---

## 3. System Boundaries

Recommended folder structure:

text src/ ├── app/ │   ├── dashboard/ │   ├── customers/ │   ├── bookings/ │   ├── orders/ │   ├── packages/ │   ├── invoices/ │   ├── jobs/ │   ├── commissions/ │   ├── reports/ │   └── settings/ │ ├── components/ │   ├── ui/ │   ├── forms/ │   ├── tables/ │   ├── calendar/ │   └── layout/ │ ├── modules/ │   ├── customers/ │   ├── bookings/ │   ├── packages/ │   ├── orders/ │   ├── invoices/ │   ├── payments/ │   ├── editing/ │   ├── production/ │   ├── commissions/ │   ├── reports/ │   └── auth/ │ ├── lib/ │   ├── db/ │   ├── auth/ │   ├── permissions/ │   ├── validators/ │   └── utils/ │ ├── integrations/ │   ├── google-calendar/ │   ├── payments/ │   ├── whatsapp/ │   └── synology/ │ └── types/ 

---

## 4. Module Responsibilities

### Customers Module
Owns:
- parent/customer profile
- phone number
- linked children
- customer history

Does not own:
- invoices
- job statuses
- production states

---

### Bookings Module
Owns:
- date/time
- department
- session type
- booking status
- assigned photographer
- selected themes
- deposit status

Does not own:
- final invoice totals
- package upgrade logic
- editing status

---

### Packages Module
Owns:
- package templates
- package price
- included items
- add-on definitions
- upgrade rules

Does not own:
- customer-specific final order

---

### Orders Module
Owns:
- original package
- final package
- selected photos count
- final deliverables
- add-ons
- current order state

---

### Invoice / Payment Module
Owns:
- invoice total
- deposit
- base payment
- upgrade payment
- add-on payment
- payment method
- payment status

---

### Editing Module
Owns:
- assigned editor
- edit status
- revision loop
- edit complete flag
- customer approval status

---

### Production Module
Owns:
- print job status
- album design status
- vendor album status
- ready for pickup status

---

### Commission Module
Owns:
- upgrade tracking
- photographer commission calculation
- commission status
- daily/monthly commission reports

---

### Reports Module
Owns:
- daily sales
- monthly sales
- upgrade revenue
- commission reports
- pending jobs
- delayed jobs

---

## 5. Storage Model

## PostgreSQL Database

Store structured business data:

- users
- roles
- customers
- children
- bookings
- sessions
- packages
- package items
- orders
- invoices
- payments
- upgrades
- add-ons
- editing jobs
- production jobs
- commissions
- vouchers
- audit logs
- reports metadata

---

## Synology NAS

Store actual media files:

- raw photos
- selected photos
- edited photos
- album design files
- final delivery folders

V1 approach:
- store manual Synology folder link/path in the order record

Example:

text Order NAS Folder: \\Synology\Newborn\2026-05-04\965XXXXXXXX-BabyName 

Future:
- automatic folder creation
- direct folder browsing
- automatic file linking

---

## Cache

Not required in V1.

Possible future uses:
- dashboard statistics
- report previews
- calendar availability
- notification queues

---

## 6. Auth & Access Model

Recommended roles:

- Admin
- Manager
- Receptionist
- Reservation Employee
- Photographer
- Editor
- Accountant

---

## Role Permissions

| Role | Can View | Can Edit | Restricted From |
|---|---|---|---|
| Admin | Everything | Everything | Nothing |
| Manager | Everything | Assignments, overrides, commissions, reports | Nothing major |
| Receptionist | Customers, bookings, orders | Create bookings, update reminders, customer info | Financial overrides, commissions |
| Reservation Employee | Calendar, bookings, themes | Scheduling and confirmation | Financial overrides |
| Photographer | Assigned sessions | Limited notes/status only | Payments, invoices, commissions |
| Editor | Assigned editing jobs | Edit status, revision status | Payments, customer financial info |
| Accountant | Invoices, payments, reports | Payment verification, reports | Editing/production changes |

---

## Auth Rules

- Every user must log in.
- Every action must be checked against role permissions.
- Sensitive actions require manager/admin permission.
- Financial changes must be audit logged.
- Commission changes must be audit logged.
- Package price overrides must be audit logged.

---

## 7. Background Tasks / Automation Model

V1:
- Mostly manual
- System shows reminders and pending tasks
- Staff sends WhatsApp messages manually

Future background tasks:
- automatic booking reminders
- selection reminders
- approval reminders
- pickup notifications
- delayed job alerts
- Google Calendar sync
- payment status sync
- daily report generation

Recommended future tool:
- Trigger.dev, BullMQ, or similar background job system

---

## 8. Integration Strategy

## Google Calendar

V1:
- internal booking calendar is source of truth
- optional manual calendar usage

Future:
- sync confirmed bookings to Google Calendar
- color-code events by session type
- attach theme links
- update calendar when booking changes

---

## Payments

V1:
- manually record KNET / link / cash payment

Future:
- payment gateway integration
- automatic payment confirmation
- automatic invoice status update

---

## WhatsApp

V1:
- manual messages or copied templates

Future:
- WhatsApp Business API integration
- automatic reminders
- pickup notifications
- approval follow-ups

---

## Synology

V1:
- manual folder link/path

Future:
- automatic folder creation
- file status tracking
- folder validation

---

## 9. Core Invariants

These are rules the codebase must never violate.

1. The database is the source of truth, not Google Calendar, WhatsApp, or Synology.

2. A booking cannot become confirmed until the 20 KD deposit is recorded.

3. A session cannot move to editing until the base package payment is recorded.

4. A package upgrade must replace the final package, not add a second package line.

5. Upgrade charges must be calculated from the difference between original paid package and final package.

6. Commission is created only from package upgrade revenue unless management defines another rule.

7. Every payment, package change, commission change, and financial override must be audit logged.

8. Editing, printing, album production, and pickup must be separate sub-statuses, not one flat status.

9. Staff members can only update the workflow area they are responsible for unless they are manager/admin.

10. An order should not be marked delivered until all required production jobs are complete.

11. Manual overrides must store who changed it, when, and why.

12. Package templates must not be modified retroactively in a way that changes old invoices/orders.

---

## 10. V1 Architecture Decision

For V1, build the system as:

- Web admin dashboard
- PostgreSQL database
- Manual payment recording
- Manual Synology folder linking
- Internal calendar/source of truth
- Manual WhatsApp messages
- Role-based staff accounts
- Basic reports

Integrations should be added after the workflow is stable.

---

## 11. Future Architecture Additions

Possible later additions:

- Google Calendar sync
- Payment gateway integration
- WhatsApp automation
- Synology direct integration
- Customer portal
- Online booking page
- Inventory system
- Multi-branch support
- Advanced analytics
- Cloud backup integration

---