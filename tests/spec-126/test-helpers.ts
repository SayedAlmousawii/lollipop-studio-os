import "dotenv/config";

import Module from "node:module";
import process from "node:process";
import {
  Prisma,
  ProductCategory,
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth/actor-context";
import type { OrderCommitDraftStagingChange } from "@/modules/order-commits/order-commit-draft.types";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

type PhaseBFixturesModule = typeof import("../financial-phase-b/fixtures");
type PhaseBFixtures = Awaited<
  ReturnType<PhaseBFixturesModule["seedPhaseBFixtures"]>
>;
type CheckedInWorkflow = Awaited<
  ReturnType<PhaseBFixturesModule["buildCheckedInWorkflowFixture"]>
>;
type FinalInvoiceWorkflow = Awaited<
  ReturnType<PhaseBFixturesModule["buildLockedFinalInvoiceWorkflowFixture"]>
>;
type OrderServices = typeof import("@/modules/orders/order.service");
type OrderCommitServices = typeof import("@/modules/order-commits/order-commit.service");
type SalesActions = typeof import("@/app/(app)/orders/[orderId]/sales/actions");
type SalesPageLoader = typeof import("@/modules/order-commits/projections");

type ActionUser = {
  id: string;
  role: UserRole;
};

export type ActionActorRef = {
  current: ActionUser;
};

export type Spec126Harness = {
  db: PrismaClient;
  fixtures: PhaseBFixtures;
  orderServices: OrderServices;
  orderCommitServices: OrderCommitServices;
  salesActions: SalesActions;
  salesPageLoader: SalesPageLoader;
  revalidatedPaths: string[];
  actionActor: ActionActorRef;
  buildCheckedInWorkflow: (suffix: string) => Promise<CheckedInWorkflow>;
  buildLockedFinalInvoiceWorkflow: (suffix: string) => Promise<FinalInvoiceWorkflow>;
};

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };

export async function withSpec126Harness<T>(
  run: (ctx: Spec126Harness) => Promise<T>,
  options: { actionActor?: ActionActorRef } = {}
): Promise<T> {
  const originalModuleLoad = moduleWithLoader._load;
  const revalidatedPaths: string[] = [];
  const actionActor =
    options.actionActor ??
    ({ current: { id: "spec-126-action-admin", role: UserRole.ADMIN } });

  moduleWithLoader._load = function loadWithSpec126Shims(
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
        PERMISSIONS,
        hasPermission: (appUser: Pick<ActionUser, "role">) =>
          appUser.role === UserRole.ADMIN || appUser.role === UserRole.MANAGER,
        requirePermission: () => undefined,
        requireCurrentAppUserPermission: async () => actionActor.current,
      };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    return await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = databaseUrl;

      try {
        const { db } = await import("@/lib/db");
        const fixturesModule = await import("../financial-phase-b/fixtures");
        const orderServices = await import("@/modules/orders/order.service");
        const orderCommitServices = await import(
          "@/modules/order-commits/order-commit.service"
        );
        const salesActions = await import("@/app/(app)/orders/[orderId]/sales/actions");
        const salesPageLoader = await import("@/modules/order-commits/projections");

        const fixtures = await fixturesModule.seedPhaseBFixtures(db);
        if (!options.actionActor) {
          actionActor.current = actorToActionUser(fixtures.adminActor);
        }

        return await run({
          db,
          fixtures,
          orderServices,
          orderCommitServices,
          salesActions,
          salesPageLoader,
          revalidatedPaths,
          actionActor,
          buildCheckedInWorkflow: (suffix) =>
            fixturesModule.buildCheckedInWorkflowFixture(db, fixtures, suffix),
          buildLockedFinalInvoiceWorkflow: (suffix) =>
            fixturesModule.buildLockedFinalInvoiceWorkflowFixture(
              db,
              fixtures,
              suffix
            ),
        });
      } finally {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    });
  } finally {
    moduleWithLoader._load = originalModuleLoad;
  }
}

export function actorToActionUser(actorContext: ActorContext): ActionUser {
  return {
    id: actorContext.actorUserId,
    role: actorContext.actorRole,
  };
}

export async function firstOrderPackageId(
  db: PrismaClient,
  orderId: string
): Promise<string> {
  const orderPackage = await db.orderPackage.findFirstOrThrow({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return orderPackage.id;
}

export async function firstPackageItemId(
  db: PrismaClient,
  packageId: string
): Promise<string> {
  const packageItem = await db.packageItem.findFirstOrThrow({
    where: { packageId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return packageItem.id;
}

export async function firstPackageItemProductCategory(
  db: PrismaClient,
  packageId: string
): Promise<ProductCategory> {
  const packageItem = await db.packageItem.findFirstOrThrow({
    where: { packageId },
    orderBy: { createdAt: "asc" },
    select: { product: { select: { category: true } } },
  });
  return packageItem.product.category;
}

export async function createReplacementProduct(input: {
  db: PrismaClient;
  suffix: string;
  category: ProductCategory;
}): Promise<string> {
  const product = await input.db.product.create({
    data: {
      id: `spec-126-replacement-${input.suffix}`,
      name: `Spec 126 Replacement ${input.suffix}`,
      category: input.category,
      canonicalPrice: new Prisma.Decimal("75.000"),
      isPackageDeliverable: true,
    },
    select: { id: true },
  });
  return product.id;
}

export async function createRemovableAddOn(input: {
  db: PrismaClient;
  orderId: string;
  orderPackageId: string;
  productId: string;
}): Promise<string> {
  const addOn = await input.db.orderAddOn.create({
    data: {
      orderId: input.orderId,
      orderPackageId: input.orderPackageId,
      productId: input.productId,
      nameSnapshot: "Spec 126 removable add-on",
      priceSnapshot: new Prisma.Decimal("50.000"),
      quantity: 1,
    },
    select: { id: true },
  });
  return addOn.id;
}

export function addOnStageChange(input: {
  orderPackageId: string;
  productId: string;
  quantity?: number;
}): OrderCommitDraftStagingChange {
  return {
    domain: "ADD_ON",
    action: "ADD",
    parentPackageTarget: {
      stableKey: `order-package:${input.orderPackageId}`,
      orderEntityId: input.orderPackageId,
    },
    productId: input.productId,
    quantity: input.quantity ?? 1,
  };
}

export async function captureOrderRows(db: PrismaClient, orderId: string) {
  return {
    packages: await db.orderPackage.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        currentPackageId: true,
        selectedPhotoCount: true,
        extraDigitalCount: true,
        extraPrintCount: true,
      },
    }),
    addOns: await db.orderAddOn.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        orderPackageId: true,
        productId: true,
        quantity: true,
      },
    }),
    itemUpgrades: await db.orderPackageItemUpgrade.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        orderPackageId: true,
        packageItemId: true,
        quantity: true,
      },
    }),
  };
}

const PERMISSIONS = {
  ORDER_READ: "order:read",
  BOOKING_STATUS_UPDATE: "booking:status-update",
  PAYMENT_CREATE: "payment:create",
  INVOICE_CREATE: "invoice:create",
  INVOICE_ISSUE: "invoice:issue",
  INVOICE_CLOSE: "invoice:close",
  INVOICE_ADJUSTMENT_CREATE: "invoice:adjustment-create",
  REFUND_ISSUE: "refund:issue",
  CREDIT_NOTE_ISSUE: "credit-note:issue",
  ORDER_FINANCIAL_UPDATE: "order:financial-update",
  DELIVERY_UPDATE: "delivery:update",
  DELIVERY_COMPLETE: "delivery:complete",
  DELIVERY_PAYMENT_OVERRIDE: "delivery:payment-override",
  WORKFLOW_EDITING_UPDATE: "workflow:editing-update",
  WORKFLOW_PRODUCTION_UPDATE: "workflow:production-update",
  PACKAGE_CATALOG_MANAGE: "package-catalog:manage",
} as const;
