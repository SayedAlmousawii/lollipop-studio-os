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

test("session configuration create action parses nested options and revalidates the admin page", async () => {
  let createdInput: unknown = null;
  let revalidatedPath: string | null = null;

  moduleWithLoader._load = function loadWithSessionConfigurationActionStubs(
    request,
    parent,
    isMain
  ) {
    if (request === "server-only") return {};
    if (request === "next/cache") {
      return { revalidatePath: (path: string) => (revalidatedPath = path) };
    }
    if (request === "@/lib/permissions") {
      return {
        PERMISSIONS: { PACKAGE_CATALOG_MANAGE: "package-catalog:manage" },
        requireCurrentAppUserPermission: async () => ({
          id: "staff-user",
          role: UserRole.MANAGER,
        }),
      };
    }
    if (
      request ===
      "@/modules/session-configurations/session-configuration.service"
    ) {
      return {
        SessionConfigurationCodeConflictError: class SessionConfigurationCodeConflictError extends Error {},
        SessionConfigurationLinkedProductNotFoundError: class SessionConfigurationLinkedProductNotFoundError extends Error {},
        SessionConfigurationNotFoundError: class SessionConfigurationNotFoundError extends Error {},
        SessionConfigurationSessionTypeNotFoundError: class SessionConfigurationSessionTypeNotFoundError extends Error {},
        SessionConfigurationValidationError: class SessionConfigurationValidationError extends Error {},
        archiveSessionConfiguration: async () => undefined,
        createSessionConfiguration: async (input: unknown) => {
          createdInput = input;
          return { id: "configuration-1" };
        },
        unarchiveSessionConfiguration: async () => undefined,
        updateSessionConfiguration: async () => undefined,
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const { createSessionConfigurationAction } = await import(
      "@/app/session-configurations/actions"
    );
    const result = await createSessionConfigurationAction({}, formData({
      sessionTypeId: "session-type-1",
      name: "Age Range",
      inputType: "SELECT",
      pricingMode: "TIERED",
      financialBehavior: "FINANCIAL",
      required: "on",
      sortOrder: "10",
      options: JSON.stringify([
        {
          label: "0-30 Days",
          value: "0_30",
          priceDelta: "0",
          sortOrder: "10",
          isActive: true,
        },
        {
          label: "31-45 Days",
          value: "31_45",
          priceDelta: "20",
          sortOrder: "20",
          isActive: true,
        },
      ]),
    }));

    assert.equal(result.success, "Session configuration created.");
    assert.equal(revalidatedPath, "/session-configurations");
    assert.deepEqual(
      createdInput,
      {
        sessionTypeId: "session-type-1",
        name: "Age Range",
        inputType: "SELECT",
        pricingMode: "TIERED",
        financialBehavior: "FINANCIAL",
        required: true,
        sortOrder: 10,
        fixedPriceDelta: undefined,
        linkedProductId: undefined,
        linkProductDisplay: undefined,
        counterPricingMode: undefined,
        counterUnitPrice: undefined,
        options: [
          {
            label: "0-30 Days",
            value: "0_30",
            priceDelta: 0,
            sortOrder: 10,
            isActive: true,
          },
          {
            label: "31-45 Days",
            value: "31_45",
            priceDelta: 20,
            sortOrder: 20,
            isActive: true,
          },
        ],
      }
    );

    const invalidOptionsResult = await createSessionConfigurationAction(
      {},
      formData({
        sessionTypeId: "session-type-1",
        name: "Age Range",
        inputType: "SELECT",
        pricingMode: "TIERED",
        financialBehavior: "FINANCIAL",
        sortOrder: "10",
        options: "[not-json",
      })
    );
    assert.match(
      invalidOptionsResult.errors?.options?.[0] ?? "",
      /Invalid options JSON/
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
