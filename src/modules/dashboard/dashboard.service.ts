import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";
import { BookingStatus } from "@prisma/client";
import type { ScheduleStatus } from "./dashboard.types";

type ActivityEntry = { id: string; createdAt: Date; timestamp: string; description: string };

export type DashboardData = {
  stats: {
    todaySessionCount: number;
    todayConfirmed: number;
    todayPending: number;
    revenueToday: number;
    pendingTasks: number;
    newCustomersThisWeek: number;
  };
  todaySchedule: Array<{ id: string; time: string; customerName: string; status: ScheduleStatus }>;
  recentActivity: Array<{ id: string; timestamp: string; description: string }>;
};

function todayRange() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
  );
  return { start, end };
}

function startOfWeekUTC(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff, 0, 0, 0)
  );
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

function relativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHrs < 24) return `${diffHrs} hrs ago`;
  return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
}

function mapScheduleStatus(status: BookingStatus): ScheduleStatus {
  switch (status) {
    case BookingStatus.PENDING:
      return "Pending";
    case BookingStatus.CONFIRMED:
    case BookingStatus.COMPLETED:
      return "Confirmed";
    case BookingStatus.CANCELLED:
    case BookingStatus.NO_SHOW:
      return "Cancelled";
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const { start: todayStart, end: todayEnd } = todayRange();
  const weekStart = startOfWeekUTC();

  const [
    todaySessionCount,
    todayConfirmed,
    todayPending,
    revenueAgg,
    pendingTasks,
    newCustomersThisWeek,
    todayBookings,
    recentPayments,
    recentBookings,
  ] = await withRetry(
    () =>
      Promise.all([
        db.booking.count({
          where: { sessionDate: { gte: todayStart, lte: todayEnd } },
        }),
        db.booking.count({
          where: { sessionDate: { gte: todayStart, lte: todayEnd }, status: "CONFIRMED" },
        }),
        db.booking.count({
          where: { sessionDate: { gte: todayStart, lte: todayEnd }, status: "PENDING" },
        }),
        db.payment.aggregate({
          _sum: { amount: true },
          where: { paidAt: { gte: todayStart, lte: todayEnd } },
        }),
        db.order.count({
          where: { status: { in: ["WAITING_SELECTION", "EDITING", "READY"] } },
        }),
        db.customer.count({
          where: { createdAt: { gte: weekStart } },
        }),
        db.booking.findMany({
          where: { sessionDate: { gte: todayStart, lte: todayEnd } },
          orderBy: { sessionDate: "asc" },
          include: { customer: { select: { name: true } } },
        }),
        db.payment.findMany({
          take: 3,
          orderBy: { paidAt: "desc" },
          include: {
            invoice: { include: { customer: { select: { name: true } } } },
          },
        }),
        db.booking.findMany({
          take: 3,
          orderBy: { createdAt: "desc" },
          include: { customer: { select: { name: true } } },
        }),
      ]),
    "Failed to fetch dashboard data"
  );

  const stats = {
    todaySessionCount,
    todayConfirmed,
    todayPending,
    revenueToday: revenueAgg._sum.amount?.toNumber() ?? 0,
    pendingTasks,
    newCustomersThisWeek,
  };

  const todaySchedule = todayBookings.map((b) => ({
    id: b.id,
    time: formatTime(b.sessionDate),
    customerName: b.customer.name,
    status: mapScheduleStatus(b.status),
  }));

  const paymentEntries: ActivityEntry[] = recentPayments.map((p) => ({
    id: `payment-${p.id}`,
    createdAt: p.paidAt,
    timestamp: relativeTime(p.paidAt),
    description: `Payment received from ${p.invoice.customer.name} — KD ${p.amount.toNumber()}`,
  }));

  const bookingEntries: ActivityEntry[] = recentBookings.map((b) => ({
    id: `booking-${b.id}`,
    createdAt: b.createdAt,
    timestamp: relativeTime(b.createdAt),
    description: `New booking created for ${b.customer.name}`,
  }));

  const recentActivity = [...paymentEntries, ...bookingEntries]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 6)
    .map(({ id, timestamp, description }) => ({ id, timestamp, description }));

  return { stats, todaySchedule, recentActivity };
}
