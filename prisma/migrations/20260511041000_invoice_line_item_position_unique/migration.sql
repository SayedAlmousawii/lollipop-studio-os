-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_items_invoiceId_sortOrder_key" ON "invoice_line_items"("invoiceId", "sortOrder");
