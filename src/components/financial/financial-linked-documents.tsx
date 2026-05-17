import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { LinkedFinancialDocument } from "@/modules/orders/order.types";
import {
  formatEnumLabel,
  formatSignedDocumentAmount,
} from "./financial-format";

export function FinancialLinkedDocuments({
  documents,
  renderRowExtras,
}: {
  documents: LinkedFinancialDocument[];
  renderRowExtras?: (document: LinkedFinancialDocument) => ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
        Linked Financial Documents
      </p>
      {documents.length > 0 ? (
        <div className="space-y-2">
          {documents.map((document) => (
            <LinkedFinancialDocumentRow
              key={document.invoiceId}
              document={document}
              rowExtras={renderRowExtras?.(document)}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-border bg-surface-soft p-3 text-sm text-text-secondary">
          No linked financial documents found.
        </p>
      )}
    </section>
  );
}

function LinkedFinancialDocumentRow({
  document,
  rowExtras,
}: {
  document: LinkedFinancialDocument;
  rowExtras?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/invoices/${document.invoiceId}`}
          className="min-w-0 text-sm font-medium text-text-primary hover:text-accent-dark"
        >
          {document.invoiceNumber}
        </Link>
        <span className="text-sm font-semibold tabular-nums text-text-primary">
          {formatSignedDocumentAmount(document)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="rounded-md">
            {formatEnumLabel(document.invoiceType)}
          </Badge>
          <Badge variant="secondary" className="rounded-md">
            {formatEnumLabel(document.invoiceStatus)}
          </Badge>
        </div>
        {rowExtras}
      </div>
    </div>
  );
}
