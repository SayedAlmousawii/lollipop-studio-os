import {
  BookingStatus,
  InvoiceStatus,
  OrderActivityType,
  OrderStatus,
  PaymentType,
  Prisma,
  UserRole,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import {
  createInvoiceForBookingWithClient,
  issueInvoiceWithClient,
} from "@/modules/invoices/invoice.service";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import {
  generateJobNumber,
  generatePublicId,
} from "@/modules/identifiers/identifier.service";
import { recordOrderActivity } from "@/modules/orders/order-activity.service";
import { createOrderFromBookingWithClient } from "@/modules/orders/order.service";
import { recordPaymentWithClient } from "@/modules/payments/payment.service";
import type { Booking } from "@/components/bookings/bookings-table";
import type { BookingStatus as BookingStatusLabel } from "@/components/bookings/booking-status-badge";
import type { PaymentStatus } from "@/components/bookings/payment-status-badge";
import {
  recordBasePaymentSchema,
  recordBookingDepositSchema,
  updateBookingStatusSchema,
  updateBookingSchema,
  type CreateBookingInput,
  type RecordBasePaymentInput,
  type RecordBookingDepositInput,
  type UpdateBookingStatusInput,
  type UpdateBookingInput,
} from "./booking.schema";

export interface BookingPhotographerOption {
  id: string;
  name: string;
}

export type BookingStatusFilter =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED";

export type BookingDateFilter = "today" | "week" | "month";

export interface BookingFilters {
  search?: string;
  status?: BookingStatusFilter;
  date?: BookingDateFilter;
  packageId?: string;
}

export interface BookingFilterOption {
  id: string;
  name: string;
}

export interface EditableBooking {
  id: string;
  jobNumber: string;
  customerId: string;
  customerName: string;
  packageId: string;
  packageName: string;
  packagePriceLabel: string;
  sessionDate: string;
  sessionTime: string;
  sessionType: UpdateBookingInput["sessionType"];
  departmentId: string;
  department: string;
  assignedPhotographerId: string;
  assignedPhotographerName: string;
  bookingStatus: BookingStatusLabel;
  depositStatus: "Paid" | "Unpaid";
  notes: string;
  themes: Array<{
    themeName: string;
    notes: string;
  }>;
  canEdit: boolean;
}

export interface BookingDetail {
  id: string;
  jobNumber: string;
  customerName: string;
  sessionDate: string;
  sessionTime: string;
  sessionType: string;
  packageName: string;
  packagePriceLabel: string;
  department: string;
  assignedPhotographerName: string;
  bookingStatus: BookingStatusLabel;
  depositStatus: PaymentStatus;
  notes: string;
  themes: Array<{
    id: string;
    themeName: string;
    notes: string;
  }>;
  canEdit: boolean;
  canRecordDeposit: boolean;
  canRecordBasePayment: boolean;
  packagePriceAmount: number;
  depositPaidAmount: number;
}

const ALLOWED_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.CANCELLED, BookingStatus.NO_SHOW],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.CANCELLED]: [],
  [BookingStatus.NO_SHOW]: [],
};

const BOOKING_STATUS_FILTERS = new Set<BookingStatusFilter>([
  "PENDING",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
]);

const BOOKING_DATE_FILTERS = new Set<BookingDateFilter>([
  "today",
  "week",
  "month",
]);

export function parseBookingFilters(filters: {
  search?: string | string[];
  status?: string | string[];
  date?: string | string[];
  packageId?: string | string[];
}): BookingFilters {
  const search = singleValue(filters.search)?.trim();
  const status = singleValue(filters.status);
  const date = singleValue(filters.date);
  const packageId = singleValue(filters.packageId)?.trim();

  return {
    search: search ? search : undefined,
    status:
      status && BOOKING_STATUS_FILTERS.has(status as BookingStatusFilter)
        ? (status as BookingStatusFilter)
        : undefined,
    date:
      date && BOOKING_DATE_FILTERS.has(date as BookingDateFilter)
        ? (date as BookingDateFilter)
        : undefined,
    packageId: packageId ? packageId : undefined,
  };
}

export async function getBookings(filters: BookingFilters = {}): Promise<Booking[]> {
  const rows = await withRetry(
    () => {
      const where = buildBookingsWhere(filters);

      return db.booking.findMany({
        where,
        include: {
          customer: { select: { name: true } },
          package: { select: { name: true, price: true } },
          department: { select: { name: true } },
          assignedPhotographer: { select: { name: true } },
          invoices: {
            where: {
              payments: { some: { paymentType: PaymentType.DEPOSIT } },
            },
            take: 1,
            select: {
              id: true,
              payments: {
                where: { paymentType: PaymentType.DEPOSIT },
                select: { id: true, amount: true },
                take: 1,
              },
            },
          },
        },
        orderBy: { sessionDate: "desc" },
      });
    },
    "Failed to fetch bookings"
  );

  return rows.map((row) => ({
    id: row.id,
    jobNumber: row.jobNumber,
    customerName: row.customer.name,
    sessionDate: formatSessionDate(row.sessionDate),
    sessionTime: row.sessionTime,
    department: row.department.name,
    package: row.package?.name ?? "—",
    status: mapBookingStatus(row.status),
    paymentStatus: mapDepositStatus(row.invoices),
    assignedPhotographerName: row.assignedPhotographer?.name ?? "—",
    packagePriceAmount: row.package?.price?.toNumber() ?? 0,
    depositPaidAmount: row.invoices[0]?.payments?.[0]?.amount?.toNumber() ?? 0,
  }));
}

export async function getBookingFilterOptions(): Promise<BookingFilterOption[]> {
  return withRetry(
    () =>
      db.package.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    "Failed to fetch booking filter options"
  );
}

export async function getAssignablePhotographers(): Promise<
  BookingPhotographerOption[]
> {
  return withRetry(
    () =>
      db.user.findMany({
        where: { role: UserRole.PHOTOGRAPHER },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    "Failed to fetch photographers"
  );
}

export async function createBookingInDb(
  data: CreateBookingInput
): Promise<{ id: string }> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        await validateBookingReferences(tx, {
          customerId: data.customerId,
          packageId: data.packageId,
          departmentId: data.departmentId,
          requireActiveDepartment: true,
          assignedPhotographerId: emptyToNull(data.assignedPhotographerId),
        });
        const department = await tx.studioDepartment.findUnique({
          where: { id: data.departmentId },
          select: { code: true },
        });
        if (!department) {
          throw new Error("Department not found");
        }
        const [publicId, jobNumber] = await Promise.all([
          generatePublicId(tx, PUBLIC_ID_KIND.BOOKING),
          generateJobNumber(tx, {
            departmentCode: department.code,
            sessionDate: data.sessionDate,
          }),
        ]);
        const job = await tx.job.create({
          data: {
            jobNumber,
            customerId: data.customerId,
          },
          select: { id: true },
        });

        return tx.booking.create({
          data: {
            publicId,
            jobNumber,
            jobId: job.id,
            customerId: data.customerId,
            packageId: data.packageId,
            sessionDate: data.sessionDate,
            sessionTime: data.sessionTime,
            sessionType: data.sessionType,
            departmentId: data.departmentId,
            assignedPhotographerId:
              emptyToNull(data.assignedPhotographerId) ?? null,
            notes: emptyToNull(data.notes) ?? null,
            status: BookingStatus.PENDING,
            themes: {
              create: data.themes.map((theme) => ({
                themeName: theme.themeName.trim(),
                notes: emptyToNull(theme.notes) ?? null,
              })),
            },
          },
          select: { id: true },
        });
      }),
    "Failed to create booking",
    2
  );
}

export async function getEditableBookingById(
  bookingId: string
): Promise<EditableBooking | null> {
  const row = await withRetry(
    () => fetchEditableBookingById(bookingId),
    "Failed to fetch editable booking"
  );

  if (!row) return null;
  return mapEditableBooking(row);
}

export async function getBookingById(
  bookingId: string
): Promise<BookingDetail | null> {
  const row = await withRetry(
    () => fetchEditableBookingById(bookingId),
    "Failed to fetch booking"
  );

  if (!row) return null;
  return mapBookingDetail(row);
}

export async function updateBooking(
  bookingId: string,
  input: UpdateBookingInput
): Promise<EditableBooking> {
  const data = updateBookingSchema.parse(input);

  const row = await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          select: { id: true, status: true, departmentId: true, jobId: true },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }
        if (booking.status === BookingStatus.COMPLETED) {
          throw new Error("Completed bookings cannot be edited");
        }
        if (
          booking.status === BookingStatus.CANCELLED ||
          booking.status === BookingStatus.NO_SHOW
        ) {
          throw new Error("Cancelled bookings cannot be edited");
        }

        await validateBookingReferences(tx, {
          customerId: data.customerId,
          packageId: data.packageId,
          departmentId: data.departmentId,
          requireActiveDepartment: data.departmentId !== booking.departmentId,
          assignedPhotographerId: emptyToNull(data.assignedPhotographerId),
        });

        const existingThemes = await tx.bookingTheme.findMany({
          where: { bookingId },
          select: { themeName: true, notes: true },
        });

        const themesWithPreservedNotes = data.themes.map((theme) => {
          const normalizedName = theme.themeName.trim().toLowerCase();
          const existingTheme = existingThemes.find(
            (item) => item.themeName.trim().toLowerCase() === normalizedName
          );

          return {
            themeName: theme.themeName.trim(),
            notes: emptyToNull(theme.notes) ?? existingTheme?.notes ?? null,
          };
        });

        await tx.job.update({
          where: { id: booking.jobId },
          data: { customerId: data.customerId },
        });

        return tx.booking.update({
          where: { id: bookingId },
          data: {
            customerId: data.customerId,
            packageId: data.packageId,
            sessionDate: data.date,
            sessionTime: data.sessionTime,
            sessionType: data.sessionType,
            departmentId: data.departmentId,
            assignedPhotographerId:
              emptyToNull(data.assignedPhotographerId) ?? null,
            notes: emptyToNull(data.notes) ?? null,
            themes: {
              deleteMany: {},
              create: themesWithPreservedNotes,
            },
          },
          include: editableBookingInclude,
        });
      }),
    "Failed to update booking",
    2
  );

  return mapEditableBooking(row);
}

export async function updateBookingStatus(
  bookingId: string,
  nextStatus: UpdateBookingStatusInput["nextStatus"],
  actorContext: ActorContext = {}
) {
  const data = updateBookingStatusSchema.parse({ bookingId, nextStatus });

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: data.bookingId },
          select: {
            id: true,
            status: true,
            jobId: true,
            invoices: {
              where: { parentInvoiceId: null },
              select: {
                id: true,
                isLocked: true,
                payments: {
                  where: { paymentType: PaymentType.DEPOSIT },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }

        validateStatusTransition(booking.status, data.nextStatus);

        if (
          data.nextStatus === BookingStatus.CONFIRMED &&
          !hasDepositPayment(booking.invoices)
        ) {
          throw new Error(
            "Booking cannot be confirmed until the deposit is recorded."
          );
        }

        const updatedBooking = await tx.booking.update({
          where: { id: data.bookingId },
          data: { status: data.nextStatus },
        });

        if (data.nextStatus === BookingStatus.COMPLETED) {
          await createOrderFromBookingWithClient(
            tx,
            data.bookingId,
            OrderStatus.ACTIVE,
            actorContext
          );
        }

        if (data.nextStatus === BookingStatus.NO_SHOW) {
          await tx.invoice.updateMany({
            where: {
              bookingId: booking.id,
              jobId: booking.jobId,
              parentInvoiceId: null,
              isLocked: false,
            },
            data: {
              status: InvoiceStatus.CLOSED,
              isLocked: true,
              closedAt: new Date(),
            },
          });
        }

        return updatedBooking;
      }),
    "Failed to update booking status",
    2
  );
}

export async function recordBookingDeposit(
  input: RecordBookingDepositInput,
  actorContext: ActorContext = {}
): Promise<{ id: string }> {
  const data = recordBookingDepositSchema.parse(input);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        await lockBookingForUpdate(tx, data.bookingId);

        const booking = await tx.booking.findUnique({
          where: { id: data.bookingId },
          select: {
            id: true,
            status: true,
            invoices: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                status: true,
                payments: {
                  where: { paymentType: PaymentType.DEPOSIT },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }
        if (booking.status !== BookingStatus.PENDING) {
          throw new Error("Deposit can only be recorded for pending bookings");
        }
        if (hasDepositPayment(booking.invoices)) {
          throw new Error("Deposit already recorded");
        }

        const invoice =
          booking.invoices[0] ??
          (await createInvoiceForBookingWithClient(tx, booking.id));
        if (invoice.status === InvoiceStatus.DRAFT) {
          await issueInvoiceWithClient(tx, invoice.id);
        }

        const payment = await recordPaymentWithClient(tx, invoice.id, {
          amount: data.amount,
          method: data.method,
          paymentType: PaymentType.DEPOSIT,
          reference: data.reference,
        }, actorContext);

        await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.CONFIRMED },
        });

        return payment;
      }),
    "Failed to record booking deposit",
    2
  );
}

export async function recordBasePaymentAndComplete(
  input: RecordBasePaymentInput,
  actorContext: ActorContext = {}
): Promise<{ orderId: string }> {
  const data = recordBasePaymentSchema.parse(input);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        await lockBookingForUpdate(tx, data.bookingId);

        const booking = await tx.booking.findUnique({
          where: { id: data.bookingId },
          select: {
            id: true,
            status: true,
            invoices: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                status: true,
              },
              take: 1,
            },
          },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }
        if (booking.status !== BookingStatus.CONFIRMED) {
          throw new Error(
            "Base payment can only be recorded for confirmed bookings"
          );
        }

        const invoice =
          booking.invoices[0] ??
          (await createInvoiceForBookingWithClient(tx, booking.id));
        if (invoice.status === InvoiceStatus.DRAFT) {
          await issueInvoiceWithClient(tx, invoice.id);
        }

        const payment = await recordPaymentWithClient(tx, invoice.id, {
          amount: data.amount,
          method: data.method,
          paymentType: PaymentType.BASE,
          notes: data.notes,
        }, actorContext);

        await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.COMPLETED },
        });

        const order = await createOrderFromBookingWithClient(
          tx,
          booking.id,
          OrderStatus.WAITING_SELECTION,
          actorContext
        );

        await recordOrderActivity(tx, {
          orderId: order.id,
          userId: actorContext.actorUserId ?? null,
          type: OrderActivityType.PAYMENT_RECEIVED,
          title: "Base payment recorded",
          description: `${new Prisma.Decimal(data.amount).toFixed(3)} KD base payment recorded before selection opened.`,
          metadata: {
            bookingId: booking.id,
            invoiceId: invoice.id,
            paymentId: payment.id,
            amount: new Prisma.Decimal(data.amount).toFixed(3),
            method: data.method,
            paymentType: PaymentType.BASE,
            notes: data.notes ?? null,
          },
        });

        await recordOrderActivity(tx, {
          orderId: order.id,
          userId: actorContext.actorUserId ?? null,
          type: OrderActivityType.NOTE_ADDED,
          title: "Booking completed",
          description:
            "Booking moved from Confirmed to Completed after the base payment was recorded.",
          metadata: {
            bookingId: booking.id,
            previousStatus: BookingStatus.CONFIRMED,
            nextStatus: BookingStatus.COMPLETED,
          },
        });

        return { orderId: order.id };
      }),
    "Failed to record base payment",
    2
  );
}

async function validateBookingReferences(
  client: Prisma.TransactionClient,
  input: {
    customerId: string;
    packageId: string;
    departmentId: string;
    requireActiveDepartment: boolean;
    assignedPhotographerId: string | null;
  }
): Promise<void> {
  const [customer, pkg, department, photographer] = await Promise.all([
    client.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true },
    }),
    client.package.findUnique({
      where: { id: input.packageId },
      select: { id: true, isActive: true },
    }),
    client.studioDepartment.findUnique({
      where: { id: input.departmentId },
      select: { id: true, isActive: true },
    }),
    input.assignedPhotographerId
      ? client.user.findFirst({
          where: {
            id: input.assignedPhotographerId,
            role: UserRole.PHOTOGRAPHER,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (!customer) {
    throw new Error("Customer not found");
  }
  if (!pkg) {
    throw new Error("Package not found");
  }
  if (!pkg.isActive) {
    throw new Error("Package is not active");
  }
  if (!department) {
    throw new Error("Department not found");
  }
  if (input.requireActiveDepartment && !department.isActive) {
    throw new Error("Department is not active");
  }
  if (input.assignedPhotographerId && !photographer) {
    throw new Error("Assigned photographer not found");
  }
}

async function lockBookingForUpdate(
  client: Prisma.TransactionClient,
  bookingId: string
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "bookings" WHERE id = ${bookingId} FOR UPDATE
  `;
}

function validateStatusTransition(
  currentStatus: BookingStatus,
  nextStatus: BookingStatus
): void {
  if (!ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new Error(
      `Invalid booking status transition from ${formatEnum(currentStatus)} to ${formatEnum(nextStatus)}`
    );
  }
}

const editableBookingInclude = {
  customer: { select: { name: true } },
  package: {
    select: {
      id: true,
      name: true,
      price: true,
    },
  },
  department: {
    select: { id: true, name: true, code: true },
  },
  assignedPhotographer: {
    select: { id: true, name: true },
  },
  themes: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      themeName: true,
      notes: true,
    },
  },
  invoices: {
    where: {
      payments: { some: { paymentType: PaymentType.DEPOSIT } },
    },
    take: 1,
    select: {
      id: true,
      status: true,
      payments: {
        where: { paymentType: PaymentType.DEPOSIT },
        select: { id: true, amount: true },
        take: 1,
      },
    },
  },
} satisfies Prisma.BookingInclude;

async function fetchEditableBookingById(bookingId: string) {
  return db.booking.findUnique({
    where: { id: bookingId },
    include: editableBookingInclude,
  });
}

function buildBookingsWhere(filters: BookingFilters): Prisma.BookingWhereInput {
  const search = filters.search;
  const searchClause = search
    ? (() => {
        const containsFilter = {
          contains: search,
          mode: Prisma.QueryMode.insensitive,
        };

        return {
          OR: [
            {
              customer: {
                is: { name: containsFilter },
              },
            },
            { jobNumber: containsFilter },
            {
              package: {
                is: { name: containsFilter },
              },
            },
            {
              department: {
                is: {
                  OR: [{ name: containsFilter }, { code: containsFilter }],
                },
              },
            },
            {
              assignedPhotographer: {
                is: { name: containsFilter },
              },
            },
          ],
        };
      })()
    : undefined;

  return {
    ...(searchClause ?? {}),
    ...(filters.packageId ? { packageId: filters.packageId } : {}),
    ...(filters.status
      ? {
          status:
            filters.status === "CANCELLED"
              ? { in: [BookingStatus.CANCELLED, BookingStatus.NO_SHOW] }
              : filters.status,
        }
      : {}),
    ...(filters.date ? buildSessionDateRange(filters.date) : {}),
  };
}

function buildSessionDateRange(
  filter: BookingDateFilter
): Pick<Prisma.BookingWhereInput, "sessionDate"> {
  const todayStart = startOfLocalDay(new Date());

  if (filter === "today") {
    return {
      sessionDate: {
        gte: todayStart,
        lt: addDays(todayStart, 1),
      },
    };
  }

  if (filter === "week") {
    const dayOfWeek = todayStart.getDay();
    const offsetToMonday = (dayOfWeek + 6) % 7;
    const weekStart = addDays(todayStart, -offsetToMonday);

    return {
      sessionDate: {
        gte: weekStart,
        lt: addDays(weekStart, 7),
      },
    };
  }

  const monthStart = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth(),
    1
  );
  const nextMonthStart = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth() + 1,
    1
  );

  return {
    sessionDate: {
      gte: monthStart,
      lt: nextMonthStart,
    },
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

function mapBookingStatus(
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"
): BookingStatusLabel {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "CONFIRMED":
      return "Confirmed";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "NO_SHOW":
      return "No-Show";
  }
}

function mapEditableBooking(
  row: NonNullable<Awaited<ReturnType<typeof fetchEditableBookingById>>>
): EditableBooking {
  return {
    id: row.id,
    jobNumber: row.jobNumber,
    customerId: row.customerId,
    customerName: row.customer.name,
    packageId: row.package?.id ?? "",
    packageName: row.package?.name ?? "—",
    packagePriceLabel: row.package ? formatPrice(row.package.price) : "—",
    sessionDate: formatInputDate(row.sessionDate),
    sessionTime: row.sessionTime,
    sessionType: row.sessionType,
    departmentId: row.department.id,
    department: row.department.name,
    assignedPhotographerId: row.assignedPhotographer?.id ?? "",
    assignedPhotographerName: row.assignedPhotographer?.name ?? "—",
    bookingStatus: mapBookingStatus(row.status),
    depositStatus: hasDepositPayment(row.invoices) ? "Paid" : "Unpaid",
    notes: row.notes ?? "",
    themes: row.themes.map((theme) => ({
      themeName: theme.themeName,
      notes: theme.notes ?? "",
    })),
    canEdit:
      row.status !== BookingStatus.COMPLETED &&
      row.status !== BookingStatus.CANCELLED &&
      row.status !== BookingStatus.NO_SHOW,
  };
}

function mapBookingDetail(
  row: NonNullable<Awaited<ReturnType<typeof fetchEditableBookingById>>>
): BookingDetail {
  const hasDeposit = hasDepositPayment(row.invoices);
  const depositPaidAmount =
    row.invoices[0]?.payments?.[0]?.amount?.toNumber() ?? 0;
  const packagePriceAmount = row.package?.price?.toNumber() ?? 0;

  return {
    id: row.id,
    jobNumber: row.jobNumber,
    customerName: row.customer.name,
    sessionDate: formatSessionDate(row.sessionDate),
    sessionTime: row.sessionTime,
    sessionType: formatEnum(row.sessionType),
    packageName: row.package?.name ?? "—",
    packagePriceLabel: row.package ? formatPrice(row.package.price) : "—",
    department: row.department.name,
    assignedPhotographerName: row.assignedPhotographer?.name ?? "—",
    bookingStatus: mapBookingStatus(row.status),
    depositStatus: hasDeposit ? "Paid" : "Unpaid",
    notes: row.notes ?? "",
    themes: row.themes.map((theme) => ({
      id: theme.id,
      themeName: theme.themeName,
      notes: theme.notes ?? "",
    })),
    canEdit:
      row.status !== BookingStatus.COMPLETED &&
      row.status !== BookingStatus.CANCELLED &&
      row.status !== BookingStatus.NO_SHOW,
    canRecordDeposit: row.status === BookingStatus.PENDING && !hasDeposit,
    canRecordBasePayment: row.status === BookingStatus.CONFIRMED,
    packagePriceAmount,
    depositPaidAmount,
  };
}

function mapDepositStatus(
  invoices:
    | Array<{ id: string; payments?: Array<{ id: string }> }>
    | null
    | undefined
): PaymentStatus {
  return hasDepositPayment(invoices) ? "Paid" : "Unpaid";
}

function hasDepositPayment(
  invoices:
    | Array<{ id: string; payments?: Array<{ id: string }> }>
    | null
    | undefined
): boolean {
  return invoices?.some((invoice) => (invoice.payments?.length ?? 0) > 0) ?? false;
}

function formatInputDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatPrice(value: { toFixed(dp: number): string }): string {
  return `${value.toFixed(3)} KD`;
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
