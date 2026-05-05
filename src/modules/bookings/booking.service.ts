import { BookingStatus, InvoiceStatus, PaymentType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import {
  createInvoiceForOrderWithClient,
  issueInvoiceWithClient,
} from "@/modules/invoices/invoice.service";
import { createOrderFromBookingWithClient } from "@/modules/orders/order.service";
import { recordPaymentWithClient } from "@/modules/payments/payment.service";
import type { Booking } from "@/components/bookings/bookings-table";
import type { BookingStatus as BookingStatusLabel } from "@/components/bookings/booking-status-badge";
import type { PaymentStatus } from "@/components/bookings/payment-status-badge";
import {
  recordBookingDepositSchema,
  updateBookingStatusSchema,
  updateBookingSchema,
  type CreateBookingInput,
  type RecordBookingDepositInput,
  type UpdateBookingStatusInput,
  type UpdateBookingInput,
} from "./booking.schema";

export interface EditableBooking {
  id: string;
  customerId: string;
  customerName: string;
  packageId: string;
  packageName: string;
  packagePriceLabel: string;
  sessionDate: string;
  sessionTime: string;
  sessionType: UpdateBookingInput["sessionType"];
  bookingStatus: BookingStatusLabel;
  depositStatus: "Paid" | "Unpaid";
  notes: string;
  canEdit: boolean;
}

const ALLOWED_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.CANCELLED]: [],
  [BookingStatus.NO_SHOW]: [],
};

export async function getBookings(): Promise<Booking[]> {
  const rows = await withRetry(
    () =>
      db.booking.findMany({
        include: {
          customer: { select: { name: true } },
          package: { select: { name: true } },
          order: {
            include: {
              invoices: {
                where: {
                  payments: { some: { paymentType: PaymentType.DEPOSIT } },
                },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
        orderBy: { sessionDate: "desc" },
      }),
    "Failed to fetch bookings"
  );

  return rows.map((row) => ({
    id: row.id,
    customerName: row.customer.name,
    sessionDate: formatSessionDate(row.sessionDate),
    package: row.package?.name ?? "—",
    status: mapBookingStatus(row.status),
    paymentStatus: mapDepositStatus(row.order?.invoices),
    assignedStaff: "—",
  }));
}

export async function createBookingInDb(
  data: CreateBookingInput
): Promise<{ id: string }> {
  const customer = await db.customer.findUnique({
    where: { id: data.customerId },
    select: { id: true },
  });
  if (!customer) throw new Error("Customer not found");

  const pkg = await db.package.findUnique({
    where: { id: data.packageId },
    select: { id: true, isActive: true },
  });
  if (!pkg) throw new Error("Package not found");
  if (!pkg.isActive) throw new Error("Package is not active");

  return withRetry(
    () =>
      db.booking.create({
        data: {
          customerId: data.customerId,
          packageId: data.packageId,
          sessionDate: data.sessionDate,
          sessionType: data.sessionType,
          notes: data.notes ?? null,
          status: "PENDING",
          depositPaid: false,
        },
        select: { id: true },
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

export async function updateBooking(
  bookingId: string,
  input: UpdateBookingInput
): Promise<EditableBooking> {
  const data = updateBookingSchema.parse(input);

  const row = await withRetry(
    () =>
      db.$transaction(async (tx) => {
        const [booking, customer, selectedPackage] = await Promise.all([
          tx.booking.findUnique({
            where: { id: bookingId },
            select: { id: true, status: true },
          }),
          tx.customer.findUnique({
            where: { id: data.customerId },
            select: { id: true },
          }),
          tx.package.findUnique({
            where: { id: data.packageId },
            select: { id: true },
          }),
        ]);

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
        if (!customer) {
          throw new Error("Customer not found");
        }
        if (!selectedPackage) {
          throw new Error("Package not found");
        }

        return tx.booking.update({
          where: { id: bookingId },
          data: {
            customer: { connect: { id: data.customerId } },
            package: { connect: { id: data.packageId } },
            sessionDate: data.date,
            sessionType: data.sessionType,
            notes: data.notes?.trim() ? data.notes.trim() : null,
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
  nextStatus: UpdateBookingStatusInput["nextStatus"]
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
            order: {
              select: {
                invoices: {
                  where: {
                    payments: { some: { paymentType: PaymentType.DEPOSIT } },
                  },
                  take: 1,
                  select: { id: true },
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
          !hasDepositPayment(booking.order?.invoices)
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
          await createOrderFromBookingWithClient(tx, data.bookingId);
        }

        return updatedBooking;
      }),
    "Failed to update booking status",
    2
  );
}

export async function recordBookingDeposit(
  input: RecordBookingDepositInput
): Promise<{ id: string }> {
  const data = recordBookingDepositSchema.parse(input);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        await lockBookingForDeposit(tx, data.bookingId);

        const booking = await tx.booking.findUnique({
          where: { id: data.bookingId },
          select: {
            id: true,
            status: true,
            order: {
              select: {
                id: true,
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
            },
          },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }
        if (booking.status !== BookingStatus.PENDING) {
          throw new Error("Deposit can only be recorded for pending bookings");
        }
        if (hasDepositPayment(booking.order?.invoices)) {
          throw new Error("Deposit already recorded");
        }

        const order =
          booking.order ??
          (await createOrderFromBookingWithClient(tx, booking.id));
        const invoice =
          booking.order?.invoices[0] ??
          (await createInvoiceForOrderWithClient(tx, order.id));
        if (invoice.status === InvoiceStatus.DRAFT) {
          await issueInvoiceWithClient(tx, invoice.id);
        }

        return recordPaymentWithClient(tx, invoice.id, {
          amount: data.amount,
          method: data.method,
          paymentType: PaymentType.DEPOSIT,
          reference: data.reference,
        });
      }),
    "Failed to record booking deposit",
    2
  );
}

async function lockBookingForDeposit(
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
  order: {
    select: {
      invoices: {
        where: {
          payments: { some: { paymentType: PaymentType.DEPOSIT } },
        },
        take: 1,
        select: { id: true },
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
    case "NO_SHOW":
      return "Cancelled";
  }
}

function mapEditableBooking(
  row: NonNullable<Awaited<ReturnType<typeof fetchEditableBookingById>>>
): EditableBooking {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customer.name,
    packageId: row.package?.id ?? "",
    packageName: row.package?.name ?? "—",
    packagePriceLabel: row.package ? formatPrice(row.package.price) : "—",
    sessionDate: formatInputDate(row.sessionDate),
    sessionTime: formatInputTime(row.sessionDate),
    sessionType: mapEditableSessionType(row.sessionType),
    bookingStatus: mapBookingStatus(row.status),
    depositStatus: hasDepositPayment(row.order?.invoices) ? "Paid" : "Unpaid",
    notes: row.notes ?? "",
    canEdit:
      row.status !== BookingStatus.COMPLETED &&
      row.status !== BookingStatus.CANCELLED &&
      row.status !== BookingStatus.NO_SHOW,
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
  return (
    invoices?.some((invoice) => !invoice.payments || invoice.payments.length > 0) ??
    false
  );
}

function mapEditableSessionType(
  sessionType: "NEWBORN" | "KIDS" | "FAMILY" | "MATERNITY" | "OTHER"
): UpdateBookingInput["sessionType"] {
  return sessionType;
}

function formatInputDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatInputTime(date: Date): string {
  return date.toISOString().slice(11, 16);
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
