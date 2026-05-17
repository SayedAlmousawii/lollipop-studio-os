export type CalendarSessionType = string;

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
    sessionType: CalendarSessionType;
    status: "Pending" | "Confirmed" | "Cancelled";
    department?: string;
    packageName: string;
    photographerName: string;
  };
};

export const SESSION_TYPE_COLORS: Record<string, {
  backgroundColor: string;
  textColor: string;
  borderColor: string;
}> = {
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
    title: "Ali Yousef",
    start: "2026-05-05T13:00:00",
    end: "2026-05-05T14:00:00",
    extendedProps: {
      customerName: "Ali Yousef",
      sessionType: "Newborn",
      status: "Confirmed",
      packageName: "Premium Newborn Package",
      photographerName: "Ali",
    },
  }),

  createCalendarBooking({
    id: "booking-3",
    title: "Fatima Al-Hassan",
    start: "2026-05-06T09:00:00",
    end: "2026-05-06T10:30:00",
    extendedProps: {
      customerName: "Fatima Al-Hassan",
      sessionType: "Kids",
      status: "Pending",
      packageName: "Kids Adventure Package",
      photographerName: "Sara",
    },
  }),

  createCalendarBooking({
    id: "booking-4",
    title: "Omar Al-Rashidi",
    start: "2026-05-07T11:00:00",
    end: "2026-05-07T13:00:00",
    extendedProps: {
      customerName: "Omar Al-Rashidi",
      sessionType: "Family",
      status: "Confirmed",
      packageName: "Family Portrait Package",
      photographerName: "Khalid",
    },
  }),

  createCalendarBooking({
    id: "booking-5",
    title: "Nora Mahmoud",
    start: "2026-05-08T14:00:00",
    end: "2026-05-08T15:00:00",
    extendedProps: {
      customerName: "Nora Mahmoud",
      sessionType: "Other",
      status: "Cancelled",
      packageName: "Corporate Headshot",
      photographerName: "Ali",
    },
  }),

  createCalendarBooking({
    id: "booking-6",
    title: "Layla Ibrahim",
    start: "2026-05-10T10:00:00",
    end: "2026-05-10T11:30:00",
    extendedProps: {
      customerName: "Layla Ibrahim",
      sessionType: "Newborn",
      status: "Pending",
      packageName: "Essential Newborn Package",
      photographerName: "Sara",
    },
  }),

  createCalendarBooking({
    id: "booking-7",
    title: "Yusuf Al-Mansouri",
    start: "2026-05-10T12:00:00",
    end: "2026-05-10T13:30:00",
    extendedProps: {
      customerName: "Yusuf Al-Mansouri",
      sessionType: "Kids",
      status: "Confirmed",
      packageName: "Kids Milestone Package",
      photographerName: "Khalid",
    },
  }),

  createCalendarBooking({
    id: "booking-8",
    title: "Amira Saleh",
    start: "2026-05-12T09:30:00",
    end: "2026-05-12T11:00:00",
    extendedProps: {
      customerName: "Amira Saleh",
      sessionType: "Family",
      status: "Pending",
      packageName: "Extended Family Package",
      photographerName: "Ali",
    },
  }),

  createCalendarBooking({
    id: "booking-9",
    title: "Hassan Al-Zaabi",
    start: "2026-05-13T15:00:00",
    end: "2026-05-13T16:00:00",
    extendedProps: {
      customerName: "Hassan Al-Zaabi",
      sessionType: "Newborn",
      status: "Cancelled",
      packageName: "Premium Newborn Package",
      photographerName: "Sara",
    },
  }),

  createCalendarBooking({
    id: "booking-10",
    title: "Mariam Al-Kuwaiti",
    start: "2026-05-14T10:00:00",
    end: "2026-05-14T11:00:00",
    extendedProps: {
      customerName: "Mariam Al-Kuwaiti",
      sessionType: "Kids",
      status: "Confirmed",
      packageName: "Kids Adventure Package",
      photographerName: "Khalid",
    },
  }),

  createCalendarBooking({
    id: "booking-11",
    title: "Khalid Al-Farsi",
    start: "2026-05-19T09:00:00",
    end: "2026-05-20T09:00:00",
    extendedProps: {
      customerName: "Khalid Al-Farsi",
      sessionType: "Family",
      status: "Confirmed",
      packageName: "Family Weekend Package",
      photographerName: "Ali",
    },
  }),

  createCalendarBooking({
    id: "booking-12",
    title: "Reem Al-Bloushi",
    start: "2026-05-20T11:00:00",
    end: "2026-05-20T12:30:00",
    extendedProps: {
      customerName: "Reem Al-Bloushi",
      sessionType: "Newborn",
      status: "Pending",
      packageName: "Essential Newborn Package",
      photographerName: "Sara",
    },
  }),

  createCalendarBooking({
    id: "booking-13",
    title: "Tariq Al-Nuaimi",
    start: "2026-05-21T14:00:00",
    end: "2026-05-21T15:30:00",
    extendedProps: {
      customerName: "Tariq Al-Nuaimi",
      sessionType: "Other",
      status: "Confirmed",
      packageName: "Brand Photography",
      photographerName: "Khalid",
    },
  }),

  createCalendarBooking({
    id: "booking-14",
    title: "Hessa Al-Marri",
    start: "2026-05-22T09:00:00",
    end: "2026-05-22T10:00:00",
    extendedProps: {
      customerName: "Hessa Al-Marri",
      sessionType: "Kids",
      status: "Cancelled",
      packageName: "Kids Milestone Package",
      photographerName: "Ali",
    },
  }),

  createCalendarBooking({
    id: "booking-15",
    title: "Moza Al-Suwaidi",
    start: "2026-05-26T10:30:00",
    end: "2026-05-26T12:30:00",
    extendedProps: {
      customerName: "Moza Al-Suwaidi",
      sessionType: "Family",
      status: "Confirmed",
      packageName: "Family Portrait Package",
      photographerName: "Sara",
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
