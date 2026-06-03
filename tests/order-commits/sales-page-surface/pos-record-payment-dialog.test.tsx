import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";
import { OrderStatus } from "@prisma/client";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { POSInvoiceSummary } from "@/modules/orders/order.types";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type POSRecordPaymentDialogComponent = ComponentType<{
  orderId: string;
  invoice: POSInvoiceSummary;
  targets?: POSInvoiceSummary[];
  defaultTargetInvoiceId?: string;
  orderStatus: OrderStatus;
  customerName: string;
  jobNumber: string;
}>;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("POSRecordPaymentDialog renders one target without a picker", async () => {
  const POSRecordPaymentDialog = await loadPOSRecordPaymentDialog();
  const markup = renderToStaticMarkup(
    createElement(POSRecordPaymentDialog, {
      orderId: "order-1",
      invoice: invoiceFixture(),
      orderStatus: OrderStatus.ACTIVE,
      customerName: "Customer",
      jobNumber: "JOB-1",
    })
  );

  assert.match(markup, /Invoice #INV-1/);
  assert.doesNotMatch(markup, /Payment Target/);
});

test("POSRecordPaymentDialog defaults to the selected open charge target", async () => {
  const POSRecordPaymentDialog = await loadPOSRecordPaymentDialog();
  const finalInvoice = invoiceFixture({ remainingAmount: 75 });
  const adjustmentInvoice = invoiceFixture({
    invoiceId: "adjustment-1",
    invoiceNumber: "ADJ-1",
    invoiceType: "ADJUSTMENT",
    invoiceTotal: 42,
    paidAmount: 0,
    remainingAmount: 42,
  });

  const markup = renderToStaticMarkup(
    createElement(POSRecordPaymentDialog, {
      orderId: "order-1",
      invoice: finalInvoice,
      targets: [finalInvoice, adjustmentInvoice],
      defaultTargetInvoiceId: "adjustment-1",
      orderStatus: OrderStatus.ACTIVE,
      customerName: "Customer",
      jobNumber: "JOB-1",
    })
  );

  assert.match(markup, /Payment Target/);
  assert.match(markup, /data-selected="adjustment-1"/);
  assert.match(markup, /FINAL #INV-1/);
  assert.match(markup, /ADJUSTMENT #ADJ-1/);
  assert.match(markup, /Invoice #ADJ-1/);
  assert.match(markup, /42.000 KD/);
});

test("POSRecordPaymentDialog submits and refreshes against the selected target source", () => {
  const source = readFileSync(
    "src/components/orders/pos-record-payment-dialog.tsx",
    "utf8"
  );

  assert.match(
    source,
    /recordPOSPaymentAction\(\s*orderId,\s*selectedTarget\.invoiceId,/s
  );
  assert.match(source, /setAmount\(invoice\.remainingAmount\.toFixed\(3\)\)/);
  assert.match(
    source,
    /invoice\.invoiceType === "FINAL" && orderStatus === OrderStatus\.WAITING_SELECTION/
  );
});

async function loadPOSRecordPaymentDialog(): Promise<POSRecordPaymentDialogComponent> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithComponentStubs(request, parent, isMain) {
    if (request === "next/navigation") {
      return { useRouter: () => ({ refresh: () => undefined }) };
    }
    if (request === "sonner") {
      return { toast: { success: () => undefined } };
    }
    if (request === "@/app/orders/[orderId]/sales/actions") {
      return { recordPOSPaymentAction: async () => ({}) };
    }
    if (request === "@/components/ui/dialog") {
      return dialogStubs();
    }
    if (request === "@/components/ui/date-picker") {
      return {
        DatePicker: ({ value }: { value?: string }) =>
          createElement("input", { defaultValue: value }),
      };
    }
    if (request === "@/components/ui/time-picker") {
      return {
        TimePicker: ({ value }: { value?: string }) =>
          createElement("input", { defaultValue: value }),
      };
    }
    if (request === "@/components/ui/select") {
      return selectStubs();
    }
    if (request === "@/components/ui/toggle-group") {
      return {
        ToggleGroup: ({ children }: { children: ReactNode }) =>
          createElement("div", null, children),
        ToggleGroupItem: ({
          children,
          value,
        }: {
          children: ReactNode;
          value: string;
        }) => createElement("button", { value }, children),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const dialogModule = await import(
      "../../../src/components/orders/pos-record-payment-dialog.tsx"
    );
    return dialogModule.POSRecordPaymentDialog;
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

function dialogStubs() {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement("div", null, children);
  return {
    Dialog: Wrapper,
    DialogTrigger: Wrapper,
    DialogContent: Wrapper,
    DialogDescription: Wrapper,
    DialogFooter: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
  };
}

function selectStubs() {
  return {
    Select: ({
      children,
      value,
    }: {
      children: ReactNode;
      value?: string;
    }) => createElement("div", { "data-selected": value }, children),
    SelectContent: ({ children }: { children: ReactNode }) =>
      createElement("div", null, children),
    SelectItem: ({
      children,
      value,
    }: {
      children: ReactNode;
      value: string;
    }) => createElement("div", { "data-value": value }, children),
    SelectTrigger: ({ children }: { children: ReactNode }) =>
      createElement("button", null, children),
    SelectValue: () => createElement("span", null, "selected"),
  };
}

function invoiceFixture(input: Partial<POSInvoiceSummary> = {}): POSInvoiceSummary {
  return {
    invoiceId: input.invoiceId ?? "final-1",
    financialCaseId: input.financialCaseId ?? "financial-case-1",
    invoiceNumber: input.invoiceNumber ?? "INV-1",
    invoiceType: input.invoiceType ?? "FINAL",
    invoiceStatus: input.invoiceStatus ?? "Issued",
    isLocked: input.isLocked ?? false,
    renderMode: input.renderMode ?? "COMPUTED",
    packageBaseTotal: input.packageBaseTotal ?? 300,
    bundleAdjustment: input.bundleAdjustment ?? 0,
    addOnTotal: input.addOnTotal ?? 0,
    extraPhotoTotal: input.extraPhotoTotal ?? 0,
    invoiceTotal: input.invoiceTotal ?? 300,
    paidAmount: input.paidAmount ?? 225,
    depositInvoiceNumber: input.depositInvoiceNumber ?? "DEP-1",
    depositPaidAmount: input.depositPaidAmount ?? 50,
    remainingAmount: input.remainingAmount ?? 75,
    lineItems: input.lineItems ?? [],
  };
}
