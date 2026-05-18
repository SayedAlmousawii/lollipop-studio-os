"use client";

import { useEffect } from "react";

type GroupedInvoiceLineItem = {
  id: string;
  lineType: string;
  description: string;
  quantity: number;
  unitPrice?: string;
  unitPriceLabel?: string;
  lineTotal?: string;
  lineTotalLabel?: string;
};

export function InvoiceLineItems({
  lineItems,
  emptyLabel = "No price breakdown lines are available.",
}: {
  lineItems: GroupedInvoiceLineItem[];
  emptyLabel?: string;
}) {
  const regularLines = lineItems.filter((item) => !isSessionConfigurationLine(item));
  const sessionConfigurationLines = lineItems.filter(isSessionConfigurationLine);

  useEffect(() => {
    if (sessionConfigurationLines.length === 0) return;
    console.info(
      JSON.stringify({
        metric: "invoice.session_configuration_lines_grouped_render",
        count: sessionConfigurationLines.length,
      })
    );
  }, [sessionConfigurationLines.length]);

  if (lineItems.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface-soft p-3 text-sm text-text-secondary">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {regularLines.map((item) => (
        <InvoiceLineRow key={item.id} item={item} />
      ))}
      {sessionConfigurationLines.length > 0 ? (
        <div className="space-y-2 pt-1">
          <p className="text-xs font-medium uppercase text-text-muted">
            Session Configuration
          </p>
          {sessionConfigurationLines.map((item) => (
            <InvoiceLineRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InvoiceLineRow({ item }: { item: GroupedInvoiceLineItem }) {
  const unitPrice = item.unitPriceLabel ?? item.unitPrice ?? "0.000 KD";
  const lineTotal = item.lineTotalLabel ?? item.lineTotal ?? "0.000 KD";

  return (
    <div className="rounded-md border border-border bg-surface-soft px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{item.description}</p>
          <p className="text-xs text-text-secondary">
            {item.quantity} × {unitPrice}
          </p>
        </div>
        <span className="text-sm font-medium tabular-nums text-text-primary">
          {lineTotal}
        </span>
      </div>
    </div>
  );
}

function isSessionConfigurationLine(item: GroupedInvoiceLineItem): boolean {
  return (
    item.lineType === "SESSION_CONFIGURATION" ||
    item.lineType === "Session Configuration"
  );
}
