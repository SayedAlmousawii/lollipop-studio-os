-- CreateTable
CREATE TABLE "order_add_ons" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "addOnOptionId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "priceSnapshot" DECIMAL(10,3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_add_ons_orderId_idx" ON "order_add_ons"("orderId");

-- AddForeignKey
ALTER TABLE "order_add_ons" ADD CONSTRAINT "order_add_ons_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_add_ons" ADD CONSTRAINT "order_add_ons_addOnOptionId_fkey" FOREIGN KEY ("addOnOptionId") REFERENCES "order_add_on_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: insert structured rows from existing Order.addOns JSON
INSERT INTO "order_add_ons" ("id", "orderId", "addOnOptionId", "nameSnapshot", "priceSnapshot", "quantity", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    o.id,
    CASE
        WHEN (addon->>'optionId') IS NOT NULL
             AND EXISTS (SELECT 1 FROM "order_add_on_options" WHERE id = addon->>'optionId')
        THEN (addon->>'optionId')
        ELSE NULL
    END,
    addon->>'name',
    (addon->>'price')::numeric(10,3),
    1,
    NOW(),
    NOW()
FROM "orders" o,
LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(o."addOns"::jsonb) = 'array' THEN o."addOns"::jsonb
        ELSE '[]'::jsonb
    END
) AS addon
WHERE (addon->>'name') IS NOT NULL
  AND (addon->>'price') IS NOT NULL;
