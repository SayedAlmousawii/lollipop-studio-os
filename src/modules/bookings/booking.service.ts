import {
  BookingStatus,
  InvoiceStatus,
  PaymentType,
  Prisma,
  UserRole,
} from "@prisma/client";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import {
  createInvoiceForBookingWithClient,
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

export interface BookingPhotographerOption {
  id: string;
  name: string;
}

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
          assignedPhotographer: { select: { name: true } },
          invoices: {
            where: {
              payments: { some: { paymentType: PaymentType.DEPOSIT } },
            },
            take: 1,
            select: { id: true },
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
    department: row.department,
    package: row.package?.name ?? "—",
    status: mapBookingStatus(row.status),
    paymentStatus: mapDepositStatus(row.invoices),
    assignedPhotographerName: row.assignedPhotographer?.name ?? "—",
  }));
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
          assignedPhotographerId: emptyToNull(data.assignedPhotographerId),
        });

        return tx.booking.create({
          data: {
            customerId: data.customerId,
            packageId: data.packageId,
            sessionDate: data.sessionDate,
            sessionType: data.sessionType,
            department: data.department.trim(),
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
          select: { id: true, status: true },
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

        return tx.booking.update({
          where: { id: bookingId },
          data: {
            customerId: data.customerId,
            packageId: data.packageId,
            sessionDate: data.date,
            sessionType: data.sessionType,
            department: data.department.trim(),
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
            invoices: {
              where: {
                payments: { some: { paymentType: PaymentType.DEPOSIT } },
              },
              take: 1,
              select: { id: true },
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

async function validateBookingReferences(
  client: Prisma.TransactionClient,
  input: {
    customerId: string;
    packageId: string;
    assignedPhotographerId: string | null;
  }
): Promise<void> {
  const [customer, pkg, photographer] = await Promise.all([
    client.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true },
    }),
    client.package.findUnique({
      where: { id: input.packageId },
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
  if (input.assignedPhotographerId && !photographer) {
    throw new Error("Assigned photographer not found");
  }
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
    select: { id: true },
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
    sessionType: row.sessionType,
    department: row.department,
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

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
