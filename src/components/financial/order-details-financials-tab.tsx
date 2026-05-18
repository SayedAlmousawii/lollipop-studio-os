import {
  FinancialLinkedDocuments,
  FinancialPaymentSummary,
  FinancialTotalSource,
  type LockedFinancialSidebarSummary,
} from "@/components/financial";
import { InvoiceLineItems } from "@/components/financial/invoice-line-items";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  LinkedFinancialDocument,
  POSWorkspace,
} from "@/modules/orders/order.types";

export function OrderDetailsFinancialsTab({
  workspace,
  linkedDocuments,
  summary,
}: {
  workspace: POSWorkspace | null;
  linkedDocuments: LinkedFinancialDocument[];
  summary: LockedFinancialSidebarSummary | null;
}) {
  if (!workspace?.invoice || !summary) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-text-secondary">
            No financial activity yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Financial Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <FinancialPaymentSummary summary={summary} />
          <FinancialTotalSource summary={summary} />
          <FinancialLinkedDocuments documents={linkedDocuments} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceLineItems lineItems={workspace.invoice.lineItems} />
        </CardContent>
      </Card>
    </div>
  );
}
