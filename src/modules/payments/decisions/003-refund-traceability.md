# Refund Traceability

`Payment.refundOfPaymentId` is nullable to support goodwill refunds. When set, it must reference an inbound payment allocated to the same source invoice and financial case.
