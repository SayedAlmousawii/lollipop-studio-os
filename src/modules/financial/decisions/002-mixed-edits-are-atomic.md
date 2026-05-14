# Mixed Edits Are Atomic

Edits that produce both additions and reductions in one save are atomic: one
ADJUSTMENT and one CREDIT_NOTE are issued in the same transaction.

If either document fails to issue, the whole order-edit save rolls back.

Reason: order-edit save flows must not produce partial financial states.
