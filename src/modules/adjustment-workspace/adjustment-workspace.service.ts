import {
  AdjustmentWorkspaceEventType,
  AdjustmentWorkspaceStatus,
  AuditAction,
  AuditEntityType,
  InvoiceLineType,
  InvoiceStatus,
  InvoiceType,
  MediaType,
  OrderActivityType,
  OrderEntityKind,
  Prisma,
  SessionConfigurationCounterPricingMode,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
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
import { getPOSWorkspace } from "@/modules/orders/order.service";
import { derivePaymentSummary } from "@/modules/orders/order-settlement";
import {
  priceSelections,
  type PricedSelection,
} from "@/modules/session-configurations/session-configuration-pricing";
import {
  applyFinancialSelectionEditFromWorkspace,
  type WorkspaceSessionConfigurationDesired,
} from "@/modules/session-configurations/session-configuration-selection.service";
import type {
  POSAddOn,
  POSPackage,
  POSPackageItem,
  POSPackageLine,
  POSPackageOption,
  POSWorkspace,
} from "@/modules/orders/order.types";
import { adjustmentPendingChangesSchema } from "./adjustment-workspace.schema";
import type {
  AdjustmentBaseSnapshot,
  AdjustmentCompositionLine,
  AdjustmentCompositionTotals,
  AdjustmentLineKind,
  AdjustmentPendingChanges,
  AdjustmentSessionConfigurationSelection,
  PendingAdjustmentPreview,
  AdjustmentWorkspaceEdit,
  AdjustmentWorkspaceProposal,
  AdjustmentWorkspaceView,
} from "./adjustment-workspace.types";

type DbClient = typeof db | Prisma.TransactionClient;

type CatalogLookup = {
  products: Map<string, { id: string; name: string; price: Prisma.Decimal }>;
  packages: Map<
    string,
    { id: string; name: string; price: Prisma.Decimal; photoCount?: number }
  >;
  packageItems?: Map<
    string,
    {
      id: string;
      packageId: string;
      productId: string;
      productName: string;
      price: Prisma.Decimal;
      quantity: number;
    }
  >;
  orderPackages?: Map<
    string,
    {
      id: string;
      packageId: string;
      packageName: string;
      includedPhotoCount: number;
      sessionTypeId: string;
      extraDigitalUnitPrice: Prisma.Decimal;
      extraPrintUnitPrice: Prisma.Decimal;
    }
  >;
  sessionConfigurations?: Map<
    string,
    {
      id: string;
      sessionTypeId: string;
      code: string;
      name: string;
      inputType: SessionConfigurationInputType;
      pricingMode: SessionConfigurationPricingMode;
      financialBehavior: SessionConfigurationFinancialBehavior;
      fixedPriceDelta: Prisma.Decimal | null;
      linkedProductId: string | null;
      linkProductDisplay: "LINE_ITEM" | "MODIFIER_ONLY" | null;
      linkedProductPrice: Prisma.Decimal | null;
      counterPricingMode: SessionConfigurationCounterPricingMode | null;
      counterUnitPrice: Prisma.Decimal | null;
      options: Map<string, { id: string; label: string; priceDelta: Prisma.Decimal }>;
    }
  >;
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
const EXTRA_PHOTO_REF_PREFIX = "Extra photos - ";

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

export async function derivePOSWorkspaceFromAdjustmentWorkspace(
  workspaceId: string
): Promise<POSWorkspace | null> {
  const workspace = await getAdjustmentWorkspaceView(workspaceId);
  if (!workspace) return null;

  const posWorkspace = await getPOSWorkspace(workspace.orderId);
  if (!posWorkspace) return null;

  const proposedLines = workspace.proposal.proposed.lines;
  const proposedPackageRefs = proposedLines.flatMap((line) =>
    line.kind === "package" ? [line.refId] : []
  );
  const packageRows = await db.package.findMany({
    where: { id: { in: proposedPackageRefs } },
    select: {
      id: true,
      name: true,
      price: true,
      photoCount: true,
      bundleAdjustment: true,
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          priceSnapshot: true,
          product: { select: { name: true, category: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  const packagesById = new Map(packageRows.map((row) => [row.id, row]));
  const packageLines = posWorkspace.packageLines.map((line) =>
    derivePOSPackageLine(line, proposedLines, packagesById)
  );
  const packageItems = packageLines.flatMap((line) => line.packageItems);
  const addOns = derivePOSAddOns(proposedLines);
  const extraPhotoTotal = packageLines.reduce(
    (sum, line) => sum + line.extraPhotoTotal,
    0
  );
  const addOnTotal = addOns.reduce((sum, addOn) => sum + addOn.price, 0);

  return {
    ...posWorkspace,
    packageLines,
    packageItems,
    rawDeliverableTotal: packageItems.reduce(
      (sum, item) => sum + item.priceSnapshot * item.quantity,
      0
    ),
    includedPhotoCount: packageLines.reduce(
      (sum, line) => sum + line.includedPhotoCount,
      0
    ),
    selectedPhotoCount: packageLines.reduce(
      (sum, line) => sum + line.selectedPhotoCount,
      0
    ),
    extraPhotoCount: packageLines.reduce(
      (sum, line) => sum + line.extraPhotoCount,
      0
    ),
    extraPhotoTotal,
    addOns,
    addOnTotal,
    invoice: posWorkspace.invoice
      ? { ...posWorkspace.invoice, isLocked: true }
      : posWorkspace.invoice,
    aggregateOutstanding:
      (posWorkspace.invoice?.remainingAmount ?? 0) +
      posWorkspace.adjustmentInvoices.reduce(
        (sum, invoice) => sum + invoice.remainingAmount,
        0
      ),
  };
}

export async function derivePendingAdjustmentPreview(
  workspaceId: string
): Promise<PendingAdjustmentPreview | null> {
  const workspace = await db.adjustmentWorkspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      invoiceId: true,
      baseSnapshotJson: true,
      pendingChangesJson: true,
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalAmount: true,
          remainingAmount: true,
        },
      },
    },
  });
  if (!workspace) return null;

  const finalizedAdjustments = await db.invoice.findMany({
    where: {
      parentInvoiceId: workspace.invoiceId,
      invoiceType: InvoiceType.ADJUSTMENT,
      status: { not: InvoiceStatus.DRAFT },
    },
    select: {
      totalAmount: true,
      remainingAmount: true,
    },
    orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const proposal = await buildProposalForWorkspace(workspace, db);
  const pendingAdditions = proposal.deltas
    .map((line) => new Prisma.Decimal(line.lineTotalNet))
    .filter((amount) => amount.greaterThan(0))
    .reduce((sum, amount) => sum.plus(amount), moneyZero)
    .toNumber();
  const pendingReductions = proposal.deltas
    .map((line) => new Prisma.Decimal(line.lineTotalNet))
    .filter((amount) => amount.lessThan(0))
    .reduce((sum, amount) => sum.plus(amount), moneyZero)
    .toNumber();

  return {
    baseLockedTotal: derivePaymentSummary({
      invoice: workspace.invoice,
      finalizedAdjustments,
    }).effectiveTotal,
    pendingAdditions,
    pendingReductions,
    pendingNet: new Prisma.Decimal(proposal.netPayableDelta).toNumber(),
    approvalRequired: proposal.requiresManagerApproval,
    parentInvoice: {
      id: workspace.invoice.id,
      number: workspace.invoice.invoiceNumber,
      status: workspace.invoice.status,
    },
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
        await buildProposal(
          parseBaseSnapshot(workspace.baseSnapshotJson),
          { edits: nextEdits },
          tx
        );
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

        recordWorkspaceMetric(
          `adjustment_workspace.edit.${input.edit.op}.staged`,
          {
            workspaceId,
            orderId: workspace.orderId,
            invoiceId: workspace.invoiceId,
            op: input.edit.op,
          }
        );
        if (input.edit.op === "change_session_configuration_selection") {
          recordWorkspaceMetric(
            "adjustment_workspace.session_configuration_edit_applied",
            {
              workspaceId,
              orderId: workspace.orderId,
              invoiceId: workspace.invoiceId,
            }
          );
        }
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
        const sessionConfigurationSelectionIds =
          await finalizeSessionConfigurationSelectionEdits(
            tx,
            proposal.edits
          );
        const finalizedProposal = remapSessionConfigurationProposal(
          proposal,
          sessionConfigurationSelectionIds
        );

        const adjustmentInvoice = await createWorkspaceAdjustmentInvoice(tx, {
          parent: workspace.invoice,
          proposal: finalizedProposal,
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
          finalizedProposal
        );

        recordWorkspaceMetric("adjustment_workspace.finalized", {
          workspaceId,
          orderId: workspace.orderId,
          adjustmentKind: finalizedProposal.adjustmentKind,
          editOps: [...new Set(finalizedProposal.edits.map((edit) => edit.op))].join(","),
        });

        return { adjustmentInvoiceId: adjustmentInvoice.id, proposal: finalizedProposal };
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
  const packageItems = catalog.packageItems ?? new Map();
  const orderPackages = catalog.orderPackages ?? new Map();

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

    if (edit.op === "upgrade_package_item") {
      const currentItem = packageItems.get(edit.packageItemId);
      const orderPackage = orderPackages.get(edit.orderPackageId);
      const product = catalog.products.get(edit.toProductId);
      if (!currentItem) throw new Error("Package item is not available");
      if (!orderPackage) throw new Error("Package line is not available");
      const effectivePackageId = resolveEffectivePackageId(
        pending.edits,
        edit.orderPackageId,
        orderPackage.packageId
      );
      if (currentItem.packageId !== effectivePackageId) {
        throw new Error("Package item does not belong to the specified order package");
      }
      if (!product) throw new Error("Replacement product is not available");

      const existing = findPackageItemUpgradeLine(
        proposed.lines,
        edit.orderPackageId,
        edit.packageItemId
      );
      const replacement = makeLine({
        lineId: packageItemUpgradeLineId(edit.orderPackageId, edit.packageItemId),
        kind: "item",
        refId: product.id,
        label: `${currentItem.productName} to ${product.name}`,
        quantity: edit.quantity,
        unitPrice: product.price.minus(currentItem.price),
      });

      if (existing) {
        proposed.lines = proposed.lines.map((line) =>
          line.lineId === existing.lineId ? replacement : line
        );
      } else {
        upsertWorkingLine(proposed.lines, replacement);
      }
      continue;
    }

    if (edit.op === "change_selected_photo_count") {
      applySelectedPhotoCountChange(proposed.lines, edit, catalog, orderPackages);
      continue;
    }

    if (edit.op === "change_package_tier") {
      const existing = proposed.lines.find(
        (line) => line.kind === "package" && line.lineId === `package:${edit.orderPackageId}`
      );
      const packageRow = catalog.packages.get(edit.toPackageRefId);
      if (!packageRow) throw new Error("Package tier change is not available");
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

    if (edit.op === "change_session_configuration_selection") {
      applySessionConfigurationSelectionChange(proposed, edit, catalog);
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
  orderId: true,
  invoiceId: true,
  baseSnapshotJson: true,
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
  const orderPackageIds = collectOrderPackageIds(pendingChanges.edits);
  const hasPhotoCountEdits = pendingChanges.edits.some(
    (edit) => edit.op === "change_selected_photo_count"
  );
  const sessionConfigurationIds = collectSessionConfigurationIds(pendingChanges.edits);
  const [products, packages, packageItems, orderPackages, sessionConfigurations] = await Promise.all([
    client.product.findMany({
      where: { id: { in: collectProductIds(pendingChanges.edits) } },
      select: { id: true, name: true, canonicalPrice: true },
    }),
    client.package.findMany({
      where: {
        id: {
          in: [
            ...collectPackageIds(pendingChanges.edits),
            ...collectBasePackageRefs(baseSnapshot, orderPackageIds),
          ],
        },
      },
      select: { id: true, name: true, price: true, photoCount: true },
    }),
    client.packageItem.findMany({
      where: { id: { in: collectPackageItemIds(pendingChanges.edits) } },
      select: {
        id: true,
        packageId: true,
        productId: true,
        quantity: true,
        priceSnapshot: true,
        product: { select: { name: true } },
      },
    }),
    client.orderPackage.findMany({
      where: { id: { in: orderPackageIds } },
      select: {
        id: true,
        packageId: true,
        sessionTypeId: true,
        package: { select: { name: true, photoCount: true } },
      },
    }),
    client.sessionConfiguration.findMany({
      where: {
        id: { in: sessionConfigurationIds },
        isActive: true,
      },
      select: {
        id: true,
        sessionTypeId: true,
        code: true,
        name: true,
        inputType: true,
        pricingMode: true,
        financialBehavior: true,
        fixedPriceDelta: true,
        linkedProductId: true,
        linkProductDisplay: true,
        linkedProduct: { select: { canonicalPrice: true } },
        counterPricingMode: true,
        counterUnitPrice: true,
        options: {
          where: { isActive: true },
          select: { id: true, label: true, priceDelta: true },
        },
      },
    }),
  ]);
  const extraPhotoPrices = await getExtraPhotoPriceMap(
    client,
    orderPackages.map((orderPackage) => orderPackage.sessionTypeId)
  );
  if (hasPhotoCountEdits) {
    for (const orderPackage of orderPackages) {
      if (
        !extraPhotoPrices.has(extraPhotoPriceKey(orderPackage.sessionTypeId, MediaType.DIGITAL)) ||
        !extraPhotoPrices.has(extraPhotoPriceKey(orderPackage.sessionTypeId, MediaType.PRINT))
      ) {
        throw new Error("Extra-photo pricing is required for this package line");
      }
    }
  }
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
        {
          id: packageRow.id,
          name: packageRow.name,
          price: packageRow.price,
          photoCount: packageRow.photoCount,
        },
      ])
    ),
    packageItems: new Map(
      packageItems.map((packageItem) => [
        packageItem.id,
        {
          id: packageItem.id,
          packageId: packageItem.packageId,
          productId: packageItem.productId,
          productName: packageItem.product.name,
          price: packageItem.priceSnapshot,
          quantity: packageItem.quantity,
        },
      ])
    ),
    orderPackages: new Map(
      orderPackages.map((orderPackage) => [
        orderPackage.id,
        {
          id: orderPackage.id,
          packageId: orderPackage.packageId,
          packageName: orderPackage.package.name,
          includedPhotoCount: orderPackage.package.photoCount,
          sessionTypeId: orderPackage.sessionTypeId,
          extraDigitalUnitPrice: extraPhotoPrices.get(extraPhotoPriceKey(
            orderPackage.sessionTypeId,
            MediaType.DIGITAL
          )) ?? moneyZero,
          extraPrintUnitPrice: extraPhotoPrices.get(extraPhotoPriceKey(
            orderPackage.sessionTypeId,
            MediaType.PRINT
          )) ?? moneyZero,
        },
      ])
    ),
    sessionConfigurations: new Map(
      sessionConfigurations.map((configuration) => [
        configuration.id,
        {
          id: configuration.id,
          sessionTypeId: configuration.sessionTypeId,
          code: configuration.code,
          name: configuration.name,
          inputType: configuration.inputType,
          pricingMode: configuration.pricingMode,
          financialBehavior: configuration.financialBehavior,
          fixedPriceDelta: configuration.fixedPriceDelta,
          linkedProductId: configuration.linkedProductId,
          linkProductDisplay: configuration.linkProductDisplay,
          linkedProductPrice: configuration.linkedProduct?.canonicalPrice ?? null,
          counterPricingMode: configuration.counterPricingMode,
          counterUnitPrice: configuration.counterUnitPrice,
          options: new Map(
            configuration.options.map((option) => [
              option.id,
              {
                id: option.id,
                label: option.label,
                priceDelta: option.priceDelta,
              },
            ])
          ),
        },
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
          package: { select: { id: true, name: true, price: true, photoCount: true } },
          sessionConfigurationSelections: {
            select: {
              id: true,
              orderPackageId: true,
              configurationId: true,
              optionId: true,
              numericValue: true,
              textValue: true,
              snapshotConfigurationCode: true,
              snapshotLabel: true,
              snapshotPriceDelta: true,
              snapshotFinancialBehavior: true,
              snapshotInputType: true,
              snapshotPricingMode: true,
              snapshotLinkedProductId: true,
              snapshotLinkProductDisplay: true,
            },
          },
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
          orderPackageId: true,
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
  const extraPhotoPrices = await getExtraPhotoPriceMap(
    client,
    order.packages.map((orderPackage) => orderPackage.sessionTypeId)
  );
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
    for (const mediaType of [MediaType.DIGITAL, MediaType.PRINT] as const) {
      const quantity =
        mediaType === MediaType.DIGITAL
          ? orderPackage.extraDigitalCount
          : orderPackage.extraPrintCount;
      if (quantity <= 0) continue;
      const unitPrice = extraPhotoPrices.get(extraPhotoPriceKey(
        orderPackage.sessionTypeId,
        mediaType
      ));
      if (!unitPrice) continue;
      lines.push(
        makeLine({
          lineId: extraPhotoLineId(orderPackage.id, mediaType),
          kind: "item",
          refId: extraPhotoRef(orderPackage.package.name, mediaType),
          label: extraPhotoRef(orderPackage.package.name, mediaType),
          quantity,
          unitPrice,
        })
      );
    }
    for (const selection of orderPackage.sessionConfigurationSelections) {
      if (
        selection.snapshotFinancialBehavior !==
        SessionConfigurationFinancialBehavior.FINANCIAL
      ) {
        continue;
      }
      lines.push(...linesForSessionConfigurationSelection({
        id: selection.id,
        orderPackageId: selection.orderPackageId,
        configurationId: selection.configurationId,
        optionId: selection.optionId,
        numericValue: selection.numericValue?.toString() ?? null,
        textValue: selection.textValue,
        snapshotConfigurationCode: selection.snapshotConfigurationCode,
        snapshotLabel: selection.snapshotLabel,
        snapshotPriceDelta: selection.snapshotPriceDelta.toFixed(3),
        snapshotFinancialBehavior: selection.snapshotFinancialBehavior,
        snapshotInputType: selection.snapshotInputType,
        snapshotPricingMode: selection.snapshotPricingMode,
        snapshotLinkedProductId: selection.snapshotLinkedProductId,
        snapshotLinkProductDisplay: selection.snapshotLinkProductDisplay,
      }));
    }
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
        lineId: packageItemUpgradeLineId(upgrade.orderPackageId, upgrade.packageItemId),
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
    sessionConfigurationSelections: order.packages.flatMap((orderPackage) =>
      orderPackage.sessionConfigurationSelections.map((selection) => ({
        id: selection.id,
        orderPackageId: selection.orderPackageId,
        configurationId: selection.configurationId,
        optionId: selection.optionId,
        numericValue: selection.numericValue?.toString() ?? null,
        textValue: selection.textValue,
        snapshotConfigurationCode: selection.snapshotConfigurationCode,
        snapshotLabel: selection.snapshotLabel,
        snapshotPriceDelta: selection.snapshotPriceDelta.toFixed(3),
        snapshotFinancialBehavior: selection.snapshotFinancialBehavior,
        snapshotInputType: selection.snapshotInputType,
        snapshotPricingMode: selection.snapshotPricingMode,
        snapshotLinkedProductId: selection.snapshotLinkedProductId,
        snapshotLinkProductDisplay: selection.snapshotLinkProductDisplay,
      }))
    ),
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
    if (
      invoiceLine.causeOrderEntityKind ===
      OrderEntityKind.SESSION_CONFIGURATION_SELECTION
    ) {
      continue;
    }
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

async function finalizeSessionConfigurationSelectionEdits(
  client: Prisma.TransactionClient,
  edits: AdjustmentWorkspaceEdit[]
): Promise<Map<string, string>> {
  const selectionIdByPlaceholder = new Map<string, string>();
  for (const edit of edits) {
    if (edit.op !== "change_session_configuration_selection") continue;
    const result = await applyFinancialSelectionEditFromWorkspace(client, {
      orderPackageId: edit.orderPackageId,
      configurationId: edit.configurationId,
      desired: edit.desired,
    });
    if (result.selectionId) {
      selectionIdByPlaceholder.set(
        pendingSessionConfigurationSelectionId(edit.configurationId),
        result.selectionId
      );
      recordWorkspaceMetric(
        "adjustment_workspace.session_configuration_edit_finalized",
        {
          workspaceId: "in_transaction",
          orderId: null,
          selectionId: result.selectionId,
        }
      );
    }
  }
  return selectionIdByPlaceholder;
}

function remapSessionConfigurationProposal(
  proposal: AdjustmentWorkspaceProposal,
  selectionIdByPlaceholder: Map<string, string>
): AdjustmentWorkspaceProposal {
  if (selectionIdByPlaceholder.size === 0) return proposal;
  const remapLine = (line: AdjustmentCompositionLine): AdjustmentCompositionLine => {
    const realSelectionId = selectionIdByPlaceholder.get(line.refId);
    if (!realSelectionId) return line;
    return {
      ...line,
      refId: realSelectionId,
      lineId:
        line.kind === "session_configuration"
          ? sessionConfigurationLineId(realSelectionId)
          : line.lineId,
    };
  };
  return {
    ...proposal,
    proposed: {
      ...proposal.proposed,
      lines: proposal.proposed.lines.map(remapLine),
      sessionConfigurationSelections:
        proposal.proposed.sessionConfigurationSelections?.map((selection) => {
          const realSelectionId = selectionIdByPlaceholder.get(selection.id);
          return realSelectionId ? { ...selection, id: realSelectionId } : selection;
        }),
    },
    deltas: proposal.deltas.map(remapLine),
  };
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
        create: input.proposal.deltas.map((line, index) => {
          const semantics = resolveAdjustmentInvoiceLineSemantics(line);
          return {
            lineType: semantics.lineType,
            description: line.label,
            quantity: Math.abs(line.quantity),
            unitPrice:
              new Prisma.Decimal(line.lineTotalNet).lessThan(0)
                ? new Prisma.Decimal(line.unitPrice).neg()
                : new Prisma.Decimal(line.unitPrice),
            lineTotal: new Prisma.Decimal(line.lineTotalNet),
            sortOrder: index,
            causeOrderEntityKind: semantics.causeOrderEntityKind,
            causeOrderEntityId: line.refId,
          };
        }),
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

function derivePOSPackageLine(
  line: POSPackageLine,
  proposedLines: AdjustmentCompositionLine[],
  packagesById: Map<
    string,
    {
      id: string;
      name: string;
      price: Prisma.Decimal;
      photoCount: number;
      bundleAdjustment: Prisma.Decimal;
      items: Array<{
        id: string;
        productId: string;
        quantity: number;
        priceSnapshot: Prisma.Decimal;
        product: { name: string; category: string };
      }>;
    }
  >
): POSPackageLine {
  const proposedPackageLine = proposedLines.find(
    (proposedLine) =>
      proposedLine.kind === "package" &&
      proposedLine.lineId === `package:${line.id}`
  );
  const packageRow = proposedPackageLine
    ? packagesById.get(proposedPackageLine.refId)
    : undefined;
  const currentPackage = packageRow
    ? mapDerivedPOSPackage(packageRow)
    : proposedPackageLine
      ? {
          ...line.currentPackage,
          id: proposedPackageLine.refId,
          name: proposedPackageLine.label,
          price: Number(proposedPackageLine.unitPrice),
          priceLabel: formatMoney(decimal(proposedPackageLine.unitPrice)),
        }
      : line.currentPackage;
  const includedPhotoCount = packageRow?.photoCount ?? line.includedPhotoCount;
  const extraDigitalCount = positiveLineQuantity(
    proposedLines.find(
      (proposedLine) =>
        proposedLine.lineId === extraPhotoLineId(line.id, MediaType.DIGITAL)
    )
  );
  const extraPrintCount = positiveLineQuantity(
    proposedLines.find(
      (proposedLine) =>
        proposedLine.lineId === extraPhotoLineId(line.id, MediaType.PRINT)
    )
  );
  const extraPhotoCount = extraDigitalCount + extraPrintCount;
  const extraPhotoTotal =
    extraDigitalCount * line.extraDigitalUnitPrice +
    extraPrintCount * line.extraPrintUnitPrice;
  const selectedPhotoCount = includedPhotoCount + extraPhotoCount;
  const packageItems = (packageRow
    ? packageRow.items.map(mapDerivedPOSPackageItem)
    : line.packageItems
  ).map((item) => derivePOSPackageItem(line.id, item, proposedLines));
  const upgradeDelta = currentPackage.price - line.originalPackage.price;

  return {
    ...line,
    currentPackage,
    packageItems,
    includedPhotoCount,
    selectedPhotoCount,
    extraDigitalCount,
    extraPrintCount,
    extraPhotoCount,
    extraPhotoTotal,
    packageSubtotal: currentPackage.price + extraPhotoTotal,
    upgradeDelta,
    upgradeDeltaLabel: formatSignedNumber(upgradeDelta),
    packageOptions: derivePOSPackageOptions(line.packageOptions, currentPackage),
  };
}

function derivePOSPackageItem(
  orderPackageId: string,
  item: POSPackageItem,
  proposedLines: AdjustmentCompositionLine[]
): POSPackageItem {
  const upgradeLine = proposedLines.find(
    (line) =>
      line.kind === "item" &&
      line.lineId === packageItemUpgradeLineId(orderPackageId, item.id)
  );
  if (!upgradeLine) return item;

  return {
    ...item,
    productId: upgradeLine.refId,
    productName: labelAfterUpgradePrefix(upgradeLine.label) ?? upgradeLine.label,
    quantity: Math.abs(upgradeLine.quantity),
    priceSnapshot: item.priceSnapshot + Number(upgradeLine.unitPrice),
    priceSnapshotLabel: formatMoney(
      new Prisma.Decimal(item.priceSnapshot).plus(upgradeLine.unitPrice)
    ),
  };
}

function derivePOSPackageOptions(
  options: POSPackageOption[],
  currentPackage: POSPackage
): POSPackageOption[] {
  return options.map((option) => {
    const upgradeDelta = option.price - currentPackage.price;
    return {
      ...option,
      isCurrentPackage: option.id === currentPackage.id,
      upgradeDelta,
      upgradeDeltaLabel: formatSignedNumber(upgradeDelta),
    };
  });
}

function derivePOSAddOns(proposedLines: AdjustmentCompositionLine[]): POSAddOn[] {
  return proposedLines
    .filter((line) => line.kind === "addon" && line.quantity > 0)
    .flatMap((line) => {
      const entries: POSAddOn[] = [];
      for (let index = 0; index < line.quantity; index += 1) {
        entries.push({
          id: line.quantity === 1 ? line.lineId : `${line.lineId}-${index + 1}`,
          addOnRowId: line.lineId,
          productId: line.refId,
          name: line.label,
          price: Number(line.unitPrice),
          priceLabel: formatMoney(decimal(line.unitPrice)),
        });
      }
      return entries;
    });
}

function mapDerivedPOSPackage(packageRow: {
  id: string;
  name: string;
  price: Prisma.Decimal;
  photoCount: number;
  bundleAdjustment: Prisma.Decimal;
}): POSPackage {
  return {
    id: packageRow.id,
    name: packageRow.name,
    price: packageRow.price.toNumber(),
    priceLabel: formatMoney(packageRow.price),
    photoCount: packageRow.photoCount,
    bundleAdjustment: packageRow.bundleAdjustment.toNumber(),
  };
}

function mapDerivedPOSPackageItem(row: {
  id: string;
  productId: string;
  quantity: number;
  priceSnapshot: Prisma.Decimal;
  product: { name: string; category: string };
}): POSPackageItem {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.product.name,
    category: row.product.category,
    quantity: row.quantity,
    priceSnapshot: row.priceSnapshot.toNumber(),
    priceSnapshotLabel: formatMoney(row.priceSnapshot),
  };
}

function positiveLineQuantity(
  line: AdjustmentCompositionLine | undefined
): number {
  return Math.max(line?.quantity ?? 0, 0);
}

function labelAfterUpgradePrefix(label: string): string | null {
  const separator = " to ";
  const index = label.lastIndexOf(separator);
  return index >= 0 ? label.slice(index + separator.length) : null;
}

function formatSignedNumber(value: number): string {
  const formatted = `${Math.abs(value).toFixed(3)} KD`;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
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
    sessionConfigurationSelections: snapshot.sessionConfigurationSelections?.map(
      (selection) => ({ ...selection })
    ),
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

function packageItemUpgradeLineId(orderPackageId: string, packageItemId: string): string {
  return `item:${orderPackageId}:${packageItemId}`;
}

function extraPhotoLineId(orderPackageId: string, mediaType: MediaType): string {
  return `extra-photo:${orderPackageId}:${mediaType.toLowerCase()}`;
}

function extraPhotoRef(packageName: string, mediaType: MediaType): string {
  return `${EXTRA_PHOTO_REF_PREFIX}${formatEnum(mediaType)} (${packageName})`;
}

function isExtraPhotoRef(refId: string): boolean {
  return refId.startsWith(EXTRA_PHOTO_REF_PREFIX);
}

function extraPhotoPriceKey(sessionTypeId: string, mediaType: MediaType): string {
  return `${sessionTypeId}:${mediaType}`;
}

async function getExtraPhotoPriceMap(
  client: DbClient,
  sessionTypeIds: string[]
): Promise<Map<string, Prisma.Decimal>> {
  const uniqueSessionTypeIds = [...new Set(sessionTypeIds)];
  if (uniqueSessionTypeIds.length === 0) return new Map();

  const rows = await client.sessionTypeExtraPhotoPricing.findMany({
    where: {
      sessionTypeId: { in: uniqueSessionTypeIds },
      mediaType: { in: [MediaType.DIGITAL, MediaType.PRINT] },
    },
    select: { sessionTypeId: true, mediaType: true, unitPrice: true },
  });

  return new Map(
    rows.map((row) => [
      extraPhotoPriceKey(row.sessionTypeId, row.mediaType),
      row.unitPrice,
    ])
  );
}

function findPackageItemUpgradeLine(
  lines: AdjustmentCompositionLine[],
  orderPackageId: string,
  packageItemId: string
): AdjustmentCompositionLine | undefined {
  return lines.find(
    (line) => line.kind === "item" && line.lineId === packageItemUpgradeLineId(orderPackageId, packageItemId)
  );
}

function resolveEffectivePackageId(
  edits: AdjustmentWorkspaceEdit[],
  orderPackageId: string,
  fallbackPackageId: string
): string {
  let effectivePackageId = fallbackPackageId;
  for (const edit of edits) {
    if (edit.op === "change_package_tier" && edit.orderPackageId === orderPackageId) {
      effectivePackageId = edit.toPackageRefId;
    }
  }
  return effectivePackageId;
}

function applySelectedPhotoCountChange(
  lines: AdjustmentCompositionLine[],
  edit: Extract<AdjustmentWorkspaceEdit, { op: "change_selected_photo_count" }>,
  catalog: CatalogLookup,
  orderPackages: NonNullable<CatalogLookup["orderPackages"]>
) {
  const context = orderPackages.get(edit.orderPackageId);
  if (!context) throw new Error("Package line is not available");

  const packageLine = lines.find(
    (line) => line.kind === "package" && line.lineId === `package:${edit.orderPackageId}`
  );
  const packageRow = packageLine ? catalog.packages.get(packageLine.refId) : undefined;
  const includedPhotoCount = packageRow?.photoCount ?? context.includedPhotoCount;
  const packageName = packageRow?.name ?? packageLine?.label ?? context.packageName;
  if (edit.selectedPhotoCount < includedPhotoCount) {
    throw new Error("Selected photos cannot be below included package photos");
  }

  const derivedExtraCount = Math.max(edit.selectedPhotoCount - includedPhotoCount, 0);
  // Mirrors updateOrderSelectedPhotoCount: explicit digital/print allocations must total derived extras.
  if (edit.extraDigitalCount + edit.extraPrintCount !== derivedExtraCount) {
    throw new Error(
      "Digital and print extra allocations must equal the derived extra-photo count."
    );
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.lineId.startsWith(`extra-photo:${edit.orderPackageId}:`)) {
      lines.splice(index, 1);
    }
  }

  if (edit.extraDigitalCount > 0) {
    lines.push(
      makeLine({
        lineId: extraPhotoLineId(edit.orderPackageId, MediaType.DIGITAL),
        kind: "item",
        refId: extraPhotoRef(packageName, MediaType.DIGITAL),
        label: extraPhotoRef(packageName, MediaType.DIGITAL),
        quantity: edit.extraDigitalCount,
        unitPrice: context.extraDigitalUnitPrice,
      })
    );
  }
  if (edit.extraPrintCount > 0) {
    lines.push(
      makeLine({
        lineId: extraPhotoLineId(edit.orderPackageId, MediaType.PRINT),
        kind: "item",
        refId: extraPhotoRef(packageName, MediaType.PRINT),
        label: extraPhotoRef(packageName, MediaType.PRINT),
        quantity: edit.extraPrintCount,
        unitPrice: context.extraPrintUnitPrice,
      })
    );
  }
}

function applySessionConfigurationSelectionChange(
  snapshot: AdjustmentBaseSnapshot,
  edit: Extract<
    AdjustmentWorkspaceEdit,
    { op: "change_session_configuration_selection" }
  >,
  catalog: CatalogLookup
): void {
  const orderPackage = catalog.orderPackages?.get(edit.orderPackageId);
  if (!orderPackage) throw new Error("Package line is not available");
  const configuration = catalog.sessionConfigurations?.get(edit.configurationId);
  if (!configuration || configuration.sessionTypeId !== orderPackage.sessionTypeId) {
    throw new Error("Session configuration is not available");
  }
  if (
    configuration.financialBehavior !==
    SessionConfigurationFinancialBehavior.FINANCIAL
  ) {
    throw new Error("Operational session configurations cannot be edited in the Adjustment Workspace");
  }

  const currentSelections = snapshot.sessionConfigurationSelections ?? [];
  const existing = currentSelections.find(
    (selection) =>
      selection.orderPackageId === edit.orderPackageId &&
      selection.configurationId === edit.configurationId
  );
  snapshot.sessionConfigurationSelections = currentSelections.filter(
    (selection) =>
      !(
        selection.orderPackageId === edit.orderPackageId &&
        selection.configurationId === edit.configurationId
      )
  );
  snapshot.lines = snapshot.lines.filter(
    (line) => !existing || line.lineId !== sessionConfigurationLineId(existing.id)
  );

  if (edit.desired === null) return;

  const selection = buildWorkspaceSessionConfigurationSelection({
    id: existing?.id ?? pendingSessionConfigurationSelectionId(edit.configurationId),
    orderPackageId: edit.orderPackageId,
    configuration,
    desired: edit.desired,
  });
  snapshot.sessionConfigurationSelections.push(selection);
  snapshot.lines.push(...linesForSessionConfigurationSelection(selection));
}

function buildWorkspaceSessionConfigurationSelection(input: {
  id: string;
  orderPackageId: string;
  configuration: NonNullable<CatalogLookup["sessionConfigurations"]> extends Map<
    string,
    infer Configuration
  >
    ? Configuration
    : never;
  desired: Exclude<WorkspaceSessionConfigurationDesired, null>;
}): AdjustmentSessionConfigurationSelection {
  assertWorkspaceDesiredMatchesConfiguration(input.desired, input.configuration);
  const option =
    "optionId" in input.desired && input.desired.optionId
      ? input.configuration.options.get(input.desired.optionId)
      : null;
  if (
    (input.desired.kind === "select" ||
      (input.desired.kind === "counter" &&
        input.configuration.pricingMode === SessionConfigurationPricingMode.TIERED)) &&
    !option
  ) {
    throw new Error("Session configuration option is not available");
  }
  const numericValue =
    "numericValue" in input.desired
      ? new Prisma.Decimal(input.desired.numericValue)
      : null;
  if (numericValue && (numericValue.lessThan(0) || !Number.isFinite(numericValue.toNumber()))) {
    throw new Error("Session configuration numeric value is invalid");
  }
  const textValue =
    input.desired.kind === "text" ? input.desired.textValue.trim() : null;
  if (input.desired.kind === "text" && (!textValue || textValue.length > 500)) {
    throw new Error("Session configuration text value is invalid");
  }

  return {
    id: input.id,
    orderPackageId: input.orderPackageId,
    configurationId: input.configuration.id,
    optionId: option?.id ?? null,
    numericValue: numericValue?.toString() ?? null,
    textValue,
    snapshotConfigurationCode: input.configuration.code,
    snapshotLabel: input.configuration.name,
    snapshotPriceDelta: resolveWorkspaceSnapshotPriceDelta(
      input.configuration,
      option ?? null,
      numericValue
    ).toFixed(3),
    snapshotFinancialBehavior: input.configuration.financialBehavior,
    snapshotInputType: input.configuration.inputType,
    snapshotPricingMode: input.configuration.pricingMode,
    snapshotLinkedProductId:
      input.configuration.pricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT
        ? input.configuration.linkedProductId
        : null,
    snapshotLinkProductDisplay:
      input.configuration.pricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT
        ? input.configuration.linkProductDisplay
        : null,
  };
}

function assertWorkspaceDesiredMatchesConfiguration(
  desired: Exclude<WorkspaceSessionConfigurationDesired, null>,
  configuration: NonNullable<CatalogLookup["sessionConfigurations"]> extends Map<
    string,
    infer Configuration
  >
    ? Configuration
    : never
): void {
  const expectedKindByInputType = {
    [SessionConfigurationInputType.TOGGLE]: "toggle",
    [SessionConfigurationInputType.SELECT]: "select",
    [SessionConfigurationInputType.NUMBER]: "number",
    [SessionConfigurationInputType.TEXT]: "text",
    [SessionConfigurationInputType.COUNTER]: "counter",
  } satisfies Record<SessionConfigurationInputType, Exclude<WorkspaceSessionConfigurationDesired, null>["kind"]>;
  if (desired.kind !== expectedKindByInputType[configuration.inputType]) {
    throw new Error("Session configuration input does not match its definition");
  }
}

function resolveWorkspaceSnapshotPriceDelta(
  configuration: NonNullable<CatalogLookup["sessionConfigurations"]> extends Map<
    string,
    infer Configuration
  >
    ? Configuration
    : never,
  option: { id: string; label: string; priceDelta: Prisma.Decimal } | null,
  numericValue: Prisma.Decimal | null
): Prisma.Decimal {
  switch (configuration.pricingMode) {
    case SessionConfigurationPricingMode.NONE:
      return moneyZero;
    case SessionConfigurationPricingMode.FIXED:
      if (configuration.inputType === SessionConfigurationInputType.COUNTER) {
        if (
          configuration.counterPricingMode ===
          SessionConfigurationCounterPricingMode.PER_UNIT
        ) {
          return (configuration.counterUnitPrice ?? configuration.fixedPriceDelta ?? moneyZero).mul(
            numericValue ?? moneyZero
          );
        }
      }
      return configuration.fixedPriceDelta ?? moneyZero;
    case SessionConfigurationPricingMode.TIERED:
      if (!option) throw new Error("Session configuration option is not available");
      return option.priceDelta;
    case SessionConfigurationPricingMode.LINKED_PRODUCT:
      if (!configuration.linkedProductPrice) {
        throw new Error("Linked product price is not available");
      }
      return configuration.linkedProductPrice;
  }
}

function linesForSessionConfigurationSelection(
  selection: AdjustmentSessionConfigurationSelection
): AdjustmentCompositionLine[] {
  const priced = priceSelections([pricedSelectionFromAdjustmentSelection(selection)]);
  const lineItems = priced.lineItems.map((lineItem) =>
    makeLine({
      lineId: sessionConfigurationLineId(selection.id),
      kind: "session_configuration",
      refId: selection.id,
      label: lineItem.description,
      quantity: lineItem.quantity,
      unitPrice: lineItem.unitPrice,
    })
  );
  if (lineItems.length > 0) return lineItems;
  if (priced.nonLineDelta.equals(0)) return [];
  return [
    makeLine({
      lineId: sessionConfigurationLineId(selection.id),
      kind: "session_configuration",
      refId: selection.id,
      label: selection.snapshotLabel,
      quantity: 1,
      unitPrice: priced.nonLineDelta,
    }),
  ];
}

function pricedSelectionFromAdjustmentSelection(
  selection: AdjustmentSessionConfigurationSelection
): PricedSelection {
  return {
    id: selection.id,
    snapshotConfigurationCode: selection.snapshotConfigurationCode,
    snapshotLabel: selection.snapshotLabel,
    snapshotPriceDelta: decimal(selection.snapshotPriceDelta),
    snapshotPricingMode: selection.snapshotPricingMode,
    snapshotInputType: selection.snapshotInputType,
    snapshotLinkProductDisplay: selection.snapshotLinkProductDisplay,
    snapshotLinkedProductId: selection.snapshotLinkedProductId,
    numericValue: selection.numericValue ? decimal(selection.numericValue) : null,
  };
}

function sessionConfigurationLineId(selectionId: string): string {
  return `session-config:${selectionId}`;
}

function pendingSessionConfigurationSelectionId(configurationId: string): string {
  return `pending:${configurationId}`;
}

function isExtraPhotoLine(line: AdjustmentCompositionLine): boolean {
  // The refId fallback covers existing extraPhotoRef-generated ADJ lines.
  return line.lineId.startsWith("extra-photo:") || isExtraPhotoRef(line.refId);
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
    if (edit.op === "upgrade_package_item") return [edit.toProductId];
    return [];
  });
}

function collectPackageIds(edits: AdjustmentWorkspaceEdit[]): string[] {
  return edits.flatMap((edit) => {
    if (edit.op === "swap_package" || edit.op === "change_package_tier") {
      return [edit.toPackageRefId];
    }
    return [];
  });
}

function collectPackageItemIds(edits: AdjustmentWorkspaceEdit[]): string[] {
  return edits.flatMap((edit) =>
    edit.op === "upgrade_package_item" ? [edit.packageItemId] : []
  );
}

function collectSessionConfigurationIds(edits: AdjustmentWorkspaceEdit[]): string[] {
  return [
    ...new Set(
      edits.flatMap((edit) =>
        edit.op === "change_session_configuration_selection"
          ? [edit.configurationId]
          : []
      )
    ),
  ];
}

function collectOrderPackageIds(edits: AdjustmentWorkspaceEdit[]): string[] {
  return [
    ...new Set(
      edits.flatMap((edit) => {
        if (
          edit.op === "upgrade_package_item" ||
          edit.op === "change_selected_photo_count" ||
          edit.op === "change_package_tier" ||
          edit.op === "change_session_configuration_selection"
        ) {
          return [edit.orderPackageId];
        }
        return [];
      })
    ),
  ];
}

function collectBasePackageRefs(
  baseSnapshot: AdjustmentBaseSnapshot,
  orderPackageIds: string[]
): string[] {
  if (orderPackageIds.length === 0) return [];
  const orderPackageIdSet = new Set(orderPackageIds);
  return baseSnapshot.lines.flatMap((line) =>
    line.kind === "package" &&
    line.lineId.startsWith("package:") &&
    orderPackageIdSet.has(line.lineId.slice("package:".length))
      ? [line.refId]
      : []
  );
}

function eventTypeForEdit(edit: AdjustmentWorkspaceEdit): AdjustmentWorkspaceEventType {
  if (edit.op === "swap_package") return AdjustmentWorkspaceEventType.PACKAGE_SWAPPED;
  return AdjustmentWorkspaceEventType.EDIT_ADDED;
}

function kindFromInvoiceLine(
  lineType: InvoiceLineType,
  causeKind: OrderEntityKind | null
): AdjustmentLineKind {
  if (causeKind === OrderEntityKind.EXTRA_PHOTO) return "item";
  if (causeKind === OrderEntityKind.ADDON) return "addon";
  if (causeKind === OrderEntityKind.UPGRADE) return "item";
  if (causeKind === OrderEntityKind.SESSION_CONFIGURATION_SELECTION) {
    return "session_configuration";
  }
  if (lineType === InvoiceLineType.PACKAGE_BASE || causeKind === OrderEntityKind.PACKAGE_TIER_UPGRADE) {
    return "package";
  }
  if (lineType === InvoiceLineType.ADD_ON) return "addon";
  return "item";
}

export function resolveAdjustmentInvoiceLineSemantics(
  line: AdjustmentCompositionLine
): { lineType: InvoiceLineType; causeOrderEntityKind: OrderEntityKind } {
  if (line.kind === "session_configuration") {
    return {
      lineType: InvoiceLineType.SESSION_CONFIGURATION,
      causeOrderEntityKind: OrderEntityKind.SESSION_CONFIGURATION_SELECTION,
    };
  }
  if (isExtraPhotoLine(line)) {
    return {
      lineType: InvoiceLineType.BUNDLE_ADJUSTMENT,
      causeOrderEntityKind: OrderEntityKind.EXTRA_PHOTO,
    };
  }
  if (line.kind === "package") {
    return {
      lineType: InvoiceLineType.PACKAGE_UPGRADE,
      causeOrderEntityKind: OrderEntityKind.PACKAGE_TIER_UPGRADE,
    };
  }
  if (line.kind === "addon") {
    return {
      lineType: InvoiceLineType.ADD_ON,
      causeOrderEntityKind: OrderEntityKind.ADDON,
    };
  }
  return {
    lineType: InvoiceLineType.PACKAGE_UPGRADE,
    causeOrderEntityKind: OrderEntityKind.UPGRADE,
  };
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
