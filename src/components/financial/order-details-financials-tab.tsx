import {
  FinancialLinkedDocuments,
  FinancialPaymentSummary,
  FinancialTotalSource,
  type LockedFinancialSidebarSummary,
} from "@/components/financial";
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
          {workspace.invoice.lineItems.length > 0 ? (
            <div className="space-y-3">
              {workspace.invoice.lineItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-soft px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {item.description}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {item.lineType} · {item.quantity} × {item.unitPriceLabel}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-text-primary">
                    {item.lineTotalLabel}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-border bg-surface-soft p-3 text-sm text-text-secondary">
              No price breakdown lines are available.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
