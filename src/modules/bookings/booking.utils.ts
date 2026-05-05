export function parseThemeInput(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/[\n,]/)
    .map((themeName) => themeName.trim())
    .filter(Boolean)
    .map((themeName) => ({ themeName }));
}
