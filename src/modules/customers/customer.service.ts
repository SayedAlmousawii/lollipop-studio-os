import { CustomerStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import {
  createCustomerSchema,
  type CreateCustomerInput,
  updateCustomerSchema,
  type UpdateCustomerInput,
} from "./customer.schema";
import type { Customer } from "./customer.types";

export interface CustomerFilters {
  search?: string;
  status?: CustomerStatus;
}

const CUSTOMER_STATUS_FILTERS = new Set<CustomerStatus>([
  CustomerStatus.ACTIVE,
  CustomerStatus.INACTIVE,
]);

export class CustomerPhoneConflictError extends Error {
  constructor() {
    super("A customer with this phone number already exists.");
    this.name = "CustomerPhoneConflictError";
  }
}

export class CustomerNotFoundError extends Error {
  constructor() {
    super("Customer not found.");
    this.name = "CustomerNotFoundError";
  }
}

export interface CustomerEditRecord {
  id: string;
  name: string;
  phone: string;
  status: CustomerStatus;
  notes: string;
}

export function parseCustomerFilters(filters: {
  search?: string | string[];
  status?: string | string[];
}): CustomerFilters {
  const search = singleValue(filters.search)?.trim();
  const status = singleValue(filters.status);

  return {
    search: search ? search : undefined,
    status:
      status && CUSTOMER_STATUS_FILTERS.has(status as CustomerStatus)
        ? (status as CustomerStatus)
        : undefined,
  };
}

export async function getCustomers(
  filters: CustomerFilters = {}
): Promise<Customer[]> {
  const rows = await withRetry(
    () =>
      db.customer.findMany({
        where: buildCustomersWhere(filters),
        include: {
          _count: { select: { children: true, bookings: true } },
          bookings: {
            orderBy: { sessionDate: "desc" },
            take: 1,
            select: { sessionDate: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    "Failed to fetch customers"
  );

  return rows.map((row) => ({
    id: row.id,
    fullName: row.name,
    phone: row.phone,
    childrenCount: row._count.children,
    totalBookings: row._count.bookings,
    lastSessionDate: row.bookings[0]
      ? formatSessionDate(row.bookings[0].sessionDate)
      : "—",
    status: row.status === "ACTIVE" ? "Active" : "Inactive",
  }));
}

export async function getCustomerForEdit(
  customerId: string
): Promise<CustomerEditRecord | null> {
  const row = await withRetry(
    () =>
      db.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          notes: true,
        },
      }),
    "Failed to fetch customer"
  );

  if (!row) return null;

  return {
    ...row,
    notes: row.notes ?? "",
  };
}

export async function createCustomer(
  input: CreateCustomerInput
): Promise<{ id: string }> {
  const data = createCustomerSchema.parse(input);

  try {
    return await db.customer.create({
      data: {
        name: data.name,
        phone: data.phone,
        notes: data.notes,
        status: CustomerStatus.ACTIVE,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniquePhoneConflict(error)) {
      throw new CustomerPhoneConflictError();
    }
    throw error;
  }
}

export async function updateCustomer(
  customerId: string,
  input: UpdateCustomerInput
): Promise<{ id: string }> {
  const data = updateCustomerSchema.parse(input);

  try {
    return await db.customer.update({
      where: { id: customerId },
      data: {
        name: data.name,
        phone: data.phone,
        notes: data.notes,
        status: data.status,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniquePhoneConflict(error)) {
      throw new CustomerPhoneConflictError();
    }
    if (isRecordNotFound(error)) {
      throw new CustomerNotFoundError();
    }
    throw error;
  }
}

function buildCustomersWhere(filters: CustomerFilters): Prisma.CustomerWhereInput {
  const search = filters.search;
  const searchClause = search
    ? {
        OR: [
          {
            name: {
              contains: search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            phone: {
              contains: search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        ],
      }
    : undefined;

  return {
    ...(searchClause ?? {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
}

function formatSessionDate(date: Date): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isUniquePhoneConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return error.code === "P2002" && isPhoneTarget(error.meta?.target);
}

function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

function isPhoneTarget(target: unknown): boolean {
  return Array.isArray(target) && target.includes("phone");
}
