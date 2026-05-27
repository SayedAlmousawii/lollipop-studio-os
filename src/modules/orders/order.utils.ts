export function getOrderTotalSelectedPhotoCount(
  lines: Array<{
    selectedPhotoCount: number | null;
    currentPackage: { photoCount: number };
  }>
): number {
  return lines.reduce(
    (sum, line) => sum + getOrderPackageLineSelectedPhotoCount(line),
    0
  );
}

export function getOrderPackageLineSelectedPhotoCount(line: {
  selectedPhotoCount: number | null;
  currentPackage: { photoCount: number };
}): number {
  return line.selectedPhotoCount ?? line.currentPackage.photoCount;
}
