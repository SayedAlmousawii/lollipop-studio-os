## 🎯 Feature Goal

Allow staff to record a booking deposit directly from the Booking page, while storing the data in the Invoice/Payment system.

This enables the flow:

PENDING → Deposit Recorded → CONFIRMED
---

## ⚠️ Rules

- UI lives in Bookings
- Data is owned by Invoice/Payment module
- Do NOT store deposit on booking table
- Use existing payment system

---

## 🧱 Scope

### ✅ In Scope

- “Record Deposit” button on booking
- Simple deposit form (modal or page)
- Create invoice if none exists
- Record payment as DEPOSIT
- Reflect deposit status on booking UI

### ❌ Out of Scope

- Full invoice editing
- Payment history UI improvements
- Commission logic

---

## 🖥️ UI

### Booking Actions (PENDING only)

- View Details  
- Edit Booking  
- Record Deposit  
- Confirm Booking  
- Cancel Booking  

---

### Deposit Form

Fields:

- Amount (default: 20 KD)
- Payment Method
- Reference (optional)

---

## 🔄 Behavior

On submit:

1. Ensure order/invoice exists (create if needed)
2. Create payment:
   - paymentType = DEPOSIT
   - amount = entered amount
3. Booking UI updates:
   - Deposit status → Paid
4. “Confirm Booking” becomes allowed

---

## 🧠 Service Layer

Use existing:

ts payment.service.ts → recordPayment() invoice.service.ts → createInvoice() 

Do NOT create new payment logic.

---

## 🧪 Server Action

Create:

text app/bookings/actions.ts → recordDepositAction 

---

## 🧪 Edge Cases

- Booking not found → error
- Deposit already recorded → prevent duplicate
- Payment fails → no UI update

---

## ✅ Definition of Done

- Deposit can be recorded from booking page
- Payment stored in DB
- Booking shows deposit as Paid
- Confirm Booking works after deposit
- Build passes
- No TypeScript errors
- Update `progress-tracker.md`
