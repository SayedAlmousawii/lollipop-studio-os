import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { UserRole } from "@prisma/client";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

test("configure session action parses JSON selections and maps locked errors", async () => {
  let writtenInput: unknown = null;
  const revalidatedPaths: string[] = [];
  class LockedError extends Error {}

  moduleWithLoader._load = function loadWithConfigureSessionActionStubs(
    request,
    parent,
    isMain
  ) {
    if (request === "server-only") return {};
    if (request === "next/cache") {
      return { revalidatePath: (path: string) => revalidatedPaths.push(path) };
    }
    if (request === "next/navigation") {
      return { redirect: () => undefined };
    }
    if (request === "@/lib/permissions") {
      return {
        PERMISSIONS: {
          INVOICE_CREATE: "invoice:create",
          ORDER_FINANCIAL_UPDATE: "order:financial-update",
          PAYMENT_CREATE: "payment:create",
          WORKFLOW_EDITING_UPDATE: "workflow:editing-update",
          WORKFLOW_PRODUCTION_UPDATE: "workflow:production-update",
          WORKFLOW_DELIVERY_UPDATE: "workflow:delivery-update",
        },
        requireCurrentAppUserPermission: async () => ({
          id: "staff-user",
          role: UserRole.MANAGER,
        }),
      };
    }
    if (request === "@/modules/invoices/invoice.service") {
      return { createInvoiceForOrder: async () => ({ id: "invoice-1" }) };
    }
    if (
      request ===
      "@/modules/adjustment-workspace/adjustment-workspace.service"
    ) {
      return { applyEdit: async () => ({ orderId: "order-1", version: 2 }) };
    }
    if (request === "@/modules/payments/payment.service") {
      return {
        recordUpgradePaymentForOrder: async () => ({ id: "payment-1" }),
        UpgradePaymentInvoiceNotFoundError: class extends Error {},
        UpgradePaymentInvoiceOrderMismatchError: class extends Error {},
        UpgradePaymentNoOutstandingBalanceError: class extends Error {},
        UpgradePaymentOutstandingBalanceChangedError: class extends Error {},
      };
    }
    if (request === "@/modules/orders/order.service") {
      return {
        updateOrderDeliveryWorkflow: async () => undefined,
        updateOrderEditingWorkflow: async () => undefined,
        updateOrderProductionWorkflow: async () => undefined,
      };
    }
    if (
      request ===
      "@/modules/session-configurations/session-configuration-selection.service"
    ) {
      return {
        formatMissingSessionConfigurationMessage: async () =>
          "Configure the missing session settings before generating the invoice: Pose (Classic).",
        resolveConfigureSessionRoute: async (
          _orderId: string,
          orderPackageId: string
        ) =>
          orderPackageId === "locked-financial-package"
            ? {
                locked: true,
                financialConfigurationIds: new Set(["config-1"]),
                operationalConfigurationIds: new Set<string>(),
                configurationNameById: new Map([["config-1", "Keepsake Box"]]),
              }
            : {
                locked: false,
                financialConfigurationIds: new Set<string>(),
                operationalConfigurationIds: new Set(["config-1"]),
                configurationNameById: new Map([["config-1", "Pose"]]),
              },
        SessionConfigurationSelectionConfigurationNotFoundError: class extends Error {},
        SessionConfigurationSelectionFinancialNotAllowedError: class extends Error {},
        SessionConfigurationSelectionInputMismatchError: class extends Error {},
        SessionConfigurationSelectionLockedError: LockedError,
        SessionConfigurationSelectionOptionMismatchError: class extends Error {},
        SessionConfigurationSelectionPostLockMisuseError: class extends Error {},
        writeOrderPackageSelections: async (
          orderPackageId: string,
          selections: unknown
        ) => {
          writtenInput = { orderPackageId, selections };
          if (orderPackageId === "locked-package") throw new LockedError();
          return { orderPackageId, writtenSelectionIds: [] };
        },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const { configureSessionAction } = await import("@/app/orders/[orderId]/actions");
    const result = await configureSessionAction(
      "order-1",
      {},
      formData({
        orderPackageId: "package-1",
        selections: JSON.stringify([
          { configurationId: "config-1", kind: "toggle" },
        ]),
      })
    );
    assert.deepEqual(result, {});
    assert.deepEqual(writtenInput, {
      orderPackageId: "package-1",
      selections: [{ configurationId: "config-1", kind: "toggle" }],
    });
    assert.ok(revalidatedPaths.includes("/orders/order-1/sales"));

    const lockedFinancial = await configureSessionAction(
      "order-1",
      {},
      formData({
        orderPackageId: "locked-financial-package",
        selections: JSON.stringify([
          { configurationId: "config-1", kind: "toggle" },
        ]),
      })
    );
    assert.equal(
      lockedFinancial.errors?._global?.[0],
      "Edit Keepsake Box in the Adjustment Workspace."
    );
    assert.equal(
      lockedFinancial.adjustmentWorkspaceHref,
      "/orders/order-1/adjustment-workspace"
    );

    const locked = await configureSessionAction(
      "order-1",
      {},
      formData({
        orderPackageId: "locked-package",
        selections: "[]",
      })
    );
    assert.equal(
      locked.errors?._global?.[0],
      "Order is locked. Edit configurations through the Adjustment Workspace."
    );
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
});

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}
