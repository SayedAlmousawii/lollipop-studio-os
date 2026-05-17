import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { UserRole } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

test("session types page renders for catalog managers and denies other roles", async () => {
  let role = UserRole.MANAGER;

  moduleWithLoader._load = function loadWithSessionTypePageStubs(
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
    if (request === "@/modules/session-types/session-type.service") {
      return {
        listSessionTypes: async () => [
          {
            id: "session-type-1",
            code: "KD_BIRTHDAY",
            name: "Birthday",
            departmentId: "dept-kids",
            departmentName: "Kids",
            departmentCode: "KD",
            calendarLabel: "Kids",
            calendarColor: "var(--color-info-soft)",
            isActive: true,
            status: "Active",
            sortOrder: 10,
            pricingConfigured: true,
            zeroPriceMediaTypes: [],
          },
        ],
      };
    }
    if (request === "@/modules/departments/studio-department.service") {
      return {
        getActiveStudioDepartments: async () => [
          { id: "dept-kids", code: "KD", name: "Kids" },
        ],
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const { default: SessionTypesPage } = await import("@/app/session-types/page");
    const pageProps = {
      searchParams: Promise.resolve({}),
    } as Parameters<typeof SessionTypesPage>[0];
    const element = await SessionTypesPage(pageProps);
    const markup = renderToStaticMarkup(createElement(() => element));

    assert.match(markup, /Session Types/);
    assert.match(markup, /Birthday/);

    role = UserRole.RECEPTIONIST;
    await assert.rejects(
      () =>
        SessionTypesPage(pageProps),
      /NEXT_UNAUTHORIZED/
    );
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
});
