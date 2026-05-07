import { CustomerStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import type { Customer } from "./customer.types";

export interface CustomerFilters {
  search?: string;
  status?: CustomerStatus;
}

const CUSTOMER_STATUS_FILTERS = new Set<CustomerStatus>([
  CustomerStatus.ACTIVE,
  CustomerStatus.INACTIVE,
]);

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
