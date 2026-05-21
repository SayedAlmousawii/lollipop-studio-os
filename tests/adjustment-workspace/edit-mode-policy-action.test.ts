import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { UserRole } from "@prisma/client";
import { ORDER_EDIT_MODE_MESSAGES } from "@/modules/orders/policies/edit-mode-policy";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

test("staged workspace edits use the shared locked workspace guard message when context is invalid", async () => {
  let capturedApplyEdit:
    | {
        workspaceId: string;
        input: {
          version: number;
          edit: {
            id: string;
            op: string;
            orderPackageId?: string;
            toPackageRefId?: string;
          };
        };
      }
    | null = null;
  moduleWithLoader._load = function loadWithAdjustmentActionStubs(
    request,
    parent,
    isMain
  ) {
    if (request === "server-only") return {};
    if (request === "next/cache") {
      return { revalidatePath: () => undefined };
    }
    if (request === "next/navigation") {
      return { redirect: () => undefined };
    }
    if (request === "@/lib/permissions") {
      return {
        PERMISSIONS: { ORDER_FINANCIAL_UPDATE: "order:financial-update" },
        requireCurrentAppUserPermission: async () => ({
          id: "staff-user",
          role: UserRole.MANAGER,
        }),
      };
    }
    if (
      request ===
      "@/modules/adjustment-workspace/adjustment-workspace.service"
    ) {
      return {
        AdjustmentWorkspaceApprovalRequiredError: class extends Error {},
        AdjustmentWorkspaceConflictError: class extends Error {},
        applyEdit: async (
          workspaceId: string,
          input: {
            version: number;
            edit: {
              id: string;
              op: string;
              orderPackageId?: string;
              toPackageRefId?: string;
            };
          }
        ) => {
          capturedApplyEdit = { workspaceId, input };
          return { version: input.version + 1 };
        },
        cancelWorkspace: async () => undefined,
        finalizeWorkspace: async () => undefined,
        getAdjustmentWorkspaceView: async () => null,
        openWorkspace: async () => undefined,
        removeEdit: async () => undefined,
        takeOverWorkspace: async () => undefined,
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const { stagePackageTierChangeAction } = await import(
      "@/app/orders/[orderId]/adjustment-workspace/actions"
    );
    const result = await stagePackageTierChangeAction(
      "order-1",
      "missing-workspace",
      {
        orderPackageId: "order-package-1",
        toPackageRefId: "package-2",
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.errors._global?.[0],
        ORDER_EDIT_MODE_MESSAGES.lockedDirectPOS
      );
    }

    const staged = await stagePackageTierChangeAction(
      "order-1",
      "workspace-1",
      {
        version: 4,
        orderPackageId: "order-package-1",
        toPackageRefId: "package-2",
      }
    );

    assert.deepEqual(staged, { ok: true });
    assert.deepEqual(capturedApplyEdit, {
      workspaceId: "workspace-1",
      input: {
        version: 4,
        edit: {
          id: "tier:order-package-1",
          op: "change_package_tier",
          orderPackageId: "order-package-1",
          toPackageRefId: "package-2",
        },
      },
    });
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
});
