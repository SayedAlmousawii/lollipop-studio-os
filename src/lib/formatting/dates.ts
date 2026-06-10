export const STUDIO_TIME_ZONE = "Asia/Kuwait";
export const KUWAIT_UTC_OFFSET_HOURS = 3;

const STUDIO_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: STUDIO_TIME_ZONE,
});

const STUDIO_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: STUDIO_TIME_ZONE,
});

const STUDIO_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: STUDIO_TIME_ZONE,
});

const STUDIO_INPUT_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: STUDIO_TIME_ZONE,
});

const STUDIO_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: STUDIO_TIME_ZONE,
});

export function formatStudioDate(date: Date): string {
  if (!isValidDate(date)) return "—";
  return STUDIO_DATE_FORMATTER.format(date);
}

export function formatStudioDateTime(date: Date): string {
  if (!isValidDate(date)) return "—";
  return STUDIO_DATE_TIME_FORMATTER.format(date);
}

export function formatStudioTime(date: Date): string {
  if (!isValidDate(date)) return "—";
  return STUDIO_TIME_FORMATTER.format(date);
}

export function formatStudioInputDate(date: Date): string {
  if (!isValidDate(date)) return "";
  return STUDIO_INPUT_DATE_FORMATTER.format(date);
}

export function getStudioDateParts(
  date: Date
): { year: number; month: number; day: number } | undefined {
  if (!isValidDate(date)) return undefined;

  const parts = STUDIO_DATE_PARTS_FORMATTER.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (!year || !month || !day) return undefined;
  return { year, month, day };
}

export function studioWallClockToInstant(
  dateInput: string | undefined,
  timeInput: string | undefined
): Date | undefined {
  const parsedDate = parseDateInput(dateInput);
  const parsedTime = parseTimeInput(timeInput);
  if (!parsedDate || !parsedTime) return undefined;

  const { year, month, day } = parsedDate;
  const { hour, minute } = parsedTime;
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour - KUWAIT_UTC_OFFSET_HOURS,
      minute,
      0,
      0
    )
  );
}

export function studioDayRange(
  dateInput: string | undefined
): { start: Date; end: Date } | undefined {
  const parsed = parseDateInput(dateInput);
  if (!parsed) return undefined;

  const { year, month, day } = parsed;
  return {
    start: new Date(
      Date.UTC(year, month - 1, day, -KUWAIT_UTC_OFFSET_HOURS, 0, 0, 0)
    ),
    end: new Date(
      Date.UTC(year, month - 1, day + 1, -KUWAIT_UTC_OFFSET_HOURS, 0, 0, -1)
    ),
  };
}

function isValidDate(date: Date): boolean {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function parseDateInput(
  value: string | undefined
): { year: number; month: number; day: number } | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }

  const [yearText, monthText, dayText] = trimmed.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { year, month, day };
}

function parseTimeInput(
  value: string | undefined
): { hour: number; minute: number } | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
    return undefined;
  }

  const [hourText, minuteText] = trimmed.split(":");
  return {
    hour: Number(hourText),
    minute: Number(minuteText),
  };
}
