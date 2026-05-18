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
    if (request === "@/lib/db") {
      return {
        db: {
          sessionConfiguration: { findMany: async () => [] },
          orderPackage: { findMany: async () => [] },
        },
      };
    }
    if (request === "@/lib/permissions") {
      return {
        PERMISSIONS: {
          INVOICE_CREATE: "invoice:create",
          ORDER_FINANCIAL_UPDATE: "order:financial-update",
        },
        requireCurrentAppUserPermission: async () => ({
          id: "staff-user",
          role: UserRole.MANAGER,
        }),
      };
    }
    if (
      request ===
      "@/modules/session-configurations/session-configuration-selection.service"
    ) {
      return {
        SessionConfigurationSelectionConfigurationNotFoundError: class extends Error {},
        SessionConfigurationSelectionInputMismatchError: class extends Error {},
        SessionConfigurationSelectionLockedError: LockedError,
        SessionConfigurationSelectionOptionMismatchError: class extends Error {},
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
