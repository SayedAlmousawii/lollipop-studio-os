export function generateSessionConfigurationCode(
  sessionTypeCode: string,
  name: string
): string {
  const sessionTypePrefix = sessionTypeCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${sessionTypePrefix || "SESSION"}__${slug || "CONFIGURATION"}`;
}
