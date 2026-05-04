export type CalendarBooking = {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  extendedProps: {
    customerName: string;
    sessionType: "Newborn" | "Kids" | "Family" | "Other";
    status: "Pending" | "Confirmed" | "Cancelled";
    packageName: string;
    photographerName: string;
  };
};

export const SESSION_TYPE_COLORS = {
  Newborn: {
    backgroundColor: "var(--color-accent-soft)",
    textColor: "var(--color-accent)",
    borderColor: "var(--color-accent-soft)",
  },
  Kids: {
    backgroundColor: "var(--color-info-soft)",
    textColor: "var(--color-info)",
    borderColor: "var(--color-info-soft)",
  },
  Family: {
    backgroundColor: "var(--color-success-soft)",
    textColor: "var(--color-success)",
    borderColor: "var(--color-success-soft)",
  },
  Other: {
    backgroundColor: "var(--color-surface-soft)",
    textColor: "var(--color-text-secondary)",
    borderColor: "var(--color-border)",
  },
} as const;


export const mockBookings: CalendarBooking[] = [
  createCalendarBooking({
    id: "booking-1",
    title: "Sarah Ahmed",
    start: "2026-05-05T10:00:00",
    end: "2026-05-05T11:30:00",
    extendedProps: {
      customerName: "Sarah Ahmed",
      sessionType: "Newborn",
      status: "Confirmed",
      packageName: "Premium Newborn Package",
      photographerName: "Ali",
    },
  }),

    createCalendarBooking({
    id: "booking-2",
    title: "ali yousef",
    start: "2026-05-05T13:00:00",
    end: "2026-05-05T14:00:00",
    extendedProps: {
      customerName: "ali yousef",
      sessionType: "Newborn",
      status: "Confirmed",
      packageName: "Premium Newborn Package",
      photographerName: "Ali",
    },
  }),

];


function createCalendarBooking(
  booking: Omit<
    CalendarBooking,
    "backgroundColor" | "textColor" | "borderColor"
  >,
): CalendarBooking {
  return {
    ...booking,
    ...SESSION_TYPE_COLORS[booking.extendedProps.sessionType],
  };
}