import {
  AdjustmentWorkspaceEventType,
  AdjustmentWorkspaceStatus,
  AuditAction,
  AuditEntityType,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  OrderActivityType,
  OrderEntityKind,
  Prisma,
  UserRole,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { assertActorPermission } from "@/lib/auth/assert-actor-permission";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { withRetry } from "@/lib/retry";
import { recordAuditLog } from "@/modules/audit/audit-log.service";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import { generatePublicId } from "@/modules/identifiers/identifier.service";
import { recordInvoiceLockSnapshot } from "@/modules/invoices/invoice-lock.service";
import { generateInvoiceNumber } from "@/modules/invoices/invoice.service";
import { recordOrderActivity } from "@/modules/orders/order-activity.service";
import { adjustmentPendingChangesSchema } from "./adjustment-workspace.schema";
import type {
  AdjustmentBaseSnapshot,
  AdjustmentCompositionLine,
  AdjustmentCompositionTotals,
  AdjustmentLineKind,
  AdjustmentPendingChanges,
  AdjustmentWorkspaceEdit,
  AdjustmentWorkspaceProposal,
  AdjustmentWorkspaceView,
} from "./adjustment-workspace.types";

type DbClient = typeof db | Prisma.TransactionClient;

type CatalogLookup = {
  products: Map<string, { id: string; name: string; price: Prisma.Decimal }>;
  packages: Map<string, { id: string; name: string; price: Prisma.Decimal }>;
};

type WorkspaceRow = {
  id: string;
  invoiceId: string;
  orderId: string;
  status: AdjustmentWorkspaceStatus;
  openedByUserId: string;
  openedAt: Date;
  currentOwnerUserId: string | null;
  version: number;
  baseSnapshotJson: Prisma.JsonValue;
  pendingChangesJson: Prisma.JsonValue;
  invoice: { invoiceNumber: string };
  order: { jobNumber: string };
  openedByUser: { name: string };
  currentOwnerUser: { name: string } | null;
};

const moneyZero = new Prisma.Decimal(0);

export class AdjustmentWorkspaceConflictError extends Error {
  constructor() {
    super("Workspace has changed. Refresh and try again.");
    this.name = "AdjustmentWorkspaceConflictError";
  }
}

export class AdjustmentWorkspaceApprovalRequiredError extends Error {
  proposal: AdjustmentWorkspaceProposal;

  constructor(proposal: AdjustmentWorkspaceProposal) {
    super("Manager approval is required to finalize a net reduction.");
    this.name = "AdjustmentWorkspaceApprovalRequiredError";
    this.proposal = proposal;
  }
}

export async function getOpenWorkspaceForInvoice(invoiceId: string) {
  return db.adjustmentWorkspace.findFirst({
    where: { invoiceId, status: AdjustmentWorkspaceStatus.OPEN },
    include: {
      openedByUser: { select: { name: true } },
      currentOwnerUser: { select: { name: true } },
    },
  });
}

export async function getOpenWorkspaceForOrder(orderId: string) {
  return db.adjustmentWorkspace.findFirst({
    where: { orderId, status: AdjustmentWorkspaceStatus.OPEN },
    include: {
      openedByUser: { select: { name: true } },
      currentOwnerUser: { select: { name: true } },
    },
  });
}

export async function getAdjustmentWorkspaceView(
  workspaceId: string
): Promise<AdjustmentWorkspaceView | null> {
  const row = await db.adjustmentWorkspace.findUnique({
    where: { id: workspaceId },
    include: {
      invoice: { select: { invoiceNumber: true } },
      order: { select: { jobNumber: true } },
      openedByUser: { select: { name: true } },
      currentOwnerUser: { select: { name: true } },
    },
  });
  if (!row) return null;

  return mapWorkspaceView(row);
}

export async function getAdjustmentWorkspaceCatalog() {
  const [products, packages] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, canonicalPrice: true, isAddOn: true },
      orderBy: [{ isAddOn: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    db.package.findMany({
      where: { isActive: true },
      select: { id: true, name: true, price: true },
      orderBy: { price: "asc" },
    }),
  ]);

  return {
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.canonicalPrice.toNumber(),
      priceLabel: formatMoney(product.canonicalPrice),
      isAddOn: product.isAddOn,
    })),
    packages: packages.map((packageRow) => ({
      id: packageRow.id,
      name: packageRow.name,
      price: packageRow.price.toNumber(),
      priceLabel: formatMoney(packageRow.price),
    })),
  };
}

export async function getEffectiveCompositionForInvoice(
  invoiceId: string,
  client: DbClient = db
): Promise<AdjustmentBaseSnapshot> {
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, orderId: true, isLocked: true, invoiceType: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.invoiceType !== InvoiceType.FINAL || !invoice.orderId) {
    throw new Error("Adjustment workspaces require a final order invoice");
  }

  const snapshot = await captureCurrentOrderComposition(client, invoice.orderId);
  const finalizedWorkspaceInvoices = await client.adjustmentWorkspace.findMany({
    where: {
      invoiceId,
      status: AdjustmentWorkspaceStatus.FINALIZED,
      finalizedAdjustmentInvoiceId: { not: null },
    },
    select: {
      finalizedAdjustmentInvoice: {
        select: {
          lineItems: {
            select: {
              id: true,
              lineType: true,
              description: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
              causeOrderEntityKind: true,
              causeOrderEntityId: true,
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });

  for (const workspace of finalizedWorkspaceInvoices) {
    const lines = workspace.finalizedAdjustmentInvoice?.lineItems ?? [];
    applySignedInvoiceLines(snapshot.lines, lines);
  }
  snapshot.totals = computeTotals(snapshot.lines);
  return snapshot;
}

export async function openWorkspace(
  invoiceId: string,
  actorContext: ActorContext
): Promise<{ id: string }> {
  assertStaffActor(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: {
            id: true,
            invoiceType: true,
            isLocked: true,
            orderId: true,
          },
        });
        if (!invoice) throw new Error("Invoice not found");
        if (invoice.invoiceType !== InvoiceType.FINAL || !invoice.isLocked) {
          throw new Error("Adjustment workspace requires a locked final invoice");
        }
        if (!invoice.orderId) {
          throw new Error("Invoice is not attached to an order");
        }

        const existing = await tx.adjustmentWorkspace.findFirst({
          where: { invoiceId, status: AdjustmentWorkspaceStatus.OPEN },
          select: { id: true },
        });
        if (existing) return existing;

        const baseSnapshot = await getEffectiveCompositionForInvoice(invoiceId, tx);
        const workspace = await tx.adjustmentWorkspace.create({
          data: {
            invoiceId,
            orderId: invoice.orderId,
            openedByUserId: actorContext.actorUserId,
            currentOwnerUserId: actorContext.actorUserId,
            baseSnapshotJson: baseSnapshot as unknown as Prisma.InputJsonValue,
            pendingChangesJson: { edits: [] },
            events: {
              create: {
                actorUserId: actorContext.actorUserId,
                eventType: AdjustmentWorkspaceEventType.OPENED,
                payloadJson: { invoiceId, orderId: invoice.orderId },
              },
            },
          },
          select: { id: true },
        });

        recordWorkspaceMetric("adjustment_workspace.opened", {
          workspaceId: workspace.id,
          invoiceId,
          orderId: invoice.orderId,
          userId: actorContext.actorUserId,
        });

        return workspace;
      }),
    "Failed to open adjustment workspace"
  );
}

export async function applyEdit(
  workspaceId: string,
  input: { version: number; edit: AdjustmentWorkspaceEdit },
  actorContext: ActorContext
): Promise<AdjustmentWorkspaceView> {
  assertStaffActor(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const workspace = await tx.adjustmentWorkspace.findUnique({
          where: { id: workspaceId },
          select: workspaceAuthSelect,
        });
        if (!workspace) throw new Error("Workspace not found");
        assertOpenWorkspace(workspace.status);
        assertWorkspaceVersion(workspace.version, input.version);
        assertWorkspaceOwnerOrManager(workspace.currentOwnerUserId, actorContext);

        const pending = parsePendingChanges(workspace.pendingChangesJson);
        const editIndex = pending.edits.findIndex((edit) => edit.id === input.edit.id);
        const nextEdits =
          editIndex >= 0
            ? pending.edits.map((edit, index) =>
                index === editIndex ? input.edit : edit
              )
            : [...pending.edits, input.edit];
        const eventType =
          editIndex >= 0
            ? AdjustmentWorkspaceEventType.EDIT_MODIFIED
            : eventTypeForEdit(input.edit);

        await tx.adjustmentWorkspace.update({
          where: { id: workspaceId },
          data: {
            pendingChangesJson: { edits: nextEdits },
            version: { increment: 1 },
            lastActivityAt: new Date(),
            events: {
              create: {
                actorUserId: actorContext.actorUserId,
                eventType,
                payloadJson: { edit: input.edit },
              },
            },
          },
        });
      }),
    "Failed to apply workspace edit"
  );

  const view = await getAdjustmentWorkspaceView(workspaceId);
  if (!view) throw new Error("Workspace not found after edit");
  return view;
}

export async function removeEdit(
  workspaceId: string,
  input: { version: number; editId: string },
  actorContext: ActorContext
): Promise<AdjustmentWorkspaceView> {
  assertStaffActor(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const workspace = await tx.adjustmentWorkspace.findUnique({
          where: { id: workspaceId },
          select: workspaceAuthSelect,
        });
        if (!workspace) throw new Error("Workspace not found");
        assertOpenWorkspace(workspace.status);
        assertWorkspaceVersion(workspace.version, input.version);
        assertWorkspaceOwnerOrManager(workspace.currentOwnerUserId, actorContext);

        const pending = parsePendingChanges(workspace.pendingChangesJson);
        const nextEdits = removeEditAndDependents(pending.edits, input.editId);
        await tx.adjustmentWorkspace.update({
          where: { id: workspaceId },
          data: {
            pendingChangesJson: { edits: nextEdits },
            version: { increment: 1 },
            lastActivityAt: new Date(),
            events: {
              create: {
                actorUserId: actorContext.actorUserId,
                eventType: AdjustmentWorkspaceEventType.EDIT_REMOVED,
                payloadJson: { editId: input.editId },
              },
            },
          },
        });
      }),
    "Failed to remove workspace edit"
  );

  const view = await getAdjustmentWorkspaceView(workspaceId);
  if (!view) throw new Error("Workspace not found after edit removal");
  return view;
}

export async function takeOverWorkspace(
  workspaceId: string,
  actorContext: ActorContext
): Promise<void> {
  assertManagerActor(actorContext, "Only managers can take over a workspace");

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const workspace = await tx.adjustmentWorkspace.findUnique({
          where: { id: workspaceId },
          select: { id: true, status: true, currentOwnerUserId: true },
        });
        if (!workspace) throw new Error("Workspace not found");
        assertOpenWorkspace(workspace.status);

        await tx.adjustmentWorkspace.update({
          where: { id: workspaceId },
          data: {
            currentOwnerUserId: actorContext.actorUserId,
            version: { increment: 1 },
            lastActivityAt: new Date(),
            events: {
              create: {
                actorUserId: actorContext.actorUserId,
                eventType: AdjustmentWorkspaceEventType.TAKEN_OVER,
                payloadJson: {
                  previousOwnerUserId: workspace.currentOwnerUserId,
                  nextOwnerUserId: actorContext.actorUserId,
                },
              },
            },
          },
        });

        recordWorkspaceMetric("adjustment_workspace.taken_over", {
          workspaceId,
          previousOwnerUserId: workspace.currentOwnerUserId,
          nextOwnerUserId: actorContext.actorUserId,
        });
      }),
    "Failed to take over workspace"
  );
}

export async function cancelWorkspace(
  workspaceId: string,
  input: { version: number; reason?: string },
  actorContext: ActorContext
): Promise<void> {
  assertStaffActor(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const workspace = await tx.adjustmentWorkspace.findUnique({
          where: { id: workspaceId },
          select: workspaceAuthSelect,
        });
        if (!workspace) throw new Error("Workspace not found");
        assertOpenWorkspace(workspace.status);
        assertWorkspaceVersion(workspace.version, input.version);
        assertWorkspaceOwnerOrManager(workspace.currentOwnerUserId, actorContext);

        await tx.adjustmentWorkspace.update({
          where: { id: workspaceId },
          data: {
            status: AdjustmentWorkspaceStatus.CANCELLED,
            cancelledReason: input.reason?.trim() || "cancelled_by_user",
            version: { increment: 1 },
            lastActivityAt: new Date(),
            events: {
              create: {
                actorUserId: actorContext.actorUserId,
                eventType: AdjustmentWorkspaceEventType.CANCELLED,
                payloadJson: { reason: input.reason?.trim() || null },
              },
            },
          },
        });

        recordWorkspaceMetric("adjustment_workspace.cancelled", {
          workspaceId,
          userId: actorContext.actorUserId,
        });
      }),
    "Failed to cancel workspace"
  );
}

export async function finalizeWorkspace(
  workspaceId: string,
  input: {
    version: number;
    managerApprovedReductionByUserId?: string;
    managerApprovedReason?: string;
  },
  actorContext: ActorContext
): Promise<{ adjustmentInvoiceId: string | null; proposal: AdjustmentWorkspaceProposal }> {
  assertStaffActor(actorContext);
  assertActorPermission(actorContext, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const workspace = await tx.adjustmentWorkspace.findUnique({
          where: { id: workspaceId },
          include: {
            invoice: {
              select: {
                id: true,
                invoiceType: true,
                isLocked: true,
                financialCaseId: true,
                orderId: true,
                bookingId: true,
                customerId: true,
                jobId: true,
                jobNumber: true,
                paidAmount: true,
                remainingAmount: true,
                totalAmount: true,
              },
            },
          },
        });
        if (!workspace) throw new Error("Workspace not found");
        assertOpenWorkspace(workspace.status);
        assertWorkspaceVersion(workspace.version, input.version);
        assertWorkspaceOwnerOrManager(workspace.currentOwnerUserId, actorContext);
        if (workspace.invoice.invoiceType !== InvoiceType.FINAL || !workspace.invoice.isLocked) {
          throw new Error("Workspace parent invoice is no longer a locked final invoice");
        }

        const proposal = await buildProposalForWorkspace(workspace, tx);
        if (!proposal.hasEdits) {
          await markWorkspaceFinalized(tx, workspaceId, actorContext.actorUserId, null, proposal);
          return { adjustmentInvoiceId: null, proposal };
        }

        const approvalUserId = input.managerApprovedReductionByUserId?.trim();
        if (proposal.requiresManagerApproval && !approvalUserId) {
          throw new AdjustmentWorkspaceApprovalRequiredError(proposal);
        }
        if (proposal.requiresManagerApproval && approvalUserId) {
          await assertManagerUser(
            tx,
            approvalUserId,
            "Manager approval is required to finalize a net reduction."
          );
        }

        const invoiceActorUserId =
          proposal.requiresManagerApproval && approvalUserId
            ? approvalUserId
            : actorContext.actorUserId;
        const adjustmentInvoice = await createWorkspaceAdjustmentInvoice(tx, {
          parent: workspace.invoice,
          proposal,
          createdByUserId: invoiceActorUserId,
          notes:
            input.managerApprovedReason?.trim() ||
            `Adjustment workspace finalized on ${new Date().toISOString()}`,
        });

        if (
          new Prisma.Decimal(proposal.netPayableDelta).lessThan(0) &&
          workspace.invoice.remainingAmount.lessThanOrEqualTo(0)
        ) {
          await tx.order.update({
            where: { id: workspace.orderId },
            data: { refundPending: true },
          });
          recordWorkspaceMetric("adjustment_workspace.refund_pending_emitted", {
            workspaceId,
            orderId: workspace.orderId,
          });
        }

        await markWorkspaceFinalized(
          tx,
          workspaceId,
          actorContext.actorUserId,
          adjustmentInvoice.id,
          proposal
        );

        recordWorkspaceMetric("adjustment_workspace.finalized", {
          workspaceId,
          orderId: workspace.orderId,
          adjustmentKind: proposal.adjustmentKind,
        });

        return { adjustmentInvoiceId: adjustmentInvoice.id, proposal };
      }),
    "Failed to finalize workspace"
  );
}

export async function computeWorkspaceProposal(
  base: AdjustmentBaseSnapshot,
  pending: AdjustmentPendingChanges,
  catalog: CatalogLookup
): Promise<AdjustmentWorkspaceProposal> {
  const proposed = cloneSnapshot(base);

  for (const edit of pending.edits) {
    if (edit.op === "add_line") {
      const product = catalog.products.get(edit.refId);
      if (!product) throw new Error("Selected product is not available");
      const line = makeLine({
        lineId: `edit:${edit.id}`,
        kind: edit.kind,
        refId: product.id,
        label: product.name,
        quantity: edit.quantity,
        unitPrice: product.price,
      });
      upsertWorkingLine(proposed.lines, line);
      continue;
    }

    if (edit.op === "remove_line") {
      const existing = proposed.lines.find((line) => line.lineId === edit.targetLineId);
      if (!existing) continue;
      proposed.lines = proposed.lines.filter((line) => line.lineId !== edit.targetLineId);
      continue;
    }

    if (edit.op === "modify_quantity") {
      const existing = proposed.lines.find((line) => line.lineId === edit.targetLineId);
      if (!existing) continue;
      if (edit.newQuantity <= 0) {
        proposed.lines = proposed.lines.filter((line) => line.lineId !== edit.targetLineId);
      } else {
        existing.quantity = edit.newQuantity;
        existing.lineTotalGross = multiplyMoney(existing.unitPrice, edit.newQuantity);
        existing.lineTotalNet = existing.lineTotalGross;
      }
      continue;
    }

    if (edit.op === "swap_package") {
      const existing = proposed.lines.find(
        (line) => line.kind === "package" && line.refId === edit.fromPackageRefId
      );
      const packageRow = catalog.packages.get(edit.toPackageRefId);
      if (!packageRow) throw new Error("Package swap is not available");
      if (!existing) continue;
      const replacement = makeLine({
        lineId: existing.lineId,
        kind: "package",
        refId: packageRow.id,
        label: packageRow.name,
        quantity: existing.quantity,
        unitPrice: packageRow.price,
      });
      proposed.lines = proposed.lines.map((line) =>
        line.lineId === existing.lineId ? replacement : line
      );
      continue;
    }

    const existing = proposed.lines.find((line) => line.lineId === edit.targetLineId);
    const product = catalog.products.get(edit.toAddonRefId);
    if (!product) throw new Error("Add-on swap is not available");
    if (!existing) continue;
    const replacement = makeLine({
      lineId: existing.lineId,
      kind: "addon",
      refId: product.id,
      label: product.name,
      quantity: existing.quantity,
      unitPrice: product.price,
    });
    proposed.lines = proposed.lines.map((line) =>
      line.lineId === existing.lineId ? replacement : line
    );
  }

  proposed.totals = computeTotals(proposed.lines);
  const deltas = diffCompositionLines(base.lines, proposed.lines);
  const grossDelta = decimal(proposed.totals.gross).minus(base.totals.gross);
  const discountDelta = decimal(proposed.totals.discount).minus(base.totals.discount);
  const taxDelta = decimal(proposed.totals.tax).minus(base.totals.tax);
  const netPayableDelta = decimal(proposed.totals.netPayable).minus(base.totals.netPayable);
  const hasEdits = deltas.length > 0;
  const adjustmentKind = !hasEdits
    ? "none"
    : netPayableDelta.greaterThan(0)
      ? "positive"
      : netPayableDelta.lessThan(0)
        ? "negative"
        : "zero_net";

  return {
    base,
    proposed,
    edits: pending.edits,
    deltas,
    grossDelta: grossDelta.toFixed(3),
    discountDelta: discountDelta.toFixed(3),
    taxDelta: taxDelta.toFixed(3),
    netPayableDelta: netPayableDelta.toFixed(3),
    requiresManagerApproval: netPayableDelta.lessThan(0),
    hasEdits,
    adjustmentKind,
  };
}

const workspaceAuthSelect = {
  id: true,
  status: true,
  currentOwnerUserId: true,
  version: true,
  pendingChangesJson: true,
} satisfies Prisma.AdjustmentWorkspaceSelect;

async function mapWorkspaceView(row: WorkspaceRow): Promise<AdjustmentWorkspaceView> {
  const baseSnapshot = parseBaseSnapshot(row.baseSnapshotJson);
  const pendingChanges = parsePendingChanges(row.pendingChangesJson);
  const proposal = await buildProposal(baseSnapshot, pendingChanges);

  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice.invoiceNumber,
    orderId: row.orderId,
    jobNumber: row.order.jobNumber,
    status: row.status.toLowerCase() as AdjustmentWorkspaceView["status"],
    version: row.version,
    openedByUserId: row.openedByUserId,
    openedByName: row.openedByUser.name,
    openedAt: row.openedAt.toISOString(),
    currentOwnerUserId: row.currentOwnerUserId,
    currentOwnerName: row.currentOwnerUser?.name ?? null,
    baseSnapshot,
    pendingChanges,
    proposal,
  };
}

async function buildProposalForWorkspace(
  workspace: {
    baseSnapshotJson: Prisma.JsonValue;
    pendingChangesJson: Prisma.JsonValue;
  },
  client: DbClient
) {
  const baseSnapshot = parseBaseSnapshot(workspace.baseSnapshotJson);
  const pendingChanges = parsePendingChanges(workspace.pendingChangesJson);
  return buildProposal(baseSnapshot, pendingChanges, client);
}

async function buildProposal(
  baseSnapshot: AdjustmentBaseSnapshot,
  pendingChanges: AdjustmentPendingChanges,
  client: DbClient = db
) {
  const [products, packages] = await Promise.all([
    client.product.findMany({
      where: { id: { in: collectProductIds(pendingChanges.edits) } },
      select: { id: true, name: true, canonicalPrice: true },
    }),
    client.package.findMany({
      where: { id: { in: collectPackageIds(pendingChanges.edits) } },
      select: { id: true, name: true, price: true },
    }),
  ]);
  return computeWorkspaceProposal(baseSnapshot, pendingChanges, {
    products: new Map(
      products.map((product) => [
        product.id,
        { id: product.id, name: product.name, price: product.canonicalPrice },
      ])
    ),
    packages: new Map(
      packages.map((packageRow) => [
        packageRow.id,
        { id: packageRow.id, name: packageRow.name, price: packageRow.price },
      ])
    ),
  });
}

async function captureCurrentOrderComposition(
  client: DbClient,
  orderId: string
): Promise<AdjustmentBaseSnapshot> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      packages: {
        include: {
          package: { select: { id: true, name: true, price: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      orderAddOns: {
        select: {
          id: true,
          productId: true,
          nameSnapshot: true,
          priceSnapshot: true,
          quantity: true,
        },
        orderBy: { createdAt: "asc" },
      },
      packageItemUpgrades: {
        select: {
          id: true,
          packageItemId: true,
          nameSnapshot: true,
          priceSnapshot: true,
          quantity: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) throw new Error("Order not found");

  const lines: AdjustmentCompositionLine[] = [];
  for (const orderPackage of order.packages) {
    lines.push(
      makeLine({
        lineId: `package:${orderPackage.id}`,
        kind: "package",
        refId: orderPackage.packageId,
        label: orderPackage.package.name,
        quantity: 1,
        unitPrice: orderPackage.finalPackagePriceSnapshot ?? orderPackage.package.price,
      })
    );
  }
  for (const addOn of order.orderAddOns) {
    lines.push(
      makeLine({
        lineId: `addon:${addOn.id}`,
        kind: "addon",
        refId: addOn.productId,
        label: addOn.nameSnapshot,
        quantity: addOn.quantity,
        unitPrice: addOn.priceSnapshot,
      })
    );
  }
  for (const upgrade of order.packageItemUpgrades) {
    lines.push(
      makeLine({
        lineId: `item:${upgrade.id}`,
        kind: "item",
        refId: upgrade.packageItemId,
        label: upgrade.nameSnapshot,
        quantity: upgrade.quantity,
        unitPrice: upgrade.priceSnapshot,
      })
    );
  }

  return {
    capturedAt: new Date().toISOString(),
    lines,
    totals: computeTotals(lines),
  };
}

function applySignedInvoiceLines(
  lines: AdjustmentCompositionLine[],
  invoiceLines: Array<{
    id: string;
    lineType: InvoiceLineType;
    description: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    causeOrderEntityKind: OrderEntityKind | null;
    causeOrderEntityId: string | null;
  }>
) {
  for (const invoiceLine of invoiceLines) {
    const signedQuantity =
      invoiceLine.unitPrice.lessThan(0) || invoiceLine.lineTotal.lessThan(0)
        ? -invoiceLine.quantity
        : invoiceLine.quantity;
    const line = makeLine({
      lineId: `adj:${invoiceLine.id}`,
      kind: kindFromInvoiceLine(invoiceLine.lineType, invoiceLine.causeOrderEntityKind),
      refId: invoiceLine.causeOrderEntityId ?? invoiceLine.description,
      label: invoiceLine.description,
      quantity: signedQuantity,
      unitPrice: invoiceLine.unitPrice.abs(),
    });
    upsertWorkingLine(lines, line);
  }
}

async function createWorkspaceAdjustmentInvoice(
  client: DbClient,
  input: {
    parent: {
      id: string;
      financialCaseId: string;
      orderId: string | null;
      bookingId: string | null;
      customerId: string;
      jobId: string | null;
      jobNumber: string | null;
    };
    proposal: AdjustmentWorkspaceProposal;
    createdByUserId: string;
    notes: string;
  }
) {
  const totalAmount = new Prisma.Decimal(input.proposal.netPayableDelta);
  const now = new Date();
  const invoiceNumberData = await generateInvoiceNumber(client, InvoiceType.ADJUSTMENT);
  const invoice = await client.invoice.create({
    data: {
      publicId: await generatePublicId(client, PUBLIC_ID_KIND.INVOICE),
      financialCaseId: input.parent.financialCaseId,
      invoiceType: InvoiceType.ADJUSTMENT,
      jobId: input.parent.jobId,
      jobNumber: input.parent.jobNumber,
      orderId: input.parent.orderId,
      bookingId: input.parent.bookingId,
      customerId: input.parent.customerId,
      parentInvoiceId: input.parent.id,
      ...invoiceNumberData,
      totalAmount,
      remainingAmount: Prisma.Decimal.max(totalAmount, 0),
      status: totalAmount.greaterThan(0) ? InvoiceStatus.ISSUED : InvoiceStatus.CLOSED,
      isLocked: totalAmount.lessThanOrEqualTo(0),
      notes: input.notes,
      issuedAt: now,
      closedAt: totalAmount.lessThanOrEqualTo(0) ? now : null,
      lineItems: {
        create: input.proposal.deltas.map((line, index) => ({
          lineType: invoiceLineTypeForKind(line.kind),
          description: line.label,
          quantity: Math.abs(line.quantity),
          unitPrice:
            line.quantity < 0
              ? new Prisma.Decimal(line.unitPrice).neg()
              : new Prisma.Decimal(line.unitPrice),
          lineTotal: new Prisma.Decimal(line.lineTotalNet),
          sortOrder: index,
          causeOrderEntityKind: orderEntityKindForLine(line),
          causeOrderEntityId: line.refId,
        })),
      },
    },
  });

  const auditActor = await client.user.findUnique({
    where: { id: input.createdByUserId },
    select: { id: true, role: true },
  });
  if (!auditActor) throw new Error("Adjustment actor was not found");

  if (invoice.isLocked) {
    await recordInvoiceLockSnapshot(client, invoice, input.createdByUserId);
  }

  await recordAuditLog(client, { actorUserId: auditActor.id, actorRole: auditActor.role }, {
    entityType: AuditEntityType.INVOICE,
    entityId: invoice.id,
    action: AuditAction.ADJUSTMENT_ISSUED,
    after: {
      adjustmentInvoiceId: invoice.id,
      parentFinalInvoiceId: input.parent.id,
      adjustmentKind: input.proposal.adjustmentKind,
      netPayableDelta: input.proposal.netPayableDelta,
    },
    context: {
      financialCaseId: input.parent.financialCaseId,
      orderId: input.parent.orderId,
      bookingId: input.parent.bookingId,
    },
  });

  if (input.parent.orderId) {
    await recordOrderActivity(client, {
      orderId: input.parent.orderId,
      userId: input.createdByUserId,
      type: OrderActivityType.INVOICE_ADJUSTED,
      title: "Adjustment workspace finalized",
      description: `Adjustment ${invoice.invoiceNumber} was issued from a staged workspace.`,
      metadata: {
        parentInvoiceId: input.parent.id,
        adjustmentInvoiceId: invoice.id,
        adjustmentInvoiceNumber: invoice.invoiceNumber,
        adjustmentKind: input.proposal.adjustmentKind,
        netPayableDelta: input.proposal.netPayableDelta,
      },
    });
  }

  return invoice;
}

async function markWorkspaceFinalized(
  client: DbClient,
  workspaceId: string,
  actorUserId: string,
  adjustmentInvoiceId: string | null,
  proposal: AdjustmentWorkspaceProposal
) {
  await client.adjustmentWorkspace.update({
    where: { id: workspaceId },
    data: {
      status: AdjustmentWorkspaceStatus.FINALIZED,
      finalizedAdjustmentInvoiceId: adjustmentInvoiceId,
      version: { increment: 1 },
      lastActivityAt: new Date(),
      events: {
        create: {
          actorUserId,
          eventType: AdjustmentWorkspaceEventType.FINALIZED,
          payloadJson: {
            adjustmentInvoiceId,
            adjustmentKind: proposal.adjustmentKind,
            netPayableDelta: proposal.netPayableDelta,
            editCount: proposal.edits.length,
          },
        },
      },
    },
  });
}

function parseBaseSnapshot(value: Prisma.JsonValue): AdjustmentBaseSnapshot {
  if (!isRecord(value) || !Array.isArray(value.lines) || !isRecord(value.totals)) {
    throw new Error("Workspace base snapshot is invalid");
  }
  return value as unknown as AdjustmentBaseSnapshot;
}

function parsePendingChanges(value: Prisma.JsonValue): AdjustmentPendingChanges {
  const parsed = adjustmentPendingChangesSchema.safeParse(value);
  if (!parsed.success) throw new Error("Workspace pending changes are invalid");
  return parsed.data;
}

function removeEditAndDependents(
  edits: AdjustmentWorkspaceEdit[],
  removedEditId: string
): AdjustmentWorkspaceEdit[] {
  const removedEditIds = new Set([removedEditId]);
  const removedLineIds = new Set<string>();
  const removedPackageRefs = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;

    for (const edit of edits) {
      if (!removedEditIds.has(edit.id)) continue;
      if (edit.op === "add_line") {
        const lineId = `edit:${edit.id}`;
        if (!removedLineIds.has(lineId)) {
          removedLineIds.add(lineId);
          changed = true;
        }
      }
      if (edit.op === "swap_package" && !removedPackageRefs.has(edit.toPackageRefId)) {
        removedPackageRefs.add(edit.toPackageRefId);
        changed = true;
      }
    }

    for (const edit of edits) {
      if (removedEditIds.has(edit.id)) continue;
      if (
        (("targetLineId" in edit) && removedLineIds.has(edit.targetLineId)) ||
        (edit.op === "swap_package" && removedPackageRefs.has(edit.fromPackageRefId))
      ) {
        removedEditIds.add(edit.id);
        changed = true;
      }
    }
  }

  return edits.filter((edit) => !removedEditIds.has(edit.id));
}

function cloneSnapshot(snapshot: AdjustmentBaseSnapshot): AdjustmentBaseSnapshot {
  return {
    capturedAt: snapshot.capturedAt,
    lines: snapshot.lines.map((line) => ({
      ...line,
      taxBreakdown: line.taxBreakdown.map((tax) => ({ ...tax })),
    })),
    totals: { ...snapshot.totals },
  };
}

function makeLine(input: {
  lineId: string;
  kind: AdjustmentLineKind;
  refId: string;
  label: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
}): AdjustmentCompositionLine {
  return {
    lineId: input.lineId,
    kind: input.kind,
    refId: input.refId,
    label: input.label,
    quantity: input.quantity,
    unitPrice: input.unitPrice.toFixed(3),
    lineTotalGross: input.unitPrice.mul(input.quantity).toFixed(3),
    lineTotalNet: input.unitPrice.mul(input.quantity).toFixed(3),
    taxBreakdown: [],
  };
}

function negateLine(line: AdjustmentCompositionLine): AdjustmentCompositionLine {
  return {
    ...line,
    quantity: -line.quantity,
    lineTotalGross: decimal(line.lineTotalGross).neg().toFixed(3),
    lineTotalNet: decimal(line.lineTotalNet).neg().toFixed(3),
    taxBreakdown: line.taxBreakdown.map((tax) => ({
      ...tax,
      amount: decimal(tax.amount).neg().toFixed(3),
    })),
  };
}

function diffCompositionLines(
  baseLines: AdjustmentCompositionLine[],
  proposedLines: AdjustmentCompositionLine[]
): AdjustmentCompositionLine[] {
  const baseGroups = groupCompositionLines(baseLines);
  const proposedGroups = groupCompositionLines(proposedLines);
  const keys = [
    ...baseGroups.keys(),
    ...[...proposedGroups.keys()].filter((key) => !baseGroups.has(key)),
  ];
  const deltas: AdjustmentCompositionLine[] = [];

  for (const key of keys) {
    const base = baseGroups.get(key);
    const proposed = proposedGroups.get(key);
    if (base && proposed && base.quantity === proposed.quantity) {
      const netDelta = decimal(proposed.lineTotalNet).minus(base.lineTotalNet);
      const grossDelta = decimal(proposed.lineTotalGross).minus(base.lineTotalGross);
      if (netDelta.equals(0) && grossDelta.equals(0)) continue;

      deltas.push(negateLine(base), proposed);
      continue;
    }

    const quantityDelta = (proposed?.quantity ?? 0) - (base?.quantity ?? 0);
    if (quantityDelta === 0) continue;

    const netDelta = decimal(proposed?.lineTotalNet ?? 0).minus(base?.lineTotalNet ?? 0);
    const grossDelta = decimal(proposed?.lineTotalGross ?? 0).minus(
      base?.lineTotalGross ?? 0
    );
    const source = quantityDelta > 0 ? proposed : base;
    if (!source) continue;

    deltas.push({
      ...source,
      lineId: `delta:${source.kind}:${source.refId}`,
      quantity: quantityDelta,
      unitPrice: netDelta.div(quantityDelta).abs().toFixed(3),
      lineTotalGross: grossDelta.toFixed(3),
      lineTotalNet: netDelta.toFixed(3),
      taxBreakdown: [],
    });
  }

  return deltas;
}

function groupCompositionLines(lines: AdjustmentCompositionLine[]) {
  const grouped = new Map<string, AdjustmentCompositionLine>();
  for (const line of lines) {
    const key = compositionKey(line);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...line, taxBreakdown: line.taxBreakdown.map((tax) => ({ ...tax })) });
      continue;
    }

    existing.quantity += line.quantity;
    existing.lineTotalGross = decimal(existing.lineTotalGross)
      .plus(line.lineTotalGross)
      .toFixed(3);
    existing.lineTotalNet = decimal(existing.lineTotalNet)
      .plus(line.lineTotalNet)
      .toFixed(3);
  }
  return grouped;
}

function compositionKey(line: Pick<AdjustmentCompositionLine, "kind" | "refId">) {
  return `${line.kind}:${line.refId}`;
}

function upsertWorkingLine(
  lines: AdjustmentCompositionLine[],
  signedLine: AdjustmentCompositionLine
) {
  const match = lines.find(
    (line) => line.kind === signedLine.kind && line.refId === signedLine.refId
  );
  if (!match) {
    if (signedLine.quantity < 0) {
      throw new Error("Adjustment attempted to remove a line that does not exist");
    }
    lines.push({ ...signedLine });
    return;
  }

  match.quantity += signedLine.quantity;
  match.lineTotalGross = decimal(match.lineTotalGross)
    .plus(signedLine.lineTotalGross)
    .toFixed(3);
  match.lineTotalNet = decimal(match.lineTotalNet)
    .plus(signedLine.lineTotalNet)
    .toFixed(3);
  if (match.quantity <= 0) {
    lines.splice(lines.indexOf(match), 1);
  }
}

function computeTotals(lines: AdjustmentCompositionLine[]): AdjustmentCompositionTotals {
  const netPayable = lines.reduce(
    (sum, line) => sum.plus(line.lineTotalNet),
    moneyZero
  );
  const gross = lines.reduce((sum, line) => sum.plus(line.lineTotalGross), moneyZero);
  return {
    gross: gross.toFixed(3),
    discount: "0.000",
    tax: "0.000",
    netPayable: netPayable.toFixed(3),
  };
}

function multiplyMoney(value: string, quantity: number): string {
  return decimal(value).mul(quantity).toFixed(3);
}

function decimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function collectProductIds(edits: AdjustmentWorkspaceEdit[]): string[] {
  return edits.flatMap((edit) => {
    if (edit.op === "add_line") return [edit.refId];
    if (edit.op === "swap_addon") return [edit.toAddonRefId];
    return [];
  });
}

function collectPackageIds(edits: AdjustmentWorkspaceEdit[]): string[] {
  return edits.flatMap((edit) => edit.op === "swap_package" ? [edit.toPackageRefId] : []);
}

function eventTypeForEdit(edit: AdjustmentWorkspaceEdit): AdjustmentWorkspaceEventType {
  if (edit.op === "swap_package") return AdjustmentWorkspaceEventType.PACKAGE_SWAPPED;
  return AdjustmentWorkspaceEventType.EDIT_ADDED;
}

function kindFromInvoiceLine(
  lineType: InvoiceLineType,
  causeKind: OrderEntityKind | null
): AdjustmentLineKind {
  if (causeKind === OrderEntityKind.ADDON) return "addon";
  if (causeKind === OrderEntityKind.UPGRADE) return "item";
  if (lineType === InvoiceLineType.PACKAGE_BASE || causeKind === OrderEntityKind.PACKAGE_TIER_UPGRADE) {
    return "package";
  }
  if (lineType === InvoiceLineType.ADD_ON) return "addon";
  return "item";
}

function invoiceLineTypeForKind(kind: AdjustmentLineKind): InvoiceLineType {
  if (kind === "package") return InvoiceLineType.PACKAGE_UPGRADE;
  if (kind === "addon") return InvoiceLineType.ADD_ON;
  return InvoiceLineType.BUNDLE_ADJUSTMENT;
}

function orderEntityKindForLine(line: AdjustmentCompositionLine): OrderEntityKind {
  if (line.kind === "package") return OrderEntityKind.PACKAGE_TIER_UPGRADE;
  if (line.kind === "addon") return OrderEntityKind.ADDON;
  return OrderEntityKind.UPGRADE;
}

function assertStaffActor(actorContext: ActorContext): void {
  if (!actorContext.actorUserId || !actorContext.actorRole) {
    throw new Error("Missing actor context");
  }
}

function assertManagerActor(actorContext: ActorContext, message: string): void {
  assertStaffActor(actorContext);
  if (
    actorContext.actorRole !== UserRole.ADMIN &&
    actorContext.actorRole !== UserRole.MANAGER
  ) {
    throw new Error(message);
  }
}

async function assertManagerUser(
  client: DbClient,
  userId: string,
  message: string
): Promise<void> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGER)) {
    throw new Error(message);
  }
}

function assertOpenWorkspace(status: AdjustmentWorkspaceStatus): void {
  if (status !== AdjustmentWorkspaceStatus.OPEN) {
    throw new Error("Workspace is not open");
  }
}

function assertWorkspaceVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new AdjustmentWorkspaceConflictError();
}

function assertWorkspaceOwnerOrManager(
  ownerUserId: string | null,
  actorContext: ActorContext
): void {
  if (
    ownerUserId === actorContext.actorUserId ||
    actorContext.actorRole === UserRole.ADMIN ||
    actorContext.actorRole === UserRole.MANAGER
  ) {
    return;
  }
  throw new Error("Only the workspace owner or a manager can change this workspace");
}

function isRecord(value: Prisma.JsonValue): value is Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatMoney(value: Prisma.Decimal): string {
  return `${value.toFixed(3)} KD`;
}

function recordWorkspaceMetric(
  metric: string,
  fields: Record<string, string | number | null>
): void {
  console.info(JSON.stringify({ metric, ...fields }));
}
