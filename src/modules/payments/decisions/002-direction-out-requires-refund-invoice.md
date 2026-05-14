# Direction OUT Requires Refund Invoice

Outbound Payments (`direction=OUT`) must target REFUND-type invoices. Money out without a REFUND invoice is forbidden.

Reason: preserves the invariant that every money movement has an invoice.
