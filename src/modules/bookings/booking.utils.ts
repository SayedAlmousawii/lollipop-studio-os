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

export function parsePackageLines(formData: FormData) {
  const packageIds = formData.getAll("packageIds");
  const quantities = formData.getAll("packageQuantities");
  const sortOrders = formData.getAll("packageSortOrders");

  return packageIds.map((packageId, index) => ({
    packageId: String(packageId),
    quantity: String(quantities[index] ?? "1"),
    sortOrder: String(sortOrders[index] ?? index),
  }));
}
