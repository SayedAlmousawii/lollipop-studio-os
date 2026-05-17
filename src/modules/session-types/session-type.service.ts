import { MediaType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
  requirePermission,
} from "@/lib/permissions";
import type { CurrentAppUser } from "@/lib/auth";
import { withRetry } from "@/lib/retry";
import {
  createSessionTypeSchema,
  updateSessionTypeSchema,
  type CreateSessionTypeInput,
  type UpdateSessionTypeInput,
} from "./session-type.schema";
import { generateSessionTypeCode } from "./session-type-code";
import type { SessionTypeRow } from "./session-type.types";

type DbClient = typeof db | Prisma.TransactionClient;
type SessionTypeActor = Pick<CurrentAppUser, "id" | "role">;

export class SessionTypeNotFoundError extends Error {
  constructor() {
    super("Session type not found.");
    this.name = "SessionTypeNotFoundError";
  }
}

export class SessionTypeDepartmentNotFoundError extends Error {
  constructor() {
    super("Department not found.");
    this.name = "SessionTypeDepartmentNotFoundError";
  }
}

export class SessionTypeNameConflictError extends Error {
  constructor() {
    super("A session type with this name already exists in this department.");
    this.name = "SessionTypeNameConflictError";
  }
}

export async function listSessionTypes({
  includeArchived = false,
}: {
  includeArchived?: boolean;
} = {}): Promise<SessionTypeRow[]> {
  const rows = await withRetry(
    () =>
      db.sessionType.findMany({
        where: includeArchived ? undefined : { isActive: true },
        include: {
          department: true,
          extraPhotoPricing: {
            select: { mediaType: true, unitPrice: true },
          },
        },
        orderBy: [
          { department: { sortOrder: "asc" } },
          { department: { name: "asc" } },
          { sortOrder: "asc" },
          { name: "asc" },
        ],
      }),
    "Failed to fetch session types"
  );

  return rows.map((row) => {
    const zeroPriceMediaTypes = row.extraPhotoPricing
      .filter((price) => price.unitPrice.equals(0))
      .map((price) => price.mediaType);
    const pricedMediaTypes = new Set(
      row.extraPhotoPricing.map((price) => price.mediaType)
    );

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      departmentId: row.departmentId,
      departmentName: row.department.name,
      departmentCode: row.department.code,
      calendarLabel: row.calendarLabel,
      calendarColor: row.calendarColor ?? "",
      isActive: row.isActive,
      status: row.isActive ? "Active" : "Archived",
      sortOrder: row.sortOrder,
      zeroPriceMediaTypes,
      pricingConfigured:
        zeroPriceMediaTypes.length === 0 &&
        pricedMediaTypes.has(MediaType.DIGITAL) &&
        pricedMediaTypes.has(MediaType.PRINT),
    };
  });
}

export async function createSessionType(
  input: CreateSessionTypeInput,
  actor?: SessionTypeActor
): Promise<{ id: string }> {
  await assertCanManageSessionTypes(actor);
  const data = createSessionTypeSchema.parse(input);

  return db.$transaction(async (tx) => {
    const department = await tx.studioDepartment.findFirst({
      where: { id: data.departmentId, isActive: true },
      select: { id: true, code: true },
    });
    if (!department) {
      throw new SessionTypeDepartmentNotFoundError();
    }

    await assertSessionTypeNameAvailable(tx, data.departmentId, data.name);
    const code = generateSessionTypeCode(department.code, data.name);
    const nextSortOrder = await nextSessionTypeSortOrder(tx, data.departmentId);

    const created = await tx.sessionType.create({
      data: {
        departmentId: data.departmentId,
        code,
        name: data.name,
        calendarLabel: data.calendarLabel,
        calendarColor: data.calendarColor,
        sortOrder: nextSortOrder,
        extraPhotoPricing: {
          create: [
            { mediaType: MediaType.DIGITAL, unitPrice: 0 },
            { mediaType: MediaType.PRINT, unitPrice: 0 },
          ],
        },
      },
      select: { id: true },
    }).catch((error: unknown) => {
      if (isUniqueConstraintError(error)) {
        throw new SessionTypeNameConflictError();
      }
      throw error;
    });

    await tx.packageFamily.create({
      data: {
        code: `${code}_DEFAULT`,
        name: `${data.name} Packages`,
        sessionTypeId: created.id,
        sortOrder: 10,
      },
      select: { id: true },
    });

    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateSessionType(
  id: string,
  input: UpdateSessionTypeInput,
  actor?: SessionTypeActor
): Promise<{ id: string }> {
  await assertCanManageSessionTypes(actor);
  const data = updateSessionTypeSchema.parse(input);

  return db.$transaction(async (tx) => {
    const existing = await tx.sessionType.findUnique({
      where: { id },
      select: { id: true, departmentId: true, name: true },
    });
    if (!existing) {
      throw new SessionTypeNotFoundError();
    }

    if (
      data.name !== undefined &&
      data.name.trim().toLowerCase() !== existing.name.trim().toLowerCase()
    ) {
      await assertSessionTypeNameAvailable(tx, existing.departmentId, data.name, id);
    }

    return tx.sessionType.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.calendarLabel !== undefined
          ? { calendarLabel: data.calendarLabel }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, "calendarColor")
          ? { calendarColor: data.calendarColor ?? null }
          : {}),
      },
      select: { id: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function archiveSessionType(
  id: string,
  actor?: SessionTypeActor
): Promise<{ id: string }> {
  await assertCanManageSessionTypes(actor);

  const row = await db.sessionType.update({
    where: { id },
    data: { isActive: false },
    select: { id: true },
  }).catch((error: unknown) => {
    if (isRecordNotFoundError(error)) {
      throw new SessionTypeNotFoundError();
    }
    throw error;
  });

  return row;
}

export async function unarchiveSessionType(
  id: string,
  actor?: SessionTypeActor
): Promise<{ id: string }> {
  await assertCanManageSessionTypes(actor);

  return db.$transaction(async (tx) => {
    const existing = await tx.sessionType.findUnique({
      where: { id },
      select: { id: true, departmentId: true, name: true },
    });
    if (!existing) {
      throw new SessionTypeNotFoundError();
    }

    await assertSessionTypeNameAvailable(tx, existing.departmentId, existing.name, id, {
      activeOnly: true,
    });

    return tx.sessionType.update({
      where: { id },
      data: { isActive: true },
      select: { id: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function assertCanManageSessionTypes(actor?: SessionTypeActor): Promise<void> {
  if (actor) {
    requirePermission(actor, PERMISSIONS.PACKAGE_CATALOG_MANAGE);
    return;
  }

  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
}

async function assertSessionTypeNameAvailable(
  client: DbClient,
  departmentId: string,
  name: string,
  excludeId?: string,
  options: { activeOnly?: boolean } = {}
): Promise<void> {
  const existing = await client.sessionType.findFirst({
    where: {
      departmentId,
      name: {
        equals: name.trim(),
        mode: Prisma.QueryMode.insensitive,
      },
      ...(options.activeOnly ? { isActive: true } : {}),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw new SessionTypeNameConflictError();
  }
}

async function nextSessionTypeSortOrder(
  client: DbClient,
  departmentId: string
): Promise<number> {
  const last = await client.sessionType.findFirst({
    where: { departmentId },
    select: { sortOrder: true },
    orderBy: { sortOrder: "desc" },
  });

  return (last?.sortOrder ?? 0) + 10;
}

function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
