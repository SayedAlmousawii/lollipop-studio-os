import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import {
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
  UserRole,
} from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

test("session configurations page filters archived rows and denies non-managers", async () => {
  let role = UserRole.MANAGER;
  let includeArchivedSeen = false;

  moduleWithLoader._load = function loadWithSessionConfigurationPageStubs(
    request,
    parent,
    isMain
  ) {
    if (request === "server-only") return {};
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
    if (
      request ===
      "@/modules/session-configurations/session-configuration.service"
    ) {
      return {
        listSessionConfigurations: async ({
          includeArchived,
        }: {
          includeArchived?: boolean;
        }) => {
          includeArchivedSeen = Boolean(includeArchived);
          const rows = [
            row("config-active-1", "Twins", true),
            row("config-active-2", "Cake", true),
            row("config-archived", "Archived Cake", false),
          ];
          return includeArchived ? rows : rows.filter((item) => item.isActive);
        },
      };
    }
    if (request === "@/modules/session-types/session-type.service") {
      return {
        listSessionTypes: async () => [
          {
            id: "session-type-1",
            code: "KD_BIRTHDAY",
            name: "Birthday",
          },
        ],
      };
    }
    if (request === "@/modules/products/product.service") {
      return { listActiveProducts: async () => [] };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const { default: SessionConfigurationsPage } = await import(
      "@/app/session-configurations/page"
    );
    const activeElement = await SessionConfigurationsPage({
      searchParams: Promise.resolve({}),
    } as Parameters<typeof SessionConfigurationsPage>[0]);
    const activeMarkup = renderToStaticMarkup(createElement(() => activeElement));

    assert.match(activeMarkup, /Session Configurations/);
    assert.match(activeMarkup, /Twins/);
    assert.match(activeMarkup, /Cake/);
    assert.doesNotMatch(activeMarkup, /Archived Cake/);
    assert.equal(includeArchivedSeen, false);

    const archivedElement = await SessionConfigurationsPage({
      searchParams: Promise.resolve({ includeArchived: "1" }),
    } as Parameters<typeof SessionConfigurationsPage>[0]);
    const archivedMarkup = renderToStaticMarkup(
      createElement(() => archivedElement)
    );
    assert.match(archivedMarkup, /Archived Cake/);
    assert.equal(includeArchivedSeen, true);

    role = UserRole.RECEPTIONIST;
    await assert.rejects(
      () =>
        SessionConfigurationsPage({
          searchParams: Promise.resolve({}),
        } as Parameters<typeof SessionConfigurationsPage>[0]),
      /NEXT_UNAUTHORIZED/
    );
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
});

function row(id: string, name: string, isActive: boolean) {
  return {
    id,
    code: `KD_BIRTHDAY__${name.toUpperCase().replaceAll(" ", "_")}`,
    name,
    sessionTypeId: "session-type-1",
    sessionTypeCode: "KD_BIRTHDAY",
    sessionTypeName: "Birthday",
    inputType: SessionConfigurationInputType.TOGGLE,
    pricingMode: SessionConfigurationPricingMode.NONE,
    financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
    required: false,
    isActive,
    status: isActive ? "Active" : "Archived",
    sortOrder: 10,
    fixedPriceDelta: null,
    linkedProductId: null,
    linkedProductName: null,
    linkProductDisplay: null,
    counterPricingMode: null,
    counterUnitPrice: null,
    activeOptionCount: 0,
    optionPreviewLabels: [],
    options: [],
  };
}
