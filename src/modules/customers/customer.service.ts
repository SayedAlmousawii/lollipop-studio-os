import {
  BookingStatus,
  CustomerStatus,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import {
  createCustomerSchema,
  type CreateCustomerInput,
  updateCustomerSchema,
  type UpdateCustomerInput,
} from "./customer.schema";
import type { BookingStatus as BookingStatusLabel } from "@/components/bookings/booking-status-badge";
import type { OrderStatusLabel } from "@/modules/orders/order.types";
import type { Customer, CustomerProfile } from "./customer.types";

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
    status: mapCustomerStatus(row.status),
    statusValue: row.status,
    notes: row.notes ?? "",
  }));
}

export async function getCustomerById(
  customerId: string
): Promise<CustomerProfile | null> {
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
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              children: true,
              bookings: true,
              orders: true,
            },
          },
          children: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              name: true,
              dateOfBirth: true,
            },
          },
          bookings: {
            orderBy: { sessionDate: "desc" },
            take: 6,
            select: {
              id: true,
              publicId: true,
              jobNumber: true,
              sessionDate: true,
              sessionType: true,
              status: true,
              package: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
          orders: {
            orderBy: { createdAt: "desc" },
            take: 6,
            select: {
              id: true,
              publicId: true,
              jobNumber: true,
              status: true,
              createdAt: true,
              booking: { select: { sessionDate: true } },
              finalPackage: { select: { name: true } },
              originalPackage: { select: { name: true } },
            },
          },
        },
      }),
    "Failed to fetch customer profile"
  );

  if (!row) return null;

  const bookings = row.bookings.map((booking) => ({
    id: booking.id,
    publicId: booking.publicId,
    jobNumber: booking.jobNumber,
    sessionDate: formatSessionDate(booking.sessionDate),
    sessionType: formatEnum(booking.sessionType),
    department: booking.department.name,
    packageName: booking.package?.name ?? "—",
    status: mapBookingStatus(booking.status),
  }));
  const orders = row.orders.map((order) => ({
    id: order.id,
    publicId: order.publicId,
    jobNumber: order.jobNumber,
    bookingDate: formatSessionDate(order.booking.sessionDate),
    packageName: order.finalPackage?.name ?? order.originalPackage?.name ?? "—",
    status: mapOrderStatus(order.status),
  }));

  return {
    id: row.id,
    fullName: row.name,
    phone: row.phone,
    status: mapCustomerStatus(row.status),
    statusValue: row.status,
    notes: row.notes ?? "",
    createdAt: formatSessionDate(row.createdAt),
    updatedAt: formatSessionDate(row.updatedAt),
    childrenCount: row._count.children,
    bookingsCount: row._count.bookings,
    ordersCount: row._count.orders,
    children: row.children.map((child) => ({
      id: child.id,
      name: child.name,
      dateOfBirth: child.dateOfBirth
        ? formatSessionDate(child.dateOfBirth)
        : "—",
    })),
    bookings,
    orders,
    recentHistory: buildRecentHistory(row.bookings, row.orders),
  };
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

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function mapCustomerStatus(status: CustomerStatus): Customer["status"] {
  return status === CustomerStatus.ACTIVE ? "Active" : "Inactive";
}

function mapBookingStatus(status: BookingStatus): BookingStatusLabel {
  switch (status) {
    case BookingStatus.PENDING:
      return "Pending";
    case BookingStatus.CONFIRMED:
      return "Confirmed";
    case BookingStatus.COMPLETED:
      return "Completed";
    case BookingStatus.CANCELLED:
    case BookingStatus.NO_SHOW:
      return "Cancelled";
  }
}

function mapOrderStatus(status: OrderStatus): OrderStatusLabel {
  switch (status) {
    case OrderStatus.ACTIVE:
      return "Active";
    case OrderStatus.WAITING_SELECTION:
      return "Waiting Selection";
    case OrderStatus.EDITING:
      return "Editing";
    case OrderStatus.PRODUCTION:
      return "Production";
    case OrderStatus.READY:
      return "Ready";
    case OrderStatus.DELIVERED:
      return "Delivered";
    case OrderStatus.CANCELLED:
      return "Cancelled";
  }
}

function buildRecentHistory(
  bookings: Array<{
    id: string;
    publicId: string;
    jobNumber: string;
    sessionDate: Date;
    status: BookingStatus;
  }>,
  orders: Array<{
    id: string;
    publicId: string;
    jobNumber: string;
    createdAt: Date;
    status: OrderStatus;
  }>
): CustomerProfile["recentHistory"] {
  return [
    ...bookings.map((booking) => ({
      id: `booking-${booking.id}`,
      label: `Booking ${booking.publicId}`,
      detail: `Job ${booking.jobNumber} · ${mapBookingStatus(booking.status)}`,
      date: formatSessionDate(booking.sessionDate),
      sortDate: booking.sessionDate,
      href: `/bookings/${booking.id}`,
    })),
    ...orders.map((order) => ({
      id: `order-${order.id}`,
      label: `Order ${order.publicId}`,
      detail: `Job ${order.jobNumber} · ${mapOrderStatus(order.status)}`,
      date: formatSessionDate(order.createdAt),
      sortDate: order.createdAt,
      href: `/orders/${order.id}`,
    })),
  ]
    .sort((left, right) => right.sortDate.getTime() - left.sortDate.getTime())
    .slice(0, 6)
    .map(({ id, label, detail, date, href }) => ({
      id,
      label,
      detail,
      date,
      href,
    }));
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
