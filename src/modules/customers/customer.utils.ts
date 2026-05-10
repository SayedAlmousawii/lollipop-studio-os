export function formatCustomerPhone(value: string): string {
  const trimmed = value.trim();

  if (/^\+965\d{8}$/.test(trimmed)) {
    return `+965 ${trimmed.slice(4)}`;
  }

  return trimmed;
}
