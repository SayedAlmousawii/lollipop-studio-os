import type { PackageStatus } from "@/components/packages/package-status-badge";

export interface Package {
  id: string;
  name: string;
  price: string;
  photoCount: number;
  description: string;
  bookingCount: number;
  status: PackageStatus;
}
