import {
  AuditAction,
  AuditEntityType,
  InvoiceType,
  Prisma,
  SessionConfigurationCounterPricingMode,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
  type SessionConfiguration,
  type SessionConfigurationOption,
  type Product,
} from "@prisma/client";
import type { CurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS, requirePermission } from "@/lib/permissions";
import { withRetry } from "@/lib/retry";
import { recordAuditLog } from "@/modules/audit/audit-log.service";
import type { SessionConfigurationRequiredSelectionMissingError } from "./session-configuration-resolver";
import type { SelectionInput } from "./session-configuration-selection.schema";

export type SessionConfigurationActor = Pick<CurrentAppUser, "id" | "role">;

type LiveConfiguration = SessionConfiguration & {
  linkedProduct: Pick<Product, "id" | "name" | "canonicalPrice"> | null;
  options: SessionConfigurationOption[];
};

type SelectionSnapshot = {
  configurationId: string;
  optionId: string | null;
  numericValue: Prisma.Decimal | null;
  textValue: string | null;
  snapshotOptionLabel: string | null;
  snapshotConfigurationCode: string;
  snapshotLabel: string;
  snapshotPriceDelta: Prisma.Decimal;
  snapshotFinancialBehavior: LiveConfiguration["financialBehavior"];
  snapshotInputType: LiveConfiguration["inputType"];
  snapshotPricingMode: LiveConfiguration["pricingMode"];
  snapshotLinkedProductId: string | null;
  orderAddOnId: string | null;
};

const existingSelectionSelect = {
  id: true,
  configurationId: true,
  optionId: true,
  numericValue: true,
  textValue: true,
  snapshotOptionLabel: true,
  snapshotConfigurationCode: true,
  snapshotLabel: true,
  snapshotPriceDelta: true,
  snapshotFinancialBehavior: true,
  snapshotInputType: true,
  snapshotPricingMode: true,
  snapshotLinkedProductId: true,
  orderAddOnId: true,
} satisfies Prisma.OrderPackageSessionConfigurationSelectionSelect;

type ExistingSelection = Prisma.OrderPackageSessionConfigurationSelectionGetPayload<{
  select: typeof existingSelectionSelect;
}>;

type SelectionSnapshotData = ReturnType<typeof snapshotData>;

export type WorkspaceSessionConfigurationDesired =
  | null
  | { kind: "toggle" }
  | { kind: "select"; optionId: string }
  | { kind: "number"; numericValue: number }
  | { kind: "text"; textValue: string }
  | { kind: "counter"; numericValue: number; optionId?: string };

export class SessionConfigurationSelectionLockedError extends Error {
  constructor() {
    super("Order session configurations are locked.");
    this.name = "SessionConfigurationSelectionLockedError";
  }
}

export class SessionConfigurationSelectionPostLockMisuseError extends Error {
  constructor() {
    super("Post-lock session configuration writes require a locked final invoice.");
    this.name = "SessionConfigurationSelectionPostLockMisuseError";
  }
}

export class SessionConfigurationSelectionFinancialNotAllowedError extends Error {
  offendingConfigurationCodes: string[];

  constructor(offendingConfigurationCodes: string[]) {
    super(
      `Financial session configuration edits must use the Adjustment Workspace: ${offendingConfigurationCodes.join(", ")}`
    );
    this.name = "SessionConfigurationSelectionFinancialNotAllowedError";
    this.offendingConfigurationCodes = offendingConfigurationCodes;
  }
}

export class SessionConfigurationSelectionConfigurationNotFoundError extends Error {
  configurationId?: string;

  constructor(configurationId?: string) {
    super("Session configuration is not available for this package.");
    this.name = "SessionConfigurationSelectionConfigurationNotFoundError";
    this.configurationId = configurationId;
  }
}

export class SessionConfigurationSelectionOptionMismatchError extends Error {
  constructor() {
    super("Selected option does not belong to this configuration.");
    this.name = "SessionConfigurationSelectionOptionMismatchError";
  }
}

export class SessionConfigurationSelectionInputMismatchError extends Error {
  constructor() {
    super("Selected value does not match the configuration input type.");
    this.name = "SessionConfigurationSelectionInputMismatchError";
  }
}

export type ConfigureSessionRoute = {
  locked: boolean;
  financialConfigurationIds: Set<string>;
  operationalConfigurationIds: Set<string>;
  configurationNameById: Map<string, string>;
};

export async function resolveConfigureSessionRoute(
  orderId: string,
  orderPackageId: string,
  configurationIds: string[]
): Promise<ConfigureSessionRoute> {
  const orderPackage = await db.orderPackage.findUnique({
    where: { id: orderPackageId },
    select: {
      orderId: true,
      sessionTypeId: true,
      order: {
        select: {
          invoices: {
            where: {
              parentInvoiceId: null,
              invoiceType: InvoiceType.FINAL,
            },
            select: { isLocked: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!orderPackage || orderPackage.orderId !== orderId) {
    throw new SessionConfigurationSelectionConfigurationNotFoundError();
  }

  const configurations = await db.sessionConfiguration.findMany({
    where: {
      id: { in: [...new Set(configurationIds)] },
      sessionTypeId: orderPackage.sessionTypeId,
      isActive: true,
    },
    select: { id: true, name: true, financialBehavior: true },
  });
  const financialConfigurationIds = new Set(
    configurations
      .filter((configuration) => configuration.financialBehavior === "FINANCIAL")
      .map((configuration) => configuration.id)
  );
  const operationalConfigurationIds = new Set(
    configurations
      .filter((configuration) => configuration.financialBehavior === "OPERATIONAL")
      .map((configuration) => configuration.id)
  );
  const configurationNameById = new Map(
    configurations.map((configuration) => [configuration.id, configuration.name])
  );

  return {
    locked: orderPackage.order.invoices[0]?.isLocked === true,
    financialConfigurationIds,
    operationalConfigurationIds,
    configurationNameById,
  };
}

export async function formatMissingSessionConfigurationMessage(
  errorOrDetails:
    | SessionConfigurationRequiredSelectionMissingError
    | SessionConfigurationRequiredSelectionMissingError["details"]
): Promise<string> {
  const details = Array.isArray(errorOrDetails)
    ? errorOrDetails
    : errorOrDetails.details;
  const missingCodes = [
    ...new Set(details.flatMap((detail) => detail.missingConfigurationCodes)),
  ];
  const configurations = await db.sessionConfiguration.findMany({
    where: { code: { in: missingCodes } },
    select: { code: true, name: true },
  });
  const nameByCode = new Map(
    configurations.map((configuration) => [
      configuration.code,
      configuration.name,
    ])
  );
  const packageIds = details.map((detail) => detail.orderPackageId);
  const packages = await db.orderPackage.findMany({
    where: { id: { in: packageIds } },
    select: {
      id: true,
      package: { select: { name: true } },
    },
  });
  const packageNameById = new Map(
    packages.map((orderPackage) => [orderPackage.id, orderPackage.package.name])
  );
  const missingLabels = details.map((detail) => {
    const names = detail.missingConfigurationCodes.map(
      (code) => nameByCode.get(code) ?? code
    );
    const packageName = packageNameById.get(detail.orderPackageId);
    return packageName ? `${names.join(", ")} (${packageName})` : names.join(", ");
  });

  return `Configure the missing session settings before generating the invoice: ${missingLabels.join("; ")}.`;
}

export async function writeOrderPackageSelections(
  orderPackageId: string,
  desiredSelections: SelectionInput[],
  actor: SessionConfigurationActor,
  options: { allowPostLock?: boolean; postLockAudit?: { actorUserId: string } } = {}
): Promise<{ orderPackageId: string; writtenSelectionIds: string[] }> {
  requirePermission(actor, PERMISSIONS.ORDER_FINANCIAL_UPDATE);

  return withRetry(
    () =>
      db.$transaction(
        async (tx) => {
          const orderPackage = await tx.orderPackage.findUnique({
            where: { id: orderPackageId },
            select: {
              id: true,
              orderId: true,
              sessionTypeId: true,
              order: {
                select: {
                  invoices: {
                    where: {
                      parentInvoiceId: null,
                      invoiceType: InvoiceType.FINAL,
                    },
                    select: { isLocked: true },
                    orderBy: { createdAt: "asc" },
                    take: 1,
                  },
                },
              },
            },
          });
          if (!orderPackage) {
            throw new SessionConfigurationSelectionConfigurationNotFoundError();
          }

          const finalInvoice = orderPackage.order.invoices[0] ?? null;
          if (finalInvoice?.isLocked && options.allowPostLock !== true) {
            console.info(
              JSON.stringify({
                metric: "pos.session_configuration_selections.locked_block",
                orderPackageId,
              })
            );
            throw new SessionConfigurationSelectionLockedError();
          }
          if (options.allowPostLock === true && finalInvoice?.isLocked !== true) {
            throw new SessionConfigurationSelectionPostLockMisuseError();
          }
          if (options.allowPostLock === true && !options.postLockAudit?.actorUserId) {
            throw new SessionConfigurationSelectionPostLockMisuseError();
          }

          const liveConfigurations = await tx.sessionConfiguration.findMany({
            where: {
              sessionTypeId: orderPackage.sessionTypeId,
              isActive: true,
            },
            include: {
              linkedProduct: {
                select: { id: true, name: true, canonicalPrice: true },
              },
              options: {
                where: { isActive: true },
                orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
              },
            },
          });
          const configurationById = new Map(
            liveConfigurations.map((configuration) => [
              configuration.id,
              configuration,
            ])
          );

          const snapshots = desiredSelections.map((selection) =>
            buildSelectionSnapshot(selection, configurationById)
          );
          assertUniqueConfigurations(snapshots);

          const existingSelections =
            await tx.orderPackageSessionConfigurationSelection.findMany({
              where: { orderPackageId },
              select: existingSelectionSelect,
            });
          const existingByConfigurationId = new Map(
            existingSelections.map((selection) => [
              selection.configurationId,
              selection,
            ])
          );
          const desiredConfigurationIds = new Set(
            snapshots.map((snapshot) => snapshot.configurationId)
          );

          if (options.allowPostLock === true) {
            assertPostLockOperationalOnly({
              snapshots,
              existingSelections,
              existingByConfigurationId,
            });
          }

          const writtenSelectionIds: string[] = [];
          const auditEntries: {
            entityId: string;
            before: ReturnType<typeof auditPayloadFromExistingSelection> | null;
            after: ReturnType<typeof auditPayloadFromSelectionSnapshot> | null;
          }[] = [];
          for (const snapshot of snapshots) {
            const existing = existingByConfigurationId.get(snapshot.configurationId);
            const data = snapshotData(snapshot, {
              orderAddOnId: existing?.orderAddOnId ?? null,
              preserveLinkedProductPrice: Boolean(existing),
            });
            if (existing) {
              if (selectionPayloadMatches(existing, data)) {
                continue;
              }
              const updated = await updateSelectionRow(tx, existing.id, data);
              writtenSelectionIds.push(updated.id);
              if (options.allowPostLock === true) {
                auditEntries.push({
                  entityId: updated.id,
                  before: auditPayloadFromExistingSelection(existing),
                  after: auditPayloadFromSelectionSnapshot({
                    ...snapshot,
                    orderAddOnId: existing.orderAddOnId,
                  }),
                });
              }
              continue;
            }

            const orderAddOnId =
              snapshot.snapshotPricingMode ===
              SessionConfigurationPricingMode.LINKED_PRODUCT
                ? await createLinkedProductAddOn(tx, {
                    orderId: orderPackage.orderId,
                    orderPackageId,
                    snapshot,
                    configurationById,
                  })
                : null;
            const created = await createSelectionRow(
              tx,
              orderPackageId,
              snapshotData(snapshot, { orderAddOnId })
            );
            writtenSelectionIds.push(created.id);
            if (options.allowPostLock === true) {
              auditEntries.push({
                entityId: created.id,
                before: null,
                after: auditPayloadFromSelectionSnapshot({
                  ...snapshot,
                  orderAddOnId,
                }),
              });
            }
          }

          const removedSelections = existingSelections.filter(
            (selection) =>
              !desiredConfigurationIds.has(selection.configurationId) &&
              (options.allowPostLock !== true ||
                selection.snapshotFinancialBehavior ===
                  SessionConfigurationFinancialBehavior.OPERATIONAL)
          );
          const removedIds = removedSelections.map((selection) => selection.id);
          if (removedIds.length > 0) {
            if (options.allowPostLock === true) {
              for (const selection of removedSelections) {
                auditEntries.push({
                  entityId: selection.id,
                  before: auditPayloadFromExistingSelection(selection),
                  after: null,
                });
              }
            }
            await deleteSelectionRows(tx, removedIds);
            await deleteSelectionOwnedAddOns(
              tx,
              removedSelections
                .map((selection) => selection.orderAddOnId)
                .filter((id): id is string => Boolean(id))
            );
          }

          if (options.allowPostLock === true) {
            for (const entry of auditEntries) {
              await recordAuditLog(
                tx,
                {
                  actorUserId: options.postLockAudit?.actorUserId ?? actor.id,
                  actorRole: actor.role,
                },
                {
                  entityType:
                    AuditEntityType.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
                  entityId: entry.entityId,
                  action: AuditAction.ORDER_LOCKED_FIELD_MUTATED,
                  before: entry.before,
                  after: entry.after,
                  context: {
                    orderId: await orderIdForPackage(tx, orderPackageId),
                    orderPackageId,
                    actorUserId: options.postLockAudit?.actorUserId ?? actor.id,
                    source: "post_lock_direct",
                  },
                }
              );
            }
            if (auditEntries.length > 0) {
              console.info(
                JSON.stringify({
                  metric:
                    "pos.session_configuration_selections.post_lock_direct_edit",
                  orderPackageId,
                  count: auditEntries.length,
                })
              );
            }
          }

          console.info(
            JSON.stringify({
              metric: "pos.session_configuration_selections.written",
              orderPackageId,
              count: writtenSelectionIds.length,
            })
          );

          return { orderPackageId, writtenSelectionIds };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      ),
    "Failed to write session configuration selections",
    3,
    isSerializableWriteConflict
  );
}

export async function applySessionConfigurationEditFromWorkspace(
  tx: Prisma.TransactionClient,
  input: {
    orderPackageId: string;
    configurationId: string;
    desired: WorkspaceSessionConfigurationDesired;
    audit: { actorUserId: string };
  }
): Promise<{
  selectionId: string | null;
  orderAddOnId: string | null;
  financialBehavior: SessionConfigurationFinancialBehavior;
}> {
  const orderPackage = await tx.orderPackage.findUnique({
    where: { id: input.orderPackageId },
    select: { id: true, sessionTypeId: true, orderId: true },
  });
  if (!orderPackage) {
    throw new SessionConfigurationSelectionConfigurationNotFoundError();
  }

  const liveConfigurations = await tx.sessionConfiguration.findMany({
    where: {
      id: input.configurationId,
      sessionTypeId: orderPackage.sessionTypeId,
      isActive: true,
    },
    include: {
      linkedProduct: {
        select: { id: true, name: true, canonicalPrice: true },
      },
      options: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      },
    },
  });
  const configuration = liveConfigurations[0];
  if (!configuration) {
    throw new SessionConfigurationSelectionConfigurationNotFoundError(
      input.configurationId
    );
  }
  const isOperational =
    configuration.financialBehavior ===
    SessionConfigurationFinancialBehavior.OPERATIONAL;

  if (input.desired === null) {
    const existing = await tx.orderPackageSessionConfigurationSelection.findUnique({
      where: {
        orderPackageId_configurationId: {
          orderPackageId: input.orderPackageId,
          configurationId: input.configurationId,
        },
      },
      select: existingSelectionSelect,
    });
    if (!existing) {
      return {
        selectionId: null,
        orderAddOnId: null,
        financialBehavior: configuration.financialBehavior,
      };
    }
    await deleteSelectionRow(tx, existing.id);
    await deleteSelectionOwnedAddOns(
      tx,
      existing.orderAddOnId ? [existing.orderAddOnId] : []
    );
    if (isOperational) {
      await recordWorkspaceOperationalAudit(tx, {
        actorUserId: input.audit.actorUserId,
        orderId: orderPackage.orderId,
        orderPackageId: input.orderPackageId,
        entityId: existing.id,
        before: auditPayloadFromExistingSelection(existing),
        after: null,
      });
    }
    return {
      selectionId: existing.id,
      orderAddOnId: existing.orderAddOnId,
      financialBehavior: configuration.financialBehavior,
    };
  }

  const snapshot = buildSelectionSnapshot(
    { configurationId: input.configurationId, ...input.desired },
    new Map(liveConfigurations.map((row) => [row.id, row]))
  );
  const existing = await tx.orderPackageSessionConfigurationSelection.findUnique({
    where: {
      orderPackageId_configurationId: {
        orderPackageId: input.orderPackageId,
        configurationId: input.configurationId,
      },
    },
    select: existingSelectionSelect,
  });
  if (existing) {
    const updated = await updateSelectionRow(
      tx,
      existing.id,
      snapshotData(snapshot, {
        orderAddOnId: existing.orderAddOnId,
        preserveLinkedProductPrice: true,
      })
    );
    if (isOperational) {
      await recordWorkspaceOperationalAudit(tx, {
        actorUserId: input.audit.actorUserId,
        orderId: orderPackage.orderId,
        orderPackageId: input.orderPackageId,
        entityId: updated.id,
        before: auditPayloadFromExistingSelection(existing),
        after: auditPayloadFromSelectionSnapshot({
          ...snapshot,
          orderAddOnId: existing.orderAddOnId,
        }),
      });
    }
    return {
      selectionId: updated.id,
      orderAddOnId: existing.orderAddOnId,
      financialBehavior: configuration.financialBehavior,
    };
  }

  const orderAddOnId =
    snapshot.snapshotPricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT
      ? await createLinkedProductAddOn(tx, {
          orderId: orderPackage.orderId,
          orderPackageId: input.orderPackageId,
          snapshot,
          configurationById: new Map(liveConfigurations.map((row) => [row.id, row])),
        })
      : null;
  const created = await createSelectionRow(
    tx,
    input.orderPackageId,
    snapshotData(snapshot, { orderAddOnId })
  );
  if (isOperational) {
    await recordWorkspaceOperationalAudit(tx, {
      actorUserId: input.audit.actorUserId,
      orderId: orderPackage.orderId,
      orderPackageId: input.orderPackageId,
      entityId: created.id,
      before: null,
      after: auditPayloadFromSelectionSnapshot({
        ...snapshot,
        orderAddOnId,
      }),
    });
  }
  return {
    selectionId: created.id,
    orderAddOnId,
    financialBehavior: configuration.financialBehavior,
  };
}

export async function deleteAllSessionConfigurationSelectionsForReset(
  tx: Prisma.TransactionClient
): Promise<void> {
  const ownedAddOns = await tx.orderPackageSessionConfigurationSelection.findMany({
    where: { orderAddOnId: { not: null } },
    select: { orderAddOnId: true },
  });
  const ownedAddOnIds = ownedAddOns
    .map((selection) => selection.orderAddOnId)
    .filter((id): id is string => Boolean(id));
  await tx.orderPackageSessionConfigurationSelection.deleteMany({});
  await deleteSelectionOwnedAddOns(tx, ownedAddOnIds);
}

async function recordWorkspaceOperationalAudit(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    orderId: string;
    orderPackageId: string;
    entityId: string;
    before: ReturnType<typeof auditPayloadFromExistingSelection> | null;
    after: ReturnType<typeof auditPayloadFromSelectionSnapshot> | null;
  }
) {
  const auditActor = await tx.user.findUnique({
    where: { id: input.actorUserId },
    select: { id: true, role: true },
  });
  if (!auditActor) throw new Error("Workspace audit actor was not found");
  await recordAuditLog(
    tx,
    { actorUserId: auditActor.id, actorRole: auditActor.role },
    {
      entityType: AuditEntityType.ORDER_PACKAGE_SESSION_CONFIGURATION_SELECTION,
      entityId: input.entityId,
      action: AuditAction.ORDER_LOCKED_FIELD_MUTATED,
      before: input.before,
      after: input.after,
      context: {
        orderId: input.orderId,
        orderPackageId: input.orderPackageId,
        actorUserId: input.actorUserId,
        source: "post_lock_workspace",
      },
    }
  );
}

function buildSelectionSnapshot(
  selection: SelectionInput,
  configurationById: Map<string, LiveConfiguration>
): SelectionSnapshot {
  const configuration = configurationById.get(selection.configurationId);
  if (!configuration) {
    throw new SessionConfigurationSelectionConfigurationNotFoundError();
  }

  assertInputTypeMatches(selection, configuration);
  const option =
    "optionId" in selection && selection.optionId
      ? findActiveOption(configuration, selection.optionId)
      : null;
  if (requiresOption(selection, configuration) && !option) {
    throw new SessionConfigurationSelectionOptionMismatchError();
  }

  const numericValue =
    "numericValue" in selection
      ? decimalFromFiniteNonNegative(selection.numericValue)
      : null;
  const textValue =
    selection.kind === "text" ? assertTextValue(selection.textValue) : null;

  return {
    configurationId: configuration.id,
    optionId: option?.id ?? null,
    numericValue,
    textValue,
    snapshotOptionLabel:
      selection.kind === "select" ||
      (selection.kind === "counter" &&
        configuration.pricingMode === SessionConfigurationPricingMode.TIERED)
        ? option?.label ?? null
        : null,
    snapshotConfigurationCode: configuration.code,
    snapshotLabel: configuration.name,
    snapshotPriceDelta: resolveSnapshotPriceDelta(
      configuration,
      option,
      numericValue
    ),
    snapshotFinancialBehavior: configuration.financialBehavior,
    snapshotInputType: configuration.inputType,
    snapshotPricingMode: configuration.pricingMode,
    snapshotLinkedProductId:
      configuration.pricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT
        ? configuration.linkedProductId
        : null,
    orderAddOnId: null,
  };
}

function assertPostLockOperationalOnly(input: {
  snapshots: SelectionSnapshot[];
  existingSelections: ExistingSelection[];
  existingByConfigurationId: Map<string, ExistingSelection>;
}): void {
  const offendingCodes = new Set<string>();

  for (const snapshot of input.snapshots) {
    const existing = input.existingByConfigurationId.get(snapshot.configurationId);
    if (!existing) {
      if (!isOperationalOnlySnapshot(snapshot)) {
        offendingCodes.add(snapshot.snapshotConfigurationCode);
      }
      continue;
    }

    if (
      !isOperationalOnlyExistingSelection(existing) ||
      !isOperationalOnlySnapshot(snapshot)
    ) {
      offendingCodes.add(
        existing.snapshotConfigurationCode || snapshot.snapshotConfigurationCode
      );
    }
  }

  if (offendingCodes.size > 0) {
    console.info(
      JSON.stringify({
        metric: "pos.session_configuration_selections.post_lock_financial_block",
        count: offendingCodes.size,
      })
    );
    throw new SessionConfigurationSelectionFinancialNotAllowedError([
      ...offendingCodes,
    ]);
  }
}

function isOperationalOnlySnapshot(snapshot: SelectionSnapshot): boolean {
  return (
    snapshot.snapshotFinancialBehavior ===
      SessionConfigurationFinancialBehavior.OPERATIONAL &&
    snapshot.snapshotPricingMode !== SessionConfigurationPricingMode.LINKED_PRODUCT &&
    !snapshot.snapshotLinkedProductId &&
    !snapshot.orderAddOnId
  );
}

function isOperationalOnlyExistingSelection(selection: ExistingSelection): boolean {
  return (
    selection.snapshotFinancialBehavior ===
      SessionConfigurationFinancialBehavior.OPERATIONAL &&
    selection.snapshotPricingMode !== SessionConfigurationPricingMode.LINKED_PRODUCT &&
    !selection.snapshotLinkedProductId &&
    !selection.orderAddOnId
  );
}

function auditPayloadFromExistingSelection(selection: ExistingSelection) {
  return {
    configurationId: selection.configurationId,
    snapshotConfigurationCode: selection.snapshotConfigurationCode,
    snapshotLabel: selection.snapshotLabel,
    snapshotOptionLabel: selection.snapshotOptionLabel,
    snapshotPriceDelta: selection.snapshotPriceDelta.toString(),
    snapshotFinancialBehavior: selection.snapshotFinancialBehavior,
    snapshotInputType: selection.snapshotInputType,
    snapshotPricingMode: selection.snapshotPricingMode,
    snapshotLinkedProductId: selection.snapshotLinkedProductId,
    orderAddOnId: selection.orderAddOnId,
    optionId: selection.optionId,
    numericValue: selection.numericValue?.toString() ?? null,
    textValue: selection.textValue,
  };
}

function auditPayloadFromSelectionSnapshot(snapshot: SelectionSnapshot) {
  return {
    configurationId: snapshot.configurationId,
    snapshotConfigurationCode: snapshot.snapshotConfigurationCode,
    snapshotLabel: snapshot.snapshotLabel,
    snapshotOptionLabel: snapshot.snapshotOptionLabel,
    snapshotPriceDelta: snapshot.snapshotPriceDelta.toString(),
    snapshotFinancialBehavior: snapshot.snapshotFinancialBehavior,
    snapshotInputType: snapshot.snapshotInputType,
    snapshotPricingMode: snapshot.snapshotPricingMode,
    snapshotLinkedProductId: snapshot.snapshotLinkedProductId,
    orderAddOnId: snapshot.orderAddOnId,
    optionId: snapshot.optionId,
    numericValue: snapshot.numericValue?.toString() ?? null,
    textValue: snapshot.textValue,
  };
}

async function orderIdForPackage(
  tx: Prisma.TransactionClient,
  orderPackageId: string
): Promise<string> {
  const orderPackage = await tx.orderPackage.findUnique({
    where: { id: orderPackageId },
    select: { orderId: true },
  });
  return orderPackage?.orderId ?? "";
}

function assertInputTypeMatches(
  selection: SelectionInput,
  configuration: LiveConfiguration
): void {
  const expectedKindByInputType = {
    [SessionConfigurationInputType.TOGGLE]: "toggle",
    [SessionConfigurationInputType.SELECT]: "select",
    [SessionConfigurationInputType.NUMBER]: "number",
    [SessionConfigurationInputType.TEXT]: "text",
    [SessionConfigurationInputType.COUNTER]: "counter",
  } satisfies Record<SessionConfigurationInputType, SelectionInput["kind"]>;

  if (selection.kind !== expectedKindByInputType[configuration.inputType]) {
    throw new SessionConfigurationSelectionInputMismatchError();
  }
}

function requiresOption(
  selection: SelectionInput,
  configuration: LiveConfiguration
): boolean {
  return (
    selection.kind === "select" ||
    (selection.kind === "counter" &&
      configuration.pricingMode === SessionConfigurationPricingMode.TIERED)
  );
}

function findActiveOption(
  configuration: LiveConfiguration,
  optionId: string
): SessionConfigurationOption {
  const option = configuration.options.find((candidate) => candidate.id === optionId);
  if (!option) {
    throw new SessionConfigurationSelectionOptionMismatchError();
  }
  return option;
}

function decimalFromFiniteNonNegative(value: number): Prisma.Decimal {
  if (!Number.isFinite(value) || value < 0) {
    throw new SessionConfigurationSelectionInputMismatchError();
  }
  return new Prisma.Decimal(value);
}

function assertTextValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new SessionConfigurationSelectionInputMismatchError();
  }
  return trimmed;
}

function resolveSnapshotPriceDelta(
  configuration: LiveConfiguration,
  option: SessionConfigurationOption | null,
  numericValue: Prisma.Decimal | null
): Prisma.Decimal {
  switch (configuration.pricingMode) {
    case SessionConfigurationPricingMode.NONE:
      return zeroMoney();
    case SessionConfigurationPricingMode.FIXED: {
      const fixedPrice = configuration.fixedPriceDelta ?? zeroMoney();
      if (configuration.inputType === SessionConfigurationInputType.COUNTER) {
        if (
          configuration.counterPricingMode ===
          SessionConfigurationCounterPricingMode.PER_UNIT
        ) {
          const unitPrice = configuration.counterUnitPrice ?? fixedPrice;
          return unitPrice.mul(numericValue ?? zeroMoney());
        }
        return fixedPrice;
      }
      return fixedPrice;
    }
    case SessionConfigurationPricingMode.TIERED:
      if (!option) {
        throw new SessionConfigurationSelectionOptionMismatchError();
      }
      return option.priceDelta;
    case SessionConfigurationPricingMode.LINKED_PRODUCT:
      if (!configuration.linkedProduct) {
        throw new SessionConfigurationSelectionInputMismatchError();
      }
      return zeroMoney();
    default:
      throw new SessionConfigurationSelectionInputMismatchError();
  }
}

async function createSelectionRow(
  tx: Prisma.TransactionClient,
  orderPackageId: string,
  data: SelectionSnapshotData
): Promise<{ id: string }> {
  return tx.orderPackageSessionConfigurationSelection.create({
    data: {
      orderPackageId,
      ...data,
    },
    select: { id: true },
  });
}

async function createLinkedProductAddOn(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    orderPackageId: string;
    snapshot: SelectionSnapshot;
    configurationById: Map<string, LiveConfiguration>;
  }
): Promise<string> {
  const configuration = input.configurationById.get(input.snapshot.configurationId);
  if (!configuration?.linkedProductId || !configuration.linkedProduct) {
    throw new SessionConfigurationSelectionInputMismatchError();
  }
  const addOn = await tx.orderAddOn.create({
    data: {
      orderId: input.orderId,
      orderPackageId: input.orderPackageId,
      productId: configuration.linkedProductId,
      nameSnapshot: configuration.linkedProduct.name,
      priceSnapshot: configuration.linkedProduct.canonicalPrice,
      quantity: 1,
    },
    select: { id: true },
  });
  console.info(
    JSON.stringify({
      metric: "session_configuration.linked_product.materialized",
      orderId: input.orderId,
      orderPackageId: input.orderPackageId,
      configurationId: input.snapshot.configurationId,
      orderAddOnId: addOn.id,
    })
  );
  return addOn.id;
}

async function updateSelectionRow(
  tx: Prisma.TransactionClient,
  id: string,
  data: SelectionSnapshotData
): Promise<{ id: string }> {
  return tx.orderPackageSessionConfigurationSelection.update({
    where: { id },
    data,
    select: { id: true },
  });
}

async function deleteSelectionRow(
  tx: Prisma.TransactionClient,
  id: string
): Promise<void> {
  await tx.orderPackageSessionConfigurationSelection.delete({
    where: { id },
  });
}

async function deleteSelectionRows(
  tx: Prisma.TransactionClient,
  ids: string[]
): Promise<void> {
  await tx.orderPackageSessionConfigurationSelection.deleteMany({
    where: { id: { in: ids } },
  });
}

async function deleteSelectionOwnedAddOns(
  tx: Prisma.TransactionClient,
  orderAddOnIds: string[]
): Promise<void> {
  if (orderAddOnIds.length === 0) return;
  await tx.orderAddOn.deleteMany({
    where: { id: { in: orderAddOnIds } },
  });
  for (const orderAddOnId of orderAddOnIds) {
    console.info(
      JSON.stringify({
        metric: "session_configuration.linked_product.demolished",
        orderAddOnId,
      })
    );
  }
}

function selectionPayloadMatches(
  existing: ExistingSelection,
  data: SelectionSnapshotData
): boolean {
  return (
    existing.configurationId === data.configurationId &&
    existing.optionId === data.optionId &&
    decimalValuesEqual(existing.numericValue, data.numericValue) &&
    existing.textValue === data.textValue &&
    existing.snapshotOptionLabel === data.snapshotOptionLabel &&
    existing.snapshotConfigurationCode === data.snapshotConfigurationCode &&
    existing.snapshotLabel === data.snapshotLabel &&
    (data.snapshotPriceDelta === undefined ||
      decimalValuesEqual(existing.snapshotPriceDelta, data.snapshotPriceDelta)) &&
    existing.snapshotFinancialBehavior === data.snapshotFinancialBehavior &&
    existing.snapshotInputType === data.snapshotInputType &&
    existing.snapshotPricingMode === data.snapshotPricingMode &&
    existing.snapshotLinkedProductId === data.snapshotLinkedProductId &&
    existing.orderAddOnId === data.orderAddOnId
  );
}

function decimalValuesEqual(
  left: Prisma.Decimal | null,
  right:
    | Prisma.Decimal
    | Prisma.DecimalJsLike
    | string
    | number
    | null
    | undefined
): boolean {
  if (left === null || left === undefined) {
    return right === null || right === undefined;
  }
  if (right === null || right === undefined) return false;
  if (right instanceof Prisma.Decimal) return left.equals(right);
  return left.equals(new Prisma.Decimal(right as string | number));
}

function snapshotData(
  snapshot: SelectionSnapshot,
  options: { orderAddOnId?: string | null; preserveLinkedProductPrice?: boolean } = {}
): Omit<
  Prisma.OrderPackageSessionConfigurationSelectionUncheckedCreateInput,
  "id" | "orderPackageId" | "createdAt" | "updatedAt"
> {
  const isLinkedProduct =
    snapshot.snapshotPricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT;
  return {
    configurationId: snapshot.configurationId,
    optionId: snapshot.optionId,
    numericValue: snapshot.numericValue,
    textValue: snapshot.textValue,
    snapshotOptionLabel: snapshot.snapshotOptionLabel,
    snapshotConfigurationCode: snapshot.snapshotConfigurationCode,
    snapshotLabel: snapshot.snapshotLabel,
    snapshotPriceDelta:
      isLinkedProduct && options.preserveLinkedProductPrice
        ? undefined
        : snapshot.snapshotPriceDelta,
    snapshotFinancialBehavior: snapshot.snapshotFinancialBehavior,
    snapshotInputType: snapshot.snapshotInputType,
    snapshotPricingMode: snapshot.snapshotPricingMode,
    snapshotLinkedProductId: snapshot.snapshotLinkedProductId,
    orderAddOnId: options.orderAddOnId ?? snapshot.orderAddOnId,
  };
}

function assertUniqueConfigurations(snapshots: SelectionSnapshot[]): void {
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.configurationId)) {
      throw new SessionConfigurationSelectionInputMismatchError();
    }
    seen.add(snapshot.configurationId);
  }
}

function zeroMoney(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function isSerializableWriteConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034";
}
