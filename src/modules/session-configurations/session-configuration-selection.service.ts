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
  snapshotConfigurationCode: string;
  snapshotLabel: string;
  snapshotPriceDelta: Prisma.Decimal;
  snapshotFinancialBehavior: LiveConfiguration["financialBehavior"];
  snapshotInputType: LiveConfiguration["inputType"];
  snapshotPricingMode: LiveConfiguration["pricingMode"];
  snapshotLinkedProductId: string | null;
  snapshotLinkProductDisplay: LiveConfiguration["linkProductDisplay"];
};

const existingSelectionSelect = {
  id: true,
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
  constructor() {
    super("Session configuration is not available for this package.");
    this.name = "SessionConfigurationSelectionConfigurationNotFoundError";
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
            const data = snapshotData(snapshot);
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
                  after: auditPayloadFromSelectionSnapshot(snapshot),
                });
              }
              continue;
            }

            const created = await createSelectionRow(tx, orderPackageId, data);
            writtenSelectionIds.push(created.id);
            if (options.allowPostLock === true) {
              auditEntries.push({
                entityId: created.id,
                before: null,
                after: auditPayloadFromSelectionSnapshot(snapshot),
              });
            }
          }

          const removedIds = existingSelections
            .filter(
              (selection) =>
                !desiredConfigurationIds.has(selection.configurationId) &&
                (options.allowPostLock !== true ||
                  selection.snapshotFinancialBehavior ===
                    SessionConfigurationFinancialBehavior.OPERATIONAL)
            )
            .map((selection) => selection.id);
          if (removedIds.length > 0) {
            if (options.allowPostLock === true) {
              for (const selection of existingSelections.filter((existing) =>
                removedIds.includes(existing.id)
              )) {
                auditEntries.push({
                  entityId: selection.id,
                  before: auditPayloadFromExistingSelection(selection),
                  after: null,
                });
              }
            }
            await deleteSelectionRows(tx, removedIds);
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

export async function applyFinancialSelectionEditFromWorkspace(
  tx: Prisma.TransactionClient,
  input: {
    orderPackageId: string;
    configurationId: string;
    desired: WorkspaceSessionConfigurationDesired;
  }
): Promise<{ selectionId: string | null }> {
  const orderPackage = await tx.orderPackage.findUnique({
    where: { id: input.orderPackageId },
    select: { id: true, sessionTypeId: true },
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
  if (
    !configuration ||
    configuration.financialBehavior !== SessionConfigurationFinancialBehavior.FINANCIAL
  ) {
    throw new SessionConfigurationSelectionFinancialNotAllowedError([
      configuration?.code ?? input.configurationId,
    ]);
  }

  if (input.desired === null) {
    const existing = await tx.orderPackageSessionConfigurationSelection.findUnique({
      where: {
        orderPackageId_configurationId: {
          orderPackageId: input.orderPackageId,
          configurationId: input.configurationId,
        },
      },
      select: { id: true },
    });
    if (!existing) return { selectionId: null };
    await deleteSelectionRow(tx, existing.id);
    return { selectionId: existing.id };
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
    select: { id: true },
  });
  if (existing) {
    const updated = await updateSelectionRow(tx, existing.id, snapshotData(snapshot));
    return { selectionId: updated.id };
  }

  const created = await createSelectionRow(
    tx,
    input.orderPackageId,
    snapshotData(snapshot)
  );
  return { selectionId: created.id };
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
    snapshotLinkProductDisplay:
      configuration.pricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT
        ? configuration.linkProductDisplay
        : null,
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
      if (
        snapshot.snapshotFinancialBehavior !==
        SessionConfigurationFinancialBehavior.OPERATIONAL
      ) {
        offendingCodes.add(snapshot.snapshotConfigurationCode);
      }
      continue;
    }

    if (
      existing.snapshotFinancialBehavior !==
        SessionConfigurationFinancialBehavior.OPERATIONAL ||
      snapshot.snapshotFinancialBehavior !==
        SessionConfigurationFinancialBehavior.OPERATIONAL
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

function auditPayloadFromExistingSelection(selection: ExistingSelection) {
  return {
    configurationId: selection.configurationId,
    snapshotConfigurationCode: selection.snapshotConfigurationCode,
    snapshotLabel: selection.snapshotLabel,
    snapshotPriceDelta: selection.snapshotPriceDelta.toString(),
    snapshotFinancialBehavior: selection.snapshotFinancialBehavior,
    snapshotInputType: selection.snapshotInputType,
    snapshotPricingMode: selection.snapshotPricingMode,
    snapshotLinkedProductId: selection.snapshotLinkedProductId,
    snapshotLinkProductDisplay: selection.snapshotLinkProductDisplay,
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
    snapshotPriceDelta: snapshot.snapshotPriceDelta.toString(),
    snapshotFinancialBehavior: snapshot.snapshotFinancialBehavior,
    snapshotInputType: snapshot.snapshotInputType,
    snapshotPricingMode: snapshot.snapshotPricingMode,
    snapshotLinkedProductId: snapshot.snapshotLinkedProductId,
    snapshotLinkProductDisplay: snapshot.snapshotLinkProductDisplay,
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
      return configuration.linkedProduct.canonicalPrice;
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

function selectionPayloadMatches(
  existing: ExistingSelection,
  data: SelectionSnapshotData
): boolean {
  return (
    existing.configurationId === data.configurationId &&
    existing.optionId === data.optionId &&
    decimalValuesEqual(existing.numericValue, data.numericValue) &&
    existing.textValue === data.textValue &&
    existing.snapshotConfigurationCode === data.snapshotConfigurationCode &&
    existing.snapshotLabel === data.snapshotLabel &&
    decimalValuesEqual(existing.snapshotPriceDelta, data.snapshotPriceDelta) &&
    existing.snapshotFinancialBehavior === data.snapshotFinancialBehavior &&
    existing.snapshotInputType === data.snapshotInputType &&
    existing.snapshotPricingMode === data.snapshotPricingMode &&
    existing.snapshotLinkedProductId === data.snapshotLinkedProductId &&
    existing.snapshotLinkProductDisplay === data.snapshotLinkProductDisplay
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
  snapshot: SelectionSnapshot
): Omit<
  Prisma.OrderPackageSessionConfigurationSelectionUncheckedCreateInput,
  "id" | "orderPackageId" | "createdAt" | "updatedAt"
> {
  return {
    configurationId: snapshot.configurationId,
    optionId: snapshot.optionId,
    numericValue: snapshot.numericValue,
    textValue: snapshot.textValue,
    snapshotConfigurationCode: snapshot.snapshotConfigurationCode,
    snapshotLabel: snapshot.snapshotLabel,
    snapshotPriceDelta: snapshot.snapshotPriceDelta,
    snapshotFinancialBehavior: snapshot.snapshotFinancialBehavior,
    snapshotInputType: snapshot.snapshotInputType,
    snapshotPricingMode: snapshot.snapshotPricingMode,
    snapshotLinkedProductId: snapshot.snapshotLinkedProductId,
    snapshotLinkProductDisplay: snapshot.snapshotLinkProductDisplay,
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
