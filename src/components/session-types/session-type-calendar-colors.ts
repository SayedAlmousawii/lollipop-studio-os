export const CALENDAR_COLOR_OPTIONS = [
  { value: "", label: "Department default", swatchClass: "bg-surface-soft" },
  {
    value: "var(--color-accent-soft)",
    label: "Accent",
    swatchClass: "bg-accent-soft",
  },
  {
    value: "var(--color-info-soft)",
    label: "Info",
    swatchClass: "bg-info-soft",
  },
  {
    value: "var(--color-success-soft)",
    label: "Success",
    swatchClass: "bg-success-soft",
  },
  {
    value: "var(--color-warning-soft)",
    label: "Warning",
    swatchClass: "bg-warning-soft",
  },
] as const;

export function calendarColorSwatchClass(calendarColor: string): string {
  return (
    CALENDAR_COLOR_OPTIONS.find((option) => option.value === calendarColor)
      ?.swatchClass ?? "bg-surface-soft"
  );
}
