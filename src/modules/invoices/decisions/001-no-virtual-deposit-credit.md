# 001 No Virtual Deposit Credit

## Rule

Deposit credit must be represented by an explicit document-application record, never by a runtime aggregate shortcut.

## Why

Hidden virtual credit makes balances harder to reason about, harder to audit, and easier to break during future financial phases.

## How To Apply

When final-invoice settlement needs deposit credit, create and read explicit transfer rows instead of recomputing the credit through ad hoc invoice scans.
