
## Goal

Build the Edit Booking page that allows staff to update booking details such as:

- customer  
- package  
- date/time  
- session type  
- notes  

while respecting pre-session constraints and scheduling logic.

---

## Read First

- agents.md

---

## Rules

- Do NOT modify shadcn/ui components  
- Use server actions + service layer  
- Booking module owns booking data  
- Do NOT touch:
  - orders  
  - invoices  
  - payments  

- Respect invariant:

> A booking cannot be confirmed until deposit is recorded  

---

## 🧱 Scope

### ✅ In Scope

- Edit booking UI  
- Update booking fields  
- Rescheduling (date/time change)  
- Change package  
- Change session type  
- Update notes  

---

### ❌ Out of Scope

- Deposit/payment logic  
- Order creation  
- Calendar sync (future feature)  
- Staff assignment (optional future)

---

## 🧩 Data Ownership

Bookings own:
- date/time  
- session type  
- booking status  
- assigned photographer  
- themes  
- deposit status  

---

## 🖥️ Page Route

/bookings/[bookingId]/edit

---

## 🧾 Page Layout

---

### Header

- Title: Edit Booking
- Subtitle: customer name
- Back button → Bookings page or Booking details
- Save button (primary)

---

### Section 1: Booking Summary (Read-only)

- Customer name  
- Current package  
- Booking status  
- Deposit status  

---

### Section 2: Customer

- Customer select (dropdown)

⚠️ Changing customer should be allowed carefully (no validation for V1)

---

### Section 3: Package

- Package select dropdown

---

### Section 4: Date & Time

- Date picker  
- Time input  

---

### Section 5: Session Type

- Select:
  - Newborn  
  - Kids  
  - Family  
  - Other  

---

### Section 6: Notes

- Textarea  

---

## 🔄 Behavior Rules

---

### 1. Rescheduling

- Changing date/time = allowed
- Future: may check availability (not in V1)

---

### 2. Status Safety

Editing allowed only if:

- NOT completed  
- NOT cancelled  

---

### 3. Deposit Integrity

- DO NOT modify deposit status here  
- Deposit is handled via payment system  

---

### 4. Package Change

- Allowed before session  
- Does NOT affect order yet  

---

## 🧠 Service Layer

### File

src/modules/bookings/booking.service.ts

---

### New Function

ts updateBooking(bookingId: string, input: UpdateBookingInput) 

---

### Input Type

ts type UpdateBookingInput = {   customerId: string   packageId: string   date: Date   sessionType: SessionType   notes?: string } 

---

### Responsibilities

- Validate input  
- Update booking record  
- Return updated booking  

---

## 🧪 Server Action

### File

app/bookings/[bookingId]/edit/actions.ts

---

### Action

updateBookingAction

---

### Responsibilities

- Parse FormData  
- Validate (Zod)  
- Call service  
- Redirect → /bookings

---

## 🧩 UI Component

### File

src/components/bookings/edit-booking-form.tsx

---

### Requirements

- Client component  
- Uses:
  - useActionState  
  - useFormStatus  

Handles:
- field state  
- loading state  
- errors  

---

## 📄 Page Implementation

### File

app/bookings/[bookingId]/edit/page.tsx

---

### Behavior

- Fetch:
  - booking  
  - customers  
  - packages  

- Render:
  - header  
  - form  

---

## 🎨 UI Notes

- Same style as “New Booking” page  
- Use cards per section  
- Keep layout consistent with Orders edit page  

---

## 🧪 Edge Cases

- Booking not found → 404  
- No customers/packages → disable save  
- Invalid date → validation error  

---

## ✅ Definition of Done

- Booking can be edited successfully  
- Changes persist in DB  
- No TypeScript errors  
- Build passes  
- UI consistent  
- No financial logic leakage  

