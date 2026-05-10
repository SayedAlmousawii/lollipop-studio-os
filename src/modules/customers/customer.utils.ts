export function formatCustomerPhone(
  value: string | null | undefined
): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\+965\d{8}$/.test(trimmed)) {
    return `+965 ${trimmed.slice(4)}`;
  }

  return trimmed;
}
