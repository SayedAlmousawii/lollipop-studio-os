# 001 DocumentApplication Scope

## Rule

`DocumentApplication` is reserved for credit transfers between invoices only.

## Why

This keeps credit-transfer math separate from invoice-settlement math and avoids overloading one table with two meanings.

## How To Apply

When money is being settled directly against an invoice, use payment-allocation behavior. When value is being moved from one invoice document to another, use `DocumentApplication`.
