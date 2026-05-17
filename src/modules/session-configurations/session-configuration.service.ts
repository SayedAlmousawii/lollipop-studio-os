import {
  Prisma,
  SessionConfigurationCounterPricingMode,
  SessionConfigurationInputType,
  SessionConfigurationPricingMode,
  type SessionConfiguration,
  type SessionConfigurationOption,
} from "@prisma/client";
import type { CurrentAppUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
  requirePermission,
} from "@/lib/permissions";
import { withRetry } from "@/lib/retry";
import { generateSessionConfigurationCode } from "./session-configuration-code";
import {
  createSessionConfigurationSchema,
  updateSessionConfigurationSchema,
  type CreateSessionConfigurationInput,
  type SessionConfigurationOptionInput,
  type UpdateSessionConfigurationInput,
} from "./session-configuration.schema";
import type {
  SessionConfigurationDetail,
  SessionConfigurationRow,
} from "./session-configuration.types";

type DbClient = typeof db | Prisma.TransactionClient;
type SessionConfigurationActor = Pick<CurrentAppUser, "id" | "role">;

type ConfigurationWithRelations = SessionConfiguration & {
  sessionType: { id: string; code: string; name: string };
  linkedProduct: { id: string; name: string } | null;
  options: SessionConfigurationOption[];
};

export class SessionConfigurationNotFoundError extends Error {
  constructor() {
    super("Session configuration not found.");
    this.name = "SessionConfigurationNotFoundError";
  }
}

export class SessionConfigurationCodeConflictError extends Error {
  constructor() {
    super("A session configuration with this code already exists.");
    this.name = "SessionConfigurationCodeConflictError";
  }
}

export class SessionConfigurationSessionTypeNotFoundError extends Error {
  constructor() {
    super("Session type not found.");
    this.name = "SessionConfigurationSessionTypeNotFoundError";
  }
}

export class SessionConfigurationLinkedProductNotFoundError extends Error {
  constructor() {
    super("Linked product not found.");
    this.name = "SessionConfigurationLinkedProductNotFoundError";
  }
}

export class SessionConfigurationValidationError extends Error {
  constructor(message = "Session configuration is invalid.") {
    super(message);
    this.name = "SessionConfigurationValidationError";
  }
}

export async function listSessionConfigurations({
  includeArchived = false,
}: {
  includeArchived?: boolean;
} = {},
actor?: SessionConfigurationActor): Promise<SessionConfigurationRow[]> {
  await assertCanManageSessionConfigurations(actor);

  const rows = await withRetry(
    () =>
      db.sessionConfiguration.findMany({
        where: includeArchived ? undefined : { isActive: true },
        include: {
          sessionType: { select: { id: true, code: true, name: true } },
          linkedProduct: { select: { id: true, name: true } },
          options: {
            orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
          },
        },
        orderBy: [
          { sessionType: { name: "asc" } },
          { sortOrder: "asc" },
          { name: "asc" },
        ],
      }),
    "Failed to fetch session configurations"
  );

  return rows.map(mapConfigurationRow);
}

export async function getSessionConfigurationDetail(
  id: string,
  actor?: SessionConfigurationActor
): Promise<SessionConfigurationDetail> {
  await assertCanManageSessionConfigurations(actor);

  const row = await withRetry(
    () =>
      db.sessionConfiguration.findUnique({
        where: { id },
        include: {
          sessionType: { select: { id: true, code: true, name: true } },
          linkedProduct: { select: { id: true, name: true } },
          options: {
            orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
          },
        },
      }),
    "Failed to fetch session configuration"
  );

  if (!row) {
    throw new SessionConfigurationNotFoundError();
  }

  return mapConfigurationRow(row);
}

export async function createSessionConfiguration(
  input: CreateSessionConfigurationInput,
  actor?: SessionConfigurationActor
): Promise<{ id: string }> {
  await assertCanManageSessionConfigurations(actor);
  const data = parseCreateInput(input);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const sessionType = await tx.sessionType.findFirst({
          where: { id: data.sessionTypeId, isActive: true },
          select: { id: true, code: true },
        });
        if (!sessionType) {
          throw new SessionConfigurationSessionTypeNotFoundError();
        }

        await assertLinkedProductAvailable(tx, data);

        const code = generateSessionConfigurationCode(sessionType.code, data.name);

        const created = await tx.sessionConfiguration
          .create({
            data: {
              code,
              name: data.name,
              sessionTypeId: data.sessionTypeId,
              inputType: data.inputType,
              pricingMode: data.pricingMode,
              financialBehavior: data.financialBehavior,
              required: data.required,
              sortOrder: data.sortOrder,
              ...pricingData(data),
              options: {
                create: data.options.map((option) => ({
                  label: option.label,
                  value: option.value,
                  priceDelta: decimal(option.priceDelta ?? 0),
                  sortOrder: option.sortOrder,
                  isActive: option.isActive,
                })),
              },
            },
            select: { id: true },
          })
          .catch((error: unknown) => {
            if (isUniqueConstraintError(error)) {
              throw new SessionConfigurationCodeConflictError();
            }
            throw error;
          });

        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    "Failed to create session configuration",
    3,
    isSerializableWriteConflict
  );
}

export async function updateSessionConfiguration(
  id: string,
  input: UpdateSessionConfigurationInput,
  actor?: SessionConfigurationActor
): Promise<{ id: string }> {
  await assertCanManageSessionConfigurations(actor);
  const data = parseUpdateInput(input);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.sessionConfiguration.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!existing) {
          throw new SessionConfigurationNotFoundError();
        }

        await assertLinkedProductAvailable(tx, data);
        await assertOptionIdsBelongToConfiguration(tx, id, data.options);

        const updated = await tx.sessionConfiguration.update({
          where: { id },
          data: {
            name: data.name,
            inputType: data.inputType,
            pricingMode: data.pricingMode,
            financialBehavior: data.financialBehavior,
            required: data.required,
            sortOrder: data.sortOrder,
            ...pricingData(data),
          },
          select: { id: true },
        });

        await syncOptions(tx, id, data.options);
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    "Failed to update session configuration",
    3,
    isSerializableWriteConflict
  );
}

export async function archiveSessionConfiguration(
  id: string,
  actor?: SessionConfigurationActor
): Promise<{ id: string }> {
  await assertCanManageSessionConfigurations(actor);

  return db.sessionConfiguration
    .update({
      where: { id },
      data: { isActive: false },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (isRecordNotFoundError(error)) {
        throw new SessionConfigurationNotFoundError();
      }
      throw error;
    });
}

export async function unarchiveSessionConfiguration(
  id: string,
  actor?: SessionConfigurationActor
): Promise<{ id: string }> {
  await assertCanManageSessionConfigurations(actor);

  return db.sessionConfiguration
    .update({
      where: { id },
      data: { isActive: true },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (isRecordNotFoundError(error)) {
        throw new SessionConfigurationNotFoundError();
      }
      throw error;
    });
}

function parseCreateInput(
  input: CreateSessionConfigurationInput
): CreateSessionConfigurationInput {
  try {
    return createSessionConfigurationSchema.parse(input);
  } catch (error) {
    if (error instanceof Error) {
      throw new SessionConfigurationValidationError(error.message);
    }
    throw error;
  }
}

function parseUpdateInput(
  input: UpdateSessionConfigurationInput
): UpdateSessionConfigurationInput {
  try {
    return updateSessionConfigurationSchema.parse(input);
  } catch (error) {
    if (error instanceof Error) {
      throw new SessionConfigurationValidationError(error.message);
    }
    throw error;
  }
}

async function assertCanManageSessionConfigurations(
  actor?: SessionConfigurationActor
): Promise<void> {
  if (actor) {
    requirePermission(actor, PERMISSIONS.PACKAGE_CATALOG_MANAGE);
    return;
  }

  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
}

async function assertLinkedProductAvailable(
  client: DbClient,
  input: Pick<
    CreateSessionConfigurationInput,
    "pricingMode" | "linkedProductId"
  >
): Promise<void> {
  if (
    input.pricingMode !== SessionConfigurationPricingMode.LINKED_PRODUCT ||
    !input.linkedProductId
  ) {
    return;
  }

  const linkedProduct = await client.product.findFirst({
    where: { id: input.linkedProductId, isActive: true },
    select: { id: true },
  });

  if (!linkedProduct) {
    throw new SessionConfigurationLinkedProductNotFoundError();
  }
}

async function assertOptionIdsBelongToConfiguration(
  client: DbClient,
  configurationId: string,
  options: SessionConfigurationOptionInput[]
): Promise<void> {
  const ids = options
    .map((option) => option.id)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;

  const existing = await client.sessionConfigurationOption.findMany({
    where: { id: { in: ids }, configurationId },
    select: { id: true },
  });
  if (existing.length !== new Set(ids).size) {
    throw new SessionConfigurationValidationError(
      "One or more options do not belong to this configuration."
    );
  }
}

async function syncOptions(
  client: DbClient,
  configurationId: string,
  options: SessionConfigurationOptionInput[]
): Promise<void> {
  const existing = await client.sessionConfigurationOption.findMany({
    where: { configurationId },
    select: { id: true },
  });
  const incomingIds = new Set(
    options
      .map((option) => option.id)
      .filter((id): id is string => Boolean(id))
  );

  for (const option of options) {
    if (option.id) {
      await client.sessionConfigurationOption.update({
        where: { id: option.id },
        data: {
          label: option.label,
          value: option.value,
          priceDelta: decimal(option.priceDelta ?? 0),
          sortOrder: option.sortOrder,
          isActive: option.isActive,
        },
      });
      continue;
    }

    await client.sessionConfigurationOption.create({
      data: {
        configurationId,
        label: option.label,
        value: option.value,
        priceDelta: decimal(option.priceDelta ?? 0),
        sortOrder: option.sortOrder,
        isActive: option.isActive,
      },
    });
  }

  const removedIds = existing
    .map((option) => option.id)
    .filter((id) => !incomingIds.has(id));

  if (removedIds.length > 0) {
    await client.sessionConfigurationOption.updateMany({
      where: { id: { in: removedIds }, configurationId },
      data: { isActive: false },
    });
  }
}

function pricingData(
  data: Pick<
    CreateSessionConfigurationInput,
    | "pricingMode"
    | "inputType"
    | "fixedPriceDelta"
    | "linkedProductId"
    | "linkProductDisplay"
    | "counterPricingMode"
    | "counterUnitPrice"
  >
): Pick<
  Prisma.SessionConfigurationUncheckedCreateInput,
  | "fixedPriceDelta"
  | "linkedProductId"
  | "linkProductDisplay"
  | "counterPricingMode"
  | "counterUnitPrice"
> {
  return {
    fixedPriceDelta:
      data.pricingMode === SessionConfigurationPricingMode.FIXED
        ? decimal(data.fixedPriceDelta ?? 0)
        : null,
    linkedProductId:
      data.pricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT
        ? data.linkedProductId ?? null
        : null,
    linkProductDisplay:
      data.pricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT
        ? data.linkProductDisplay ?? null
        : null,
    counterPricingMode:
      data.inputType === SessionConfigurationInputType.COUNTER &&
      data.pricingMode !== SessionConfigurationPricingMode.NONE
        ? data.counterPricingMode ?? null
        : null,
    counterUnitPrice:
      data.inputType === SessionConfigurationInputType.COUNTER &&
      data.pricingMode !== SessionConfigurationPricingMode.NONE &&
      data.counterPricingMode === SessionConfigurationCounterPricingMode.PER_UNIT &&
      data.counterUnitPrice !== undefined
        ? decimal(data.counterUnitPrice)
        : null,
  };
}

function mapConfigurationRow(
  row: ConfigurationWithRelations
): SessionConfigurationRow {
  const activeOptions = row.options.filter((option) => option.isActive);

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sessionTypeId: row.sessionTypeId,
    sessionTypeCode: row.sessionType.code,
    sessionTypeName: row.sessionType.name,
    inputType: row.inputType,
    pricingMode: row.pricingMode,
    financialBehavior: row.financialBehavior,
    required: row.required,
    isActive: row.isActive,
    status: row.isActive ? "Active" : "Archived",
    sortOrder: row.sortOrder,
    fixedPriceDelta: row.fixedPriceDelta?.toNumber() ?? null,
    linkedProductId: row.linkedProductId,
    linkedProductName: row.linkedProduct?.name ?? null,
    linkProductDisplay: row.linkProductDisplay,
    counterPricingMode: row.counterPricingMode,
    counterUnitPrice: row.counterUnitPrice?.toNumber() ?? null,
    activeOptionCount: activeOptions.length,
    optionPreviewLabels: activeOptions
      .slice(0, 3)
      .map((option) => option.label),
    options: row.options.map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
      priceDelta: option.priceDelta.toNumber(),
      sortOrder: option.sortOrder,
      isActive: option.isActive,
    })),
  };
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isSerializableWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}
