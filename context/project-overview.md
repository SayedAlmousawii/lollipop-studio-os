# 📸 Studio Operating System (Studio OS) – Project Overview

---

## 🧭 1. Overview

Studio OS is an internal web-based system designed to manage the full operational workflow of a photography studio.

It centralizes:
- customer management
- bookings and scheduling
- package selection and pricing
- payment tracking
- photo selection
- editing workflow
- production (prints & albums)
- delivery and pickup
- staff coordination and commissions

The goal is to replace fragmented tools (WhatsApp, Google Calendar, manual tracking) with a structured, state-driven system.

---

## 🎯 2. Goals

1. Centralize all studio operations in one system  
2. Accurately track every session from booking → delivery  
3. Handle dynamic pricing (packages, upgrades, add-ons)  
4. Improve staff coordination across departments  
5. Track revenue, payments, and commissions clearly  
6. Reduce manual errors and missed steps  
7. Provide real-time visibility into all jobs and statuses  

---

## 👤 3. Primary Users

### Internal Staff
- Receptionist → booking, reminders, customer handling  
- Reservation employee → scheduling and coordination  
- Photographer → session execution (view-only access)  
- Editor → editing workflow and revisions  
- Manager → full control, assignments, approvals  
- Accountant (optional) → financial tracking and reports  

---

## 🔄 4. Core User Flow (End-to-End)

### Booking Phase
1. Customer contacts via WhatsApp  
2. Selects package  
3. Chooses date/time  
4. Booking created (PENDING)  
5. Deposit (20 KD) paid → booking CONFIRMED  
6. Themes selected and attached  
7. Reminder sent before session  

---

### Session Phase
1. Customer arrives  
2. Signs social media consent form  
3. Session conducted  

---

### Post-Session Phase
1. Customer pays full package price  
2. Photos uploaded to storage (Synology)  
3. Status → WAITING_SELECTION  

---

### Selection Phase
1. Customer selects photos (same day or within 1 month)  
2. System evaluates:
   - within package → no extra cost  
   - exceeds package → upgrade or add-ons  

---

### Payment Adjustment Phase
Customer chooses:
- Keep package → pay add-ons  
- Upgrade package → replace package + pay difference  

---

### Editing Phase
1. Job assigned to editor  
2. Editing completed (2–3 days, max 2 weeks)  
3. Sent to customer for approval  
4. Revisions loop until approved  

---

### Production Phase
- Photos → printed in-house  
- Albums → designed → approved → sent to vendor → received  

---

### Delivery Phase
1. Customer notified  
2. Pickup completed  
3. Order marked DELIVERED  

---

## ⚙️ 5. Features (V1 Scope)

### Customer Management
- Parent (phone-based)
- Children tracking
- Session history

---

### Booking System
- Calendar-based scheduling
- Deposit tracking
- Session type (newborn / kids)
- Theme selection

---

### Package System
- Predefined packages
- Dynamic package replacement (upgrade)
- Included deliverables tracking

---

### Invoice & Payment System
- Multi-stage payments:
  - deposit
  - base payment
  - upgrade/add-ons
- Payment tracking
- Invoice generation

---

### Selection System
- Track selected photos
- Compare against package limits
- Suggest upgrades vs add-ons

---

### Editing Workflow
- Assign editors
- Track status
- Handle revision loops

---

### Production Tracking
- Print jobs (in-house)
- Album jobs (external vendor)
- Status updates

---

### Commission System
- Track upgrades
- Calculate photographer commissions
- Track commission status (pending / paid)

---

### Reporting (Basic)
- Daily revenue
- Monthly revenue
- Upgrade revenue
- Commission reports
- Pending jobs

---

## 🚫 6. Out of Scope (V1)

- Customer mobile app  
- Online booking portal  
- Full automation (WhatsApp, reminders)  
- Synology integration (auto-linking)  
- Inventory management  
- Advanced analytics dashboards  

---

## 🧱 7. System Principles

- State-driven workflow (no manual guessing)  
- Packages are templates, not fixed outcomes  
- Orders are dynamic and evolve after selection  
- Payments are multi-stage  
- Each department updates its own status  
- All actions must be traceable (who + when)  

---

## ✅ 8. Success Criteria

The system is successful when:

- Staff can manage full session lifecycle without external tools  
- All bookings, payments, and jobs are tracked in one place  
- Upgrades and add-ons are calculated automatically  
- No step in workflow is missed or unclear  
- Managers can see real-time status of all sessions  
- Reports accurately reflect business performance  

---

## 🏁 9. Definition of Done (V1)

- A session can go from booking → delivery entirely inside the system  
- Payments are fully tracked and accurate  
- Package upgrades and add-ons work correctly  
- Editing and production statuses are visible  
- Staff can operate without relying on WhatsApp or manual tracking  

---