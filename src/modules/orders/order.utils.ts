export function getOrderTotalSelectedPhotoCount(
  lines: Array<{
    selectedPhotoCount: number | null;
    package: { photoCount: number };
  }>
): number {
  return lines.reduce(
    (sum, line) => sum + getOrderPackageLineSelectedPhotoCount(line),
    0
  );
}

export function getOrderPackageLineSelectedPhotoCount(line: {
  selectedPhotoCount: number | null;
  package: { photoCount: number };
}): number {
  return line.selectedPhotoCount ?? line.package.photoCount;
}
