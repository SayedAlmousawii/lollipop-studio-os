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

test("extra-photo pricing action updates for catalog managers and rejects other roles", async () => {
  let role = UserRole.MANAGER;
  let updatedSessionTypeId: string | null = null;

  moduleWithLoader._load = function loadWithPricingActionStubs(
    request,
    parent,
    isMain
  ) {
    if (request === "server-only") return {};
    if (request === "next/cache") {
      return { revalidatePath: () => undefined };
    }
    if (request === "@/lib/permissions") {
      return {
        PERMISSIONS: { PACKAGE_CATALOG_MANAGE: "package-catalog:manage" },
        requireCurrentAppUserPermission: async () => {
          if (role !== UserRole.ADMIN && role !== UserRole.MANAGER) {
            throw new Error("NEXT_UNAUTHORIZED");
          }
          return { id: "staff-user", role };
        },
      };
    }
    if (request === "@/modules/pricing/extra-photo-pricing.service") {
      return {
        ExtraPhotoPricingNotFoundError: class ExtraPhotoPricingNotFoundError extends Error {},
        updateExtraPhotoPricing: async (sessionTypeId: string) => {
          updatedSessionTypeId = sessionTypeId;
        },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const { updateExtraPhotoPricingAction } = await import("@/app/pricing/actions");
    const allowedResult = await updateExtraPhotoPricingAction(
      "session-type-1",
      {},
      formData({
        digitalUnitPrice: "5.000",
        printUnitPrice: "7.000",
      })
    );
    assert.equal(updatedSessionTypeId, "session-type-1");
    assert.equal(allowedResult.success, "Extra-photo prices updated.");

    role = UserRole.RECEPTIONIST;
    await assert.rejects(
      () =>
        updateExtraPhotoPricingAction(
          "session-type-1",
          {},
          formData({
            digitalUnitPrice: "5.000",
            printUnitPrice: "7.000",
          })
        ),
      /NEXT_UNAUTHORIZED/
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
