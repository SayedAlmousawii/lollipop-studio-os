import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { InvoiceLineType, Prisma, UserRole } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreditNoteApprovalForm } from "@/components/orders/credit-note-approval-fields";
import { PendingCreditNoteApprovalError } from "@/modules/financial/edit-classifier";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

test("POS reductive actions surface and confirm manager approval", async () => {
  let removeMode: "approval" | "success" | "permission-error" | "internal-error" =
    "approval";
  let capturedRemoveInput: unknown = null;
  const revalidatedPaths: string[] = [];

  moduleWithLoader._load = function loadWithPOSApprovalStubs(
    request,
    parent,
    isMain
  ) {
    if (request === "server-only") return {};
    if (request === "next/cache") {
      return {
        revalidatePath(path: string) {
          revalidatedPaths.push(path);
        },
      };
    }
    if (request === "@/lib/permissions") {
      return {
        PERMISSIONS: {
          ORDER_FINANCIAL_UPDATE: "order:financial-update",
          PAYMENT_CREATE: "payment:create",
        },
        requireCurrentAppUserPermission: async () => ({
          id: "staff-user",
          role: UserRole.RECEPTIONIST,
        }),
      };
    }
    if (request === "@/modules/orders/order.service") {
      return {
        getPOSWorkspace: async () => null,
        addOrderProductAddOn: async () => undefined,
        updateOrderPackage: async () => undefined,
        updateOrderSelectedPhotoCount: async () => undefined,
        upgradeOrderPackageItem: async () => undefined,
        recordPOSPaymentForOrder: async () => undefined,
        removeOrderAddOn: async (_orderId: string, input: unknown) => {
          capturedRemoveInput = input;
          if (removeMode === "approval") {
            throw new PendingCreditNoteApprovalError(
              [
                {
                  reason: "REMOVED_ADDON",
                  amount: new Prisma.Decimal("12.500"),
                  lineSnapshot: { name: "Fine Art Print" },
                },
              ],
              [
                {
                  description: "Replacement album",
                  quantity: 1,
                  unitPrice: 5,
                  lineType: InvoiceLineType.ADD_ON,
                },
              ]
            );
          }
          if (removeMode === "permission-error") {
            throw new Error("Manager permission is required to issue a credit note");
          }
          if (removeMode === "internal-error") {
            throw new Error("database password leaked: secret");
          }
        },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const actions = await import("@/app/orders/[orderId]/sales/actions");

    const invalid = await actions.removeOrderAddOnAction(
      "order-1",
      {},
      new FormData()
    );
    assert.equal(invalid.kind, "error");
    assert.ok(invalid.errors?.addOnId?.length);

    const pendingForm = new FormData();
    pendingForm.set("addOnId", "addon-1");
    const pending = await actions.removeOrderAddOnAction("order-1", {}, pendingForm);
    assert.deepEqual(pending, {
      kind: "approval-required",
      payload: {
        reductions: [
          {
            lineName: "Fine Art Print",
            amount: "12.500",
            reason: "REMOVED_ADDON",
          },
        ],
        adjustmentLines: [
          {
            description: "Replacement album",
            quantity: 1,
            unitPrice: "5.000",
          },
        ],
      },
    });

    removeMode = "success";
    const confirmForm = new FormData();
    confirmForm.set("reductiveAction", "remove-add-on");
    confirmForm.set("addOnId", "addon-1");
    confirmForm.set("managerApprovedReductionByUserId", "manager-user");
    confirmForm.set("managerApprovedReason", "Customer changed package");

    const confirmed = await actions.confirmReductiveEditWithApproval(
      "order-1",
      {},
      confirmForm
    );
    assert.equal(confirmed.kind, "success");
    assert.deepEqual(capturedRemoveInput, {
      addOnId: "addon-1",
      managerApprovedReductionByUserId: "manager-user",
      managerApprovedReason: "Customer changed package",
    });
    assert.ok(revalidatedPaths.includes("/orders/order-1"));

    removeMode = "permission-error";
    const rejected = await actions.confirmReductiveEditWithApproval(
      "order-1",
      {},
      confirmForm
    );
    assert.equal(rejected.kind, "error");
    assert.equal(
      rejected.errors?._global?.[0],
      "Manager permission is required to issue a credit note"
    );

    removeMode = "internal-error";
    const generic = await actions.confirmReductiveEditWithApproval(
      "order-1",
      {},
      confirmForm
    );
    assert.equal(generic.kind, "error");
    assert.equal(generic.errors?._global?.[0], "Unable to save POS changes");
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
});

test("credit-note approval form renders reduction line items and amounts", () => {
  const markup = renderToStaticMarkup(
    createElement(CreditNoteApprovalForm, {
      approval: {
        reductions: [
          {
            lineName: "Fine Art Print",
            amount: "12.500",
            reason: "REMOVED_ADDON",
          },
        ],
        adjustmentLines: [
          {
            description: "Replacement album",
            quantity: 1,
            unitPrice: "5.000",
          },
        ],
      },
    })
  );

  assert.match(markup, /Fine Art Print/);
  assert.match(markup, /12\.500 KD/);
  assert.match(markup, /Replacement album/);
  assert.match(markup, /Manager user ID/);
});
