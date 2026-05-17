import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";
import { InvoiceStatus } from "@prisma/client";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  AdjustmentWorkspaceView,
  PendingAdjustmentPreview,
} from "@/modules/adjustment-workspace/adjustment-workspace.types";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type FinancialSidebarAdjustmentComponent = ComponentType<{
  orderId: string;
  workspace: AdjustmentWorkspaceView;
  preview: PendingAdjustmentPreview;
  canEdit: boolean;
}>;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

test("FinancialSidebarAdjustment renders pending preview sections and finalize action", async () => {
  const FinancialSidebarAdjustment = await loadFinancialSidebarAdjustment();
  const markup = renderToStaticMarkup(
    createElement(FinancialSidebarAdjustment, {
      orderId: "order-1",
      workspace: workspaceFixture(),
      preview: previewFixture(),
      canEdit: true,
    })
  );

  assert.match(markup, /Pending Adjustment Preview/);
  assert.match(markup, /Base Locked Total/);
  assert.match(markup, /Pending Additions/);
  assert.match(markup, /Pending Reductions/);
  assert.match(markup, /Pending Net Adjustment/);
  assert.match(markup, /Approval Status/);
  assert.match(markup, /Parent \/ Final Invoice Reference/);
  assert.match(markup, /Finalize \/ Issue Adjustment/);
  assert.doesNotMatch(markup, /Finalized balance/i);
});

test("FinancialSidebarAdjustment does not consume the composition view model", () => {
  const source = readFileSync(
    "src/components/orders/financial-sidebar-adjustment.tsx",
    "utf8"
  );

  assert.doesNotMatch(source, /buildCompositionView/);
  assert.doesNotMatch(source, /CompositionView/);
});

async function loadFinancialSidebarAdjustment(): Promise<FinancialSidebarAdjustmentComponent> {
  const originalModuleLoad = moduleWithLoader._load;
  moduleWithLoader._load = function loadWithActionStubs(request, parent, isMain) {
    if (request === "server-only") {
      return {};
    }
    if (request === "@/app/orders/[orderId]/adjustment-workspace/actions") {
      return {
        finalizeAdjustmentWorkspaceAction: async () => undefined,
      };
    }
    if (request === "@/components/orders/credit-note-approval-fields") {
      return {
        CreditNoteApprovalForm: () => createElement("div", null, "Approval fields"),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const sidebarModule = await import(
      "../../src/components/orders/financial-sidebar-adjustment.tsx"
    );
    return sidebarModule.FinancialSidebarAdjustment;
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

function previewFixture(): PendingAdjustmentPreview {
  return {
    baseLockedTotal: 230,
    pendingAdditions: 40,
    pendingReductions: -10,
    pendingNet: 30,
    approvalRequired: false,
    parentInvoice: {
      id: "invoice-final",
      number: "INV-FINAL",
      status: InvoiceStatus.CLOSED,
    },
  };
}

function workspaceFixture(): AdjustmentWorkspaceView {
  return {
    id: "workspace-1",
    invoiceId: "invoice-final",
    invoiceNumber: "INV-FINAL",
    orderId: "order-1",
    jobNumber: "JOB-1",
    status: "open",
    version: 2,
    openedByUserId: "user-1",
    openedByName: "Owner User",
    openedAt: "2026-05-17T10:00:00.000Z",
    currentOwnerUserId: "user-1",
    currentOwnerName: "Owner User",
    baseSnapshot: {
      capturedAt: "2026-05-17T10:00:00.000Z",
      lines: [],
      totals: { gross: "230.000", discount: "0.000", tax: "0.000", netPayable: "230.000" },
    },
    pendingChanges: {
      edits: [{ id: "add-1", op: "add_line", kind: "addon", refId: "usb-box", quantity: 1 }],
    },
    proposal: {
      base: {
        capturedAt: "2026-05-17T10:00:00.000Z",
        lines: [],
        totals: { gross: "230.000", discount: "0.000", tax: "0.000", netPayable: "230.000" },
      },
      proposed: {
        capturedAt: "2026-05-17T10:00:00.000Z",
        lines: [],
        totals: { gross: "260.000", discount: "0.000", tax: "0.000", netPayable: "260.000" },
      },
      edits: [{ id: "add-1", op: "add_line", kind: "addon", refId: "usb-box", quantity: 1 }],
      deltas: [],
      grossDelta: "30.000",
      discountDelta: "0.000",
      taxDelta: "0.000",
      netPayableDelta: "30.000",
      requiresManagerApproval: false,
      hasEdits: true,
      adjustmentKind: "positive",
    },
  };
}
