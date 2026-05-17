export function generateSessionTypeCode(
  departmentCode: string,
  name: string
): string {
  const departmentPrefix = departmentCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${departmentPrefix}_${slug || "SESSION"}`;
}
