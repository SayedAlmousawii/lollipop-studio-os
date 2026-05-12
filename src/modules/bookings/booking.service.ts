import {
  BookingStatus,
  InvoiceStatus,
  InvoiceType,
  OrderStatus,
  PaymentType,
  Prisma,
  UserRole,
} from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import {
  generateInvoiceNumber,
  issueInvoiceWithClient,
  recalculateInvoiceStatus,
} from "@/modules/invoices/invoice.service";
import { PUBLIC_ID_KIND } from "@/modules/identifiers/identifier.constants";
import {
  generateBookingReference,
  generateJobNumber,
  generatePublicId,
} from "@/modules/identifiers/identifier.service";
import { createOrderFromBookingWithClient } from "@/modules/orders/order.service";
import { recordPaymentWithClient } from "@/modules/payments/payment.service";
import { formatCustomerPhone } from "@/modules/customers/customer.utils";
import type { Booking } from "@/components/bookings/bookings-table";
import type { BookingStatus as BookingStatusLabel } from "@/components/bookings/booking-status-badge";
import type { PaymentStatus } from "@/components/bookings/payment-status-badge";
import {
  checkInBookingSchema,
  deletePendingBookingSchema,
  recordBookingDepositSchema,
  updateBookingStatusSchema,
  updateBookingSchema,
  type CheckInBookingInput,
  type CreateBookingInput,
  type DeletePendingBookingInput,
  type RecordBookingDepositInput,
  type UpdateBookingStatusInput,
  type UpdateBookingInput,
} from "./booking.schema";

export interface BookingPhotographerOption {
  id: string;
  name: string;
}

export type RecommendedPhotographer = BookingPhotographerOption | null;

export type BookingStatusFilter =
  | "PENDING"
  | "CONFIRMED"
  | "CHECKED_IN"
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
  customerPhone: string;
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
  customerId: string;
  status: BookingStatus;
  bookingReference: string;
  jobNumber: string | null;
  orderId: string | null;
  customerPhone: string;
  sessionDate: string;
  sessionTime: string;
  sessionType: string;
  packageName: string;
  packagePriceLabel: string;
  department: string;
  assignedPhotographerId: string;
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
  canDeletePending: boolean;
  canCheckIn: boolean;
  isCheckedIn: boolean;
  depositInvoice: {
    id: string;
    invoiceNumber: string;
    totalAmount: string;
    paidAmount: string;
    status: InvoiceStatus;
    isLocked: boolean;
  } | null;
  packageRemainingBalanceLabel: string | null;
}

const ALLOWED_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED],
  [BookingStatus.CONFIRMED]: [BookingStatus.CANCELLED, BookingStatus.NO_SHOW],
  [BookingStatus.CHECKED_IN]: [],
  [BookingStatus.CANCELLED]: [],
  [BookingStatus.NO_SHOW]: [],
};

const BOOKING_STATUS_FILTERS = new Set<BookingStatusFilter>([
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "CANCELLED",
]);

const BOOKING_DATE_FILTERS = new Set<BookingDateFilter>([
  "today",
  "week",
  "month",
]);

const BOOKING_DEPOSIT_AMOUNT = new Prisma.Decimal(20);

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

export async function getBookings(
  filters: BookingFilters = {}
): Promise<Booking[]> {
  const rows = await withRetry(
    () => {
      const where = buildBookingsWhere(filters);

      return db.booking.findMany({
        where,
        include: {
          customer: { select: { phone: true } },
          package: { select: { name: true, price: true } },
          department: { select: { name: true } },
          assignedPhotographer: { select: { id: true, name: true } },
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

  const recommendedByCustomer = new Map<string, RecommendedPhotographer>();

  return Promise.all(rows.map(async (row) => {
    const paymentStatus = mapDepositStatus(row.invoices);
    let recommendedPhotographer: RecommendedPhotographer = null;
    if (row.status === BookingStatus.CONFIRMED) {
      if (recommendedByCustomer.has(row.customerId)) {
        recommendedPhotographer = recommendedByCustomer.get(row.customerId) ?? null;
      } else {
        recommendedPhotographer = await getRecommendedPhotographer(row.customerId);
        recommendedByCustomer.set(row.customerId, recommendedPhotographer);
      }
    }

    return {
      id: row.id,
      customerId: row.customerId,
      jobNumber: row.jobNumber ?? row.publicId ?? "Pending",
      customerPhone: formatCustomerPhone(row.customer.phone),
      sessionDate: formatSessionDate(row.sessionDate),
      sessionTime: row.sessionTime,
      department: row.department.name,
      package: row.package?.name ?? "—",
      status: mapBookingStatus(row.status),
      paymentStatus,
      assignedPhotographerId: row.assignedPhotographer?.id ?? "",
      assignedPhotographerName: row.assignedPhotographer?.name ?? "—",
      recommendedPhotographer,
      canDeletePending:
        row.status === BookingStatus.PENDING && paymentStatus !== "Paid",
      canCheckIn: row.status === BookingStatus.CONFIRMED,
    };
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

export async function getRecommendedPhotographer(
  customerId: string
): Promise<RecommendedPhotographer> {
  if (!customerId.trim()) return null;

  const rows = await withRetry(
    () =>
      db.booking.findMany({
        where: {
          customerId,
          assignedPhotographerId: { not: null },
        },
        select: {
          assignedPhotographerId: true,
          assignedPhotographer: { select: { id: true, name: true } },
        },
      }),
    "Failed to fetch recommended photographer"
  );

  const counts = new Map<string, { photographer: BookingPhotographerOption; count: number }>();
  for (const row of rows) {
    if (!row.assignedPhotographerId || !row.assignedPhotographer) continue;
    const current = counts.get(row.assignedPhotographerId);
    counts.set(row.assignedPhotographerId, {
      photographer: row.assignedPhotographer,
      count: (current?.count ?? 0) + 1,
    });
  }

  let recommendation: { photographer: BookingPhotographerOption; count: number } | null = null;
  for (const item of counts.values()) {
    if (!recommendation || item.count > recommendation.count) {
      recommendation = item;
    }
  }

  return recommendation?.photographer ?? null;
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

        return tx.booking.create({
          data: {
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
        if (booking.status === BookingStatus.CHECKED_IN) {
          throw new Error("Checked-in bookings cannot be edited");
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

        if (booking.jobId) {
          await tx.job.update({
            where: { id: booking.jobId },
            data: { customerId: data.customerId },
          });
        }

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
  if (!new Prisma.Decimal(data.amount).equals(BOOKING_DEPOSIT_AMOUNT)) {
    throw new Error("Booking deposit must be exactly 20.000 KD");
  }

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        await lockBookingForUpdate(tx, data.bookingId);

        const booking = await tx.booking.findUnique({
          where: { id: data.bookingId },
          select: {
            id: true,
            customerId: true,
            sessionDate: true,
            status: true,
            department: { select: { code: true } },
            invoices: {
              where: {
                payments: { some: { paymentType: PaymentType.DEPOSIT } },
              },
              select: {
                id: true,
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

        const bookingReference = await generateBookingReference(tx, {
          departmentCode: booking.department.code,
          sessionDate: booking.sessionDate,
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: { publicId: bookingReference },
        });

        const financialCase = await tx.financialCase.create({
          data: {
            bookingId: booking.id,
            customerId: booking.customerId,
            jobId: null,
          },
          select: { id: true },
        });

        const invoiceNumberData = await generateInvoiceNumber(tx);
        const invoice = await tx.invoice.create({
          data: {
            publicId: await generatePublicId(tx, PUBLIC_ID_KIND.INVOICE),
            financialCaseId: financialCase.id,
            invoiceType: InvoiceType.DEPOSIT,
            jobId: null,
            jobNumber: null,
            orderId: null,
            bookingId: booking.id,
            customerId: booking.customerId,
            ...invoiceNumberData,
            totalAmount: BOOKING_DEPOSIT_AMOUNT,
            remainingAmount: BOOKING_DEPOSIT_AMOUNT,
            status: InvoiceStatus.DRAFT,
          },
          select: { id: true, status: true },
        });

        await issueInvoiceWithClient(tx, invoice.id, actorContext);

        const payment = await recordPaymentWithClient(tx, invoice.id, {
          financialCaseId: financialCase.id,
          amount: BOOKING_DEPOSIT_AMOUNT.toNumber(),
          method: data.method,
          paymentType: PaymentType.DEPOSIT,
          reference: data.reference,
        }, actorContext);

        await recalculateInvoiceStatus(invoice.id, tx);
        const paidInvoice = await tx.invoice.findUnique({
          where: { id: invoice.id },
          select: { status: true },
        });
        if (paidInvoice?.status !== InvoiceStatus.PAID) {
          throw new Error("Deposit invoice was not fully paid");
        }

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.CLOSED,
            isLocked: true,
            closedAt: new Date(),
          },
        });

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

export async function checkInBooking(
  input: CheckInBookingInput,
  actorContext: ActorContext = {}
): Promise<{ orderId: string }> {
  const data = checkInBookingSchema.parse(input);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        await lockBookingForUpdate(tx, data.bookingId);

        const booking = await tx.booking.findUnique({
          where: { id: data.bookingId },
          select: {
            id: true,
            customerId: true,
            sessionDate: true,
            status: true,
            jobId: true,
            jobNumber: true,
            department: { select: { code: true } },
            order: { select: { id: true } },
            financialCase: { select: { id: true, jobId: true } },
          },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }
        if (booking.status !== BookingStatus.CONFIRMED) {
          throw new Error("Only confirmed bookings can be checked in");
        }
        if (booking.jobId || booking.jobNumber) {
          throw new Error("Booking has already been checked in");
        }
        if (booking.order) {
          throw new Error("Booking already has an order");
        }
        if (!booking.financialCase) {
          throw new Error("Booking financial case is required before check-in");
        }
        if (booking.financialCase.jobId) {
          throw new Error("Booking financial case is already linked to a job");
        }

        const photographer = await tx.user.findFirst({
          where: {
            id: data.assignedPhotographerId,
            role: UserRole.PHOTOGRAPHER,
          },
          select: { id: true },
        });
        if (!photographer) {
          throw new Error("Assigned photographer not found");
        }

        const jobNumber = await generateJobNumber(tx, {
          departmentCode: booking.department.code,
          sessionDate: booking.sessionDate,
        });
        const job = await tx.job.create({
          data: {
            jobNumber,
            customerId: booking.customerId,
            assignedPhotographerId: data.assignedPhotographerId,
            socialMediaConsent: data.socialMediaConsent,
          },
          select: { id: true },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            jobId: job.id,
            jobNumber,
            assignedPhotographerId: data.assignedPhotographerId,
          },
        });

        const order = await createOrderFromBookingWithClient(
          tx,
          booking.id,
          OrderStatus.WAITING_SELECTION,
          actorContext
        );

        await tx.financialCase.update({
          where: { id: booking.financialCase.id },
          data: { jobId: job.id },
        });

        await tx.invoice.updateMany({
          where: { financialCaseId: booking.financialCase.id },
          data: { jobId: job.id, jobNumber },
        });

        await tx.payment.updateMany({
          where: { financialCaseId: booking.financialCase.id },
          data: { jobId: job.id, jobNumber },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.CHECKED_IN },
        });

        return { orderId: order.id };
      }),
    "Failed to check in booking",
    2
  );
}

export async function deletePendingBooking(
  input: DeletePendingBookingInput
): Promise<void> {
  const data = deletePendingBookingSchema.parse(input);

  await withRetry(
    () =>
      db.$transaction(async (tx) => {
        await lockBookingForUpdate(tx, data.bookingId);

        const booking = await tx.booking.findUnique({
          where: { id: data.bookingId },
          select: {
            id: true,
            status: true,
            jobId: true,
            jobNumber: true,
            financialCase: { select: { id: true } },
            invoices: { select: { id: true }, take: 1 },
          },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }
        if (booking.status !== BookingStatus.PENDING) {
          throw new Error("Only pending bookings can be deleted");
        }
        if (
          booking.jobId ||
          booking.jobNumber ||
          booking.financialCase ||
          booking.invoices.length > 0
        ) {
          throw new Error("Cannot delete a booking with financial or job history");
        }

        await tx.booking.delete({ where: { id: booking.id } });
      }),
    "Failed to delete pending booking",
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
  customer: { select: { name: true, phone: true } },
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
  order: {
    select: { id: true },
  },
  invoices: {
    where: {
      invoiceType: InvoiceType.DEPOSIT,
    },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      createdAt: true,
      invoiceNumber: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      isLocked: true,
      payments: {
        where: { paymentType: PaymentType.DEPOSIT },
        select: { id: true, amount: true },
        take: 1,
      },
    },
  },
  financialCase: {
    select: {
      invoices: {
        where: { invoiceType: InvoiceType.DEPOSIT },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          createdAt: true,
          invoiceNumber: true,
          totalAmount: true,
          paidAmount: true,
          status: true,
          isLocked: true,
          payments: {
            where: { paymentType: PaymentType.DEPOSIT },
            select: { id: true, amount: true },
            take: 1,
          },
        },
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
  const normalizedPhone = normalizePhoneSearch(search);
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
                is: {
                  phone: containsFilter,
                },
              },
            },
            ...(normalizedPhone
              ? [
                  {
                    customer: {
                      is: {
                        phone: {
                          contains: normalizedPhone,
                          mode: Prisma.QueryMode.insensitive,
                        },
                      },
                    },
                  },
                ]
              : []),
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
  status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CANCELLED" | "NO_SHOW"
): BookingStatusLabel {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "CONFIRMED":
      return "Confirmed";
    case "CHECKED_IN":
      return "Checked In";
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
    jobNumber: row.jobNumber ?? row.publicId ?? "Pending",
    customerId: row.customerId,
    customerPhone: formatCustomerPhone(row.customer.phone),
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
      row.status !== BookingStatus.CHECKED_IN &&
      row.status !== BookingStatus.CANCELLED &&
      row.status !== BookingStatus.NO_SHOW,
  };
}

function mapBookingDetail(
  row: NonNullable<Awaited<ReturnType<typeof fetchEditableBookingById>>>
): BookingDetail {
  const depositInvoices = dedupeAndSortDepositInvoices([
    ...row.invoices,
    ...(row.financialCase?.invoices ?? []),
  ]);
  const hasDeposit = hasDepositPayment(depositInvoices);
  const depositInvoice = depositInvoices[0] ?? null;

  return {
    id: row.id,
    customerId: row.customerId,
    status: row.status,
    bookingReference: row.publicId ?? "Pending",
    jobNumber: row.jobNumber,
    orderId: row.order?.id ?? null,
    customerPhone: formatCustomerPhone(row.customer.phone),
    sessionDate: formatSessionDate(row.sessionDate),
    sessionTime: row.sessionTime,
    sessionType: formatEnum(row.sessionType),
    packageName: row.package?.name ?? "—",
    packagePriceLabel: row.package ? formatPrice(row.package.price) : "—",
    department: row.department.name,
    assignedPhotographerId: row.assignedPhotographer?.id ?? "",
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
      row.status !== BookingStatus.CHECKED_IN &&
      row.status !== BookingStatus.CANCELLED &&
      row.status !== BookingStatus.NO_SHOW,
    canRecordDeposit: row.status === BookingStatus.PENDING && !hasDeposit,
    canDeletePending: row.status === BookingStatus.PENDING && !hasDeposit,
    canCheckIn: row.status === BookingStatus.CONFIRMED,
    isCheckedIn: row.status === BookingStatus.CHECKED_IN,
    depositInvoice: depositInvoice
      ? {
          id: depositInvoice.id,
          invoiceNumber: depositInvoice.invoiceNumber,
          totalAmount: formatPrice(depositInvoice.totalAmount),
          paidAmount: formatPrice(depositInvoice.paidAmount),
          status: depositInvoice.status,
          isLocked: depositInvoice.isLocked,
        }
      : null,
    packageRemainingBalanceLabel: row.package
      ? formatPrice(row.package.price.minus(BOOKING_DEPOSIT_AMOUNT))
      : null,
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

function dedupeAndSortDepositInvoices<
  T extends { id: string; createdAt: Date; payments?: Array<{ id: string }> }
>(invoices: T[]): T[] {
  return Array.from(
    invoices.reduce((map, invoice) => {
      const existing = map.get(invoice.id);
      if (!existing || existing.createdAt < invoice.createdAt) {
        map.set(invoice.id, invoice);
      }
      return map;
    }, new Map<string, T>())
  )
    .map(([, invoice]) => invoice)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
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

function normalizePhoneSearch(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) {
    return undefined;
  }

  const normalized = trimmed.replace(/[\s\-().]/g, "");
  return normalized && normalized !== "+" ? normalized : undefined;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
