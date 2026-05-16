# Invariant Catalog

| ID | Name | Phase | Scope | Description |
|----|------|-------|-------|-------------|
| runtime-payment-has-exactly-one-allocation | payment-has-exactly-one-allocation | Phase C | global | Every payment has exactly one allocation. |
| runtime-allocation-sum-equals-payment-amount | allocation-sum-equals-payment-amount | Phase C | global | Payment allocation totals equal the payment amount. |
| runtime-financial-case-net-balance-non-negative | financial-case-net-balance-non-negative | Phase C | global | Financial case net balance cannot go below zero. |
| runtime-document-application-not-over-source | document-application-not-over-source | Phase C | global | Document applications cannot exceed their source capacity. |
| runtime-deposit-final-pair-has-document-application | deposit-final-pair-has-document-application | Phase C | global | Each paid deposit and final invoice pair has one document application. |
| runtime-no-payment-without-allocation | no-payment-without-allocation | Phase C | global | No payment may exist without an allocation. |
| runtime-adjustment-parent-is-final | adjustment-parent-is-final | Phase D | invoice | Adjustment invoices must point to a final invoice parent. |
| runtime-adjustment-same-financial-case-as-parent | adjustment-same-financial-case-as-parent | Phase D | invoice | Adjustment invoices must stay in the same financial case as their parent. |
| runtime-adjustment-never-chains | adjustment-never-chains | Phase D | invoice | Adjustment invoices cannot chain to adjustment parents. |
| INV-LOCK-SNAPSHOT | locked-invoice-frozen-fields-match-snapshot | Sprint 3 (80b) | invoice | Locked invoice frozen fields must match the latest lock snapshot. |
| runtime-adjustment-has-no-document-application | adjustment-has-no-document-application | Phase D | global | Adjustment invoices cannot receive document applications except line-targeted reversals. |
| runtime-no-adjustment-without-classifier-source | no-adjustment-without-classifier-source | Sprint 1 (75b) | invoice | Automatic adjustment invoices must have a classifier source activity. |
| runtime-out-payment-targets-refund-invoice | out-payment-targets-refund-invoice | Phase F | invoice | Outbound payments must target refund invoices. |
| runtime-refund-amount-not-over-source | refund-amount-not-over-source | Phase F | invoice | Refund totals cannot exceed the inbound amount on their source invoice. |
| runtime-refund-trace-points-to-inbound-payment | refund-trace-points-to-inbound-payment | Phase F | global | Refund traces must point back to inbound payments. |
| runtime-refund-source-is-final-or-adjustment | refund-source-is-final-or-adjustment | Phase F | invoice | Refund invoice parents must be final or adjustment invoices. |
| runtime-credit-note-targets-final | credit-note-targets-final | Phase F | invoice | Credit notes must target final invoices or line-targeted adjustment reversals. |
| runtime-credit-note-has-document-application | credit-note-has-document-application | Phase F | invoice | Credit notes must have the expected document application. |
| runtime-paid-adjustment-line-removal-must-have-reversal | paid-adjustment-line-removal-must-have-reversal | Sprint 2 (79a) | order | Paid adjustment lines removed from an order must have a credit-note reversal. |
| runtime-credit-note-amount-not-over-final | credit-note-amount-not-over-final | Phase F | invoice | Credit note totals cannot exceed the final invoice total. |
| runtime-credit-note-is-locked-on-issuance | credit-note-is-locked-on-issuance | Phase F | invoice | Credit notes are closed and locked when issued. |
| runtime-final-invoice-fully-paid-must-be-locked | final-invoice-fully-paid-must-be-locked | Sprint 1 (78a) | invoice | Fully paid final invoices must be closed and locked. |
| runtime-classifier-reductions-have-matching-credit-note | classifier-reductions-have-matching-credit-note | Sprint 1 (75c) | order | Classifier reductions must have matching credit notes and source activity. |
| INV-01 | payment-allocation-count | Phase G | global | Every Payment must have exactly one PaymentAllocation |
| INV-08 | adjustment-parent-not-adjustment | Phase G | invoice | ADJUSTMENT invoices must not chain to ADJUSTMENT parents |
| INV-09 | credit-note-application-target | Phase G | global | CREDIT_NOTE document applications must target FINAL invoices or ADJUSTMENT lines |
| INV-11 | refund-payment-direction | Phase G | global | REFUND invoice payments must use OUT direction |
| INV-15 | deposit-invoice-closed-locked | Phase G | invoice | DEPOSIT invoices must be closed and locked |
| INV-16 | payment-allocation-references-exist | Phase G | global | PaymentAllocation rows must reference existing payments and invoices |
| INV-17 | document-application-references-exist | Phase G | global | DocumentApplication rows must reference existing source and target invoices |
| INV-18 | order-composition-equals-revenue-documents | Phase G | order | FinancialCase invoice totals must reconcile to current order totals |
| INV-19 | final-invoice-resolves-to-order | Phase G | invoice | FINAL invoices must resolve to an order |
| INV-24 | open-invoice-effective-paid-cap | Phase G | invoice | Open invoice effective paid amount must not exceed total amount |
| INV-25 | fully-paid-final-invoice-closed-locked | Phase G | invoice | Fully paid FINAL invoices must be closed and locked |
| INV-PREFIX | invoice-number-prefix-matches-type | Phase G | invoice | Invoice number prefix must match invoice type |
| INV-REV | completed-order-revenue-reconciles | Phase G | order | Completed-order inbound revenue must reconcile to expected invoice revenue for the business day |
