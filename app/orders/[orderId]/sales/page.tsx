import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ChevronDown, Lock, ReceiptText, RotateCcw } from "lucide-react";
import { createOrderInvoiceAction } from "@/app/orders/[orderId]/actions";
import {
  addOrderProductAddOnAction,
  removeOrderAddOnAction,
  updateOrderPackageAction,
  updateOrderSelectedPhotoCountAction,
  upgradeOrderPackageItemAction,
  type POSCompositionActionState,
} from "@/app/orders/[orderId]/sales/actions";
import {
  openAdjustmentWorkspaceAction,
  takeOverAdjustmentWorkspaceAction,
} from "@/app/orders/[orderId]/adjustment-workspace/actions";
import { requireCurrentAppUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import {
  POSPackageComposition,
  POSPhotoCountCard,
} from "@/components/orders/pos-package-composition";
import { POSRecordPaymentDialog } from "@/components/orders/pos-record-payment-dialog";
import {
  getEffectiveCompositionForInvoice,
  getOpenWorkspaceForInvoice,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import { getPOSWorkspace } from "@/modules/orders/order.service";
import type { POSWorkspace } from "@/modules/orders/order.types";
import type {
  HandlerResult,
  POSAddOnHandlers,
  POSCompositionHandlers,
} from "@/modules/orders/pos-handlers.types";
import styles from "./sales-page.module.css";

export default async function SalesPage(
  props: PageProps<"/orders/[orderId]/sales">
) {
  const { orderId } = await props.params;
  const [workspace, appUser] = await Promise.all([
    getPOSWorkspace(orderId),
    requireCurrentAppUser(),
  ]);
  if (!workspace) notFound();

  if (workspace.invoice?.isLocked) {
    const [effectiveComposition, openWorkspace] = await Promise.all([
      getEffectiveCompositionForInvoice(workspace.invoice.invoiceId),
      getOpenWorkspaceForInvoice(workspace.invoice.invoiceId),
    ]);
    return (
      <div className={styles.salesGrid}>
        <main className="space-y-5">
          <LockedInvoiceAdjustmentGate
            workspace={workspace}
            effectiveComposition={effectiveComposition}
            openWorkspace={openWorkspace}
            currentUserId={appUser.id}
            isManager={appUser.role === "ADMIN" || appUser.role === "MANAGER"}
          />
        </main>
        <FinancialSidebar workspace={workspace} />
      </div>
    );
  }

  const compositionHandlers = createPOSCompositionHandlers(orderId);
  const addOnHandlers = createPOSAddOnHandlers(orderId);

  return (
    <div className={styles.salesGrid}>
      <main className="space-y-5">
        <POSPackageComposition
          workspace={workspace}
          handlers={compositionHandlers}
        />
        <POSPhotoCountCard
          workspace={workspace}
          handlers={compositionHandlers}
        />
        <POSAddOnMarketplace
          workspace={workspace}
          handlers={addOnHandlers}
        />
      </main>
      <FinancialSidebar workspace={workspace} />
    </div>
  );
}

function createPOSCompositionHandlers(orderId: string): POSCompositionHandlers {
  async function changePackageTier(input: {
    orderPackageId: string;
    toPackageRefId: string;
  }): Promise<HandlerResult> {
    "use server";

    return callPOSServerAction(updateOrderPackageAction, orderId, {
      orderPackageId: input.orderPackageId,
      packageId: input.toPackageRefId,
    });
  }

  async function upgradePackageItem(input: {
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }): Promise<HandlerResult> {
    "use server";

    return callPOSServerAction(upgradeOrderPackageItemAction, orderId, {
      orderPackageId: input.orderPackageId,
      packageItemId: input.packageItemId,
      newProductId: input.toProductId,
    });
  }

  async function changeSelectedPhotoCount(input: {
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }): Promise<HandlerResult> {
    "use server";

    return callPOSServerAction(updateOrderSelectedPhotoCountAction, orderId, {
      orderPackageId: input.orderPackageId,
      selectedPhotoCount: input.selectedPhotoCount,
      extraDigitalCount: input.extraDigitalCount,
      extraPrintCount: input.extraPrintCount,
    });
  }

  return {
    changePackageTier,
    upgradePackageItem,
    changeSelectedPhotoCount,
    shouldPromptInlineApproval: true,
  };
}

function createPOSAddOnHandlers(orderId: string): POSAddOnHandlers {
  async function addAddOn(input: {
    productId: string;
    quantity: number;
  }): Promise<HandlerResult> {
    "use server";

    return callPOSServerAction(addOrderProductAddOnAction, orderId, {
      productId: input.productId,
    });
  }

  async function removeAddOn(input: {
    addOnId: string;
  }): Promise<HandlerResult> {
    "use server";

    return callPOSServerAction(removeOrderAddOnAction, orderId, {
      addOnId: input.addOnId,
    });
  }

  async function changeAddOnQuantity(): Promise<HandlerResult> {
    "use server";

    return {
      ok: false,
      errors: {
        _global: ["Changing add-on quantity is not available on this POS surface."],
      },
    };
  }

  return {
    addAddOn,
    removeAddOn,
    changeAddOnQuantity,
    shouldPromptInlineApproval: true,
  };
}

type POSServerAction = (
  orderId: string,
  previousState: POSCompositionActionState,
  formData: FormData
) => Promise<POSCompositionActionState>;

async function callPOSServerAction(
  action: POSServerAction,
  orderId: string,
  fields: Record<string, string | number>
): Promise<HandlerResult> {
  const formData = new FormData();
  for (const [field, value] of Object.entries(fields)) {
    formData.set(field, String(value));
  }

  return handlerResultFromActionState(await action(orderId, {}, formData));
}

function handlerResultFromActionState(
  state: POSCompositionActionState
): HandlerResult {
  if (state.kind === "success") {
    return { ok: true };
  }

  return {
    ok: false,
    errors: normalizeActionErrors(state.errors),
    approval: state.kind === "approval-required" ? state.payload : undefined,
  };
}

function normalizeActionErrors(
  errors: POSCompositionActionState["errors"]
): Record<string, string[]> {
  if (!errors) {
    return {};
  }

  const normalized: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(errors)) {
    if (messages?.length) {
      normalized[field] = messages;
    }
  }
  return normalized;
}

function LockedInvoiceAdjustmentGate({
  workspace,
  effectiveComposition,
  openWorkspace,
  currentUserId,
  isManager,
}: {
  workspace: POSWorkspace;
  effectiveComposition: Awaited<ReturnType<typeof getEffectiveCompositionForInvoice>>;
  openWorkspace: Awaited<ReturnType<typeof getOpenWorkspaceForInvoice>>;
  currentUserId: string;
  isManager: boolean;
}) {
  const isOwner = openWorkspace?.currentOwnerUserId === currentUserId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4 text-accent" />
            Locked Composition
          </span>
          <Badge variant="outline" className="rounded-md">
            Read only
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {openWorkspace ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
            <span>
              Workspace open by {openWorkspace.currentOwnerUser?.name ?? openWorkspace.openedByUser.name} since{" "}
              {openWorkspace.openedAt.toLocaleString()}.
            </span>
            <div className="flex flex-wrap gap-2">
              {isOwner ? (
                <Button asChild>
                  <Link href={`/orders/${workspace.orderId}/adjustment-workspace`}>
                    Resume Workspace
                  </Link>
                </Button>
              ) : null}
              {!isOwner && isManager ? (
                <form
                  action={takeOverAdjustmentWorkspaceAction.bind(
                    null,
                    workspace.orderId,
                    openWorkspace.id
                  )}
                >
                  <Button type="submit" variant="outline">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Take Over
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        ) : (
          <form
            action={openAdjustmentWorkspaceAction.bind(
              null,
              workspace.orderId,
              workspace.invoice!.invoiceId
            )}
            className="rounded-md border border-border bg-surface-soft p-3"
          >
            <Button type="submit">Open Adjustment Workspace</Button>
          </form>
        )}

        <div className="space-y-2">
          {effectiveComposition.lines.map((line) => (
            <div
              key={line.lineId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-soft p-3 text-sm"
            >
              <div>
                <p className="font-medium text-text-primary">{line.label}</p>
                <p className="text-text-secondary">
                  {line.quantity} × {line.unitPrice} KD
                </p>
              </div>
              <p className="font-medium text-text-primary">{line.lineTotalNet} KD</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FinancialSidebar({ workspace }: { workspace: POSWorkspace }) {
  const invoice = workspace.invoice;
  const packageAmount =
    workspace.packageLines.reduce(
      (sum, line) => sum + line.currentPackage.price,
      0
    );
  const extraPhotoAmount = workspace.extraPhotoTotal;
  const totalAmount =
    invoice?.invoiceTotal ??
    packageAmount + extraPhotoAmount + workspace.addOnTotal;

  return (
    <aside className={styles.financialSidebar}>
      <Card className="border-text-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-base">
            <span className="inline-flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-accent" />
              Financial Summary
            </span>
            {invoice?.isLocked ? (
              <Badge variant="outline" className="rounded-md">
                Locked
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {invoice ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  Invoice #{invoice.invoiceNumber}
                </p>
                <Badge variant="secondary" className="w-fit rounded-md">
                  {invoice.invoiceStatus}
                </Badge>
              </div>
              {invoice.isLocked ? (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  Invoice locked. Composition changes now require the future adjustment flow.
                </div>
              ) : null}
              <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                {invoice.renderMode === "SNAPSHOT"
                  ? "Snapshot line items"
                  : "Computed current composition"}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-border bg-surface-soft p-3 text-sm text-text-secondary">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              No invoice exists yet. The sidebar is showing the current commercial totals.
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            {invoice?.renderMode === "SNAPSHOT" && invoice.lineItems.length > 0 ? (
              invoice.lineItems.map((item) => (
                <InvoiceLineRow
                  key={item.id}
                  label={item.description}
                  meta={`${item.quantity} × ${item.unitPriceLabel}`}
                  value={item.lineTotalLabel}
                />
              ))
            ) : (
              <>
                {workspace.packageLines.length > 0 ? (
                  workspace.packageLines.map((line) => (
                    <MoneyRow
                      key={line.id}
                      label={`Package (${line.currentPackage.name})`}
                      value={formatKD(line.currentPackage.price)}
                    />
                  ))
                ) : null}
                {invoice?.depositPaidAmount &&
                !(invoice.renderMode === "SNAPSHOT" && invoice.lineItems.length === 0) ? (
                  <MoneyRow
                    label={`Deposit${invoice.depositInvoiceNumber ? ` (${invoice.depositInvoiceNumber})` : ""}`}
                    value={`-${formatKD(invoice.depositPaidAmount)}`}
                  />
                ) : null}
                {extraPhotoAmount > 0 ? (
                  <MoneyRow
                    label={`Extra photos total (${workspace.extraPhotoCount})`}
                    value={formatKD(extraPhotoAmount)}
                  />
                ) : null}
                {workspace.addOns.map((addOn) => (
                  <MoneyRow key={addOn.id} label={addOn.name} value={addOn.priceLabel} />
                ))}
              </>
            )}
            {invoice?.renderMode === "SNAPSHOT" && invoice.depositPaidAmount ? (
              <MoneyRow
                label={`Deposit${invoice.depositInvoiceNumber ? ` (${invoice.depositInvoiceNumber})` : ""}`}
                value={`-${formatKD(invoice.depositPaidAmount)}`}
              />
            ) : null}
            <MoneyRow
              label={invoice ? "Final invoice total" : "Preview total"}
              value={formatKD(totalAmount)}
              strong
            />
          </div>

          {invoice ? (
            <div className="space-y-2 border-t border-border pt-4">
              <MoneyRow label="Paid" value={formatKD(invoice.paidAmount)} />
              <MoneyRow label="Remaining balance" value={formatKD(invoice.remainingAmount)} strong />
            </div>
          ) : null}

          {workspace.adjustmentInvoices.length > 0 ? (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
                Open adjustments
              </p>
              {workspace.adjustmentInvoices.map((adjustment) => (
                <AdjustmentInvoiceBlock
                  key={adjustment.invoiceId}
                  invoice={adjustment}
                  workspace={workspace}
                />
              ))}
            </div>
          ) : null}

          {workspace.paidAdjustmentInvoices.length > 0 ? (
            <details className="group border-t border-border pt-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-text-primary">
                <span>Paid adjustments ({workspace.paidAdjustmentInvoices.length})</span>
                <ChevronDown className="h-4 w-4 text-text-muted transition group-open:rotate-180" />
              </summary>
              <div className="mt-3 space-y-2">
                {workspace.paidAdjustmentInvoices.map((adjustment) => (
                  <AdjustmentInvoiceSummary
                    key={adjustment.invoiceId}
                    invoice={adjustment}
                  />
                ))}
              </div>
            </details>
          ) : null}

          {invoice || workspace.adjustmentInvoices.length > 0 ? (
            <div className="border-t border-border pt-4">
              <MoneyRow
                label="Outstanding total"
                value={formatKD(workspace.aggregateOutstanding)}
                strong
              />
            </div>
          ) : null}

          <div className="border-t border-border pt-4">
            {invoice ? (
              invoice.remainingAmount <= 0 ? (
                <div className="space-y-2">
                  <Button className="w-full" disabled>
                    Fully Paid
                  </Button>
                  <p className="text-center text-xs text-text-muted">
                    No outstanding balance remains.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <POSRecordPaymentDialog
                    orderId={workspace.orderId}
                    invoice={invoice}
                    orderStatus={workspace.orderStatusRaw}
                    customerName={workspace.customerName}
                    jobNumber={workspace.jobNumber}
                  />
                  <p className="text-center text-xs text-text-muted">
                    Opens without leaving the sales workspace.
                  </p>
                </div>
              )
            ) : (
              <form action={createOrderInvoiceAction.bind(null, workspace.orderId)}>
                <input type="hidden" name="returnTo" value="sales" />
                <Button type="submit" className="w-full">
                  Create Invoice
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}

function AdjustmentInvoiceBlock({
  invoice,
  workspace,
}: {
  invoice: POSWorkspace["adjustmentInvoices"][number];
  workspace: POSWorkspace;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-soft p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">
            Adjustment #{invoice.invoiceNumber}
          </p>
          <Badge variant="secondary" className="mt-1 w-fit rounded-md">
            {invoice.invoiceStatus}
          </Badge>
        </div>
        <POSRecordPaymentDialog
          orderId={workspace.orderId}
          invoice={invoice}
          orderStatus={workspace.orderStatusRaw}
          customerName={workspace.customerName}
          jobNumber={workspace.jobNumber}
          trigger={<Button size="sm">Record Payment</Button>}
        />
      </div>
      <div className="space-y-2">
        {invoice.lineItems.map((item) => (
          <InvoiceLineRow
            key={item.id}
            label={item.description}
            meta={`${item.quantity} × ${item.unitPriceLabel}`}
            value={item.lineTotalLabel}
          />
        ))}
      </div>
      <div className="space-y-1 border-t border-border pt-3">
        <MoneyRow label="Total" value={formatKD(invoice.invoiceTotal)} />
        <MoneyRow label="Paid" value={formatKD(invoice.paidAmount)} />
        <MoneyRow label="Remaining" value={formatKD(invoice.remainingAmount)} strong />
      </div>
    </div>
  );
}

function AdjustmentInvoiceSummary({
  invoice,
}: {
  invoice: POSWorkspace["paidAdjustmentInvoices"][number];
}) {
  return (
    <div className="rounded-md border border-border bg-surface-soft px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-text-primary">{invoice.invoiceNumber}</span>
        <span className="tabular-nums text-text-secondary">
          {formatKD(invoice.invoiceTotal)}
        </span>
      </div>
    </div>
  );
}

function InvoiceLineRow({
  label,
  meta,
  value,
}: {
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-soft px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{label}</p>
          <p className="text-xs text-text-secondary">{meta}</p>
        </div>
        <span className="text-sm font-medium tabular-nums text-text-primary">{value}</span>
      </div>
    </div>
  );
}

function MoneyRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 text-sm ${strong ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function formatKD(value: number): string {
  return `${value.toFixed(3)} KD`;
}
