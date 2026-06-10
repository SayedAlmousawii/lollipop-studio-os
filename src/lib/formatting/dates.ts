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

export function formatStudioDate(date: Date): string {
  if (!isValidDate(date)) return "—";
  return STUDIO_DATE_FORMATTER.format(date);
}

export function formatStudioDateTime(date: Date): string {
  if (!isValidDate(date)) return "—";
  return STUDIO_DATE_TIME_FORMATTER.format(date);
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
