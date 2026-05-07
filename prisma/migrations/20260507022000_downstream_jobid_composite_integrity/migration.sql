ALTER TABLE "orders" DROP CONSTRAINT "orders_bookingId_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_orderId_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_bookingId_fkey";
ALTER TABLE "payments" DROP CONSTRAINT "payments_invoiceId_fkey";

CREATE UNIQUE INDEX "bookings_id_jobId_key" ON "bookings"("id", "jobId");
CREATE UNIQUE INDEX "orders_id_jobId_key" ON "orders"("id", "jobId");
CREATE UNIQUE INDEX "orders_bookingId_jobId_key" ON "orders"("bookingId", "jobId");
CREATE UNIQUE INDEX "invoices_id_jobId_key" ON "invoices"("id", "jobId");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_bookingId_jobId_fkey"
  FOREIGN KEY ("bookingId", "jobId") REFERENCES "bookings"("id", "jobId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_orderId_jobId_fkey"
  FOREIGN KEY ("orderId", "jobId") REFERENCES "orders"("id", "jobId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_bookingId_jobId_fkey"
  FOREIGN KEY ("bookingId", "jobId") REFERENCES "bookings"("id", "jobId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_invoiceId_jobId_fkey"
  FOREIGN KEY ("invoiceId", "jobId") REFERENCES "invoices"("id", "jobId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
