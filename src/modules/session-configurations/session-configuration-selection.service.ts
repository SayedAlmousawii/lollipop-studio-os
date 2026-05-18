import {
  InvoiceType,
  Prisma,
  SessionConfigurationCounterPricingMode,
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

export class SessionConfigurationSelectionLockedError extends Error {
  constructor() {
    super("Order session configurations are locked.");
    this.name = "SessionConfigurationSelectionLockedError";
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
  options: { allowPostLock?: boolean } = {}
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
              select: { id: true, configurationId: true },
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

          const writtenSelectionIds: string[] = [];
          for (const snapshot of snapshots) {
            const existing = existingByConfigurationId.get(snapshot.configurationId);
            if (existing) {
              const updated =
                await tx.orderPackageSessionConfigurationSelection.update({
                  where: { id: existing.id },
                  data: snapshotData(snapshot),
                  select: { id: true },
                });
              writtenSelectionIds.push(updated.id);
              continue;
            }

            const created =
              await tx.orderPackageSessionConfigurationSelection.create({
                data: {
                  orderPackageId,
                  ...snapshotData(snapshot),
                },
                select: { id: true },
              });
            writtenSelectionIds.push(created.id);
          }

          const removedIds = existingSelections
            .filter(
              (selection) =>
                !desiredConfigurationIds.has(selection.configurationId)
            )
            .map((selection) => selection.id);
          if (removedIds.length > 0) {
            await tx.orderPackageSessionConfigurationSelection.deleteMany({
              where: { id: { in: removedIds } },
            });
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
