export type PackageStatus = "Active" | "Inactive";

export interface Package {
  id: string;
  name: string;
  price: string;
  photoCount: number;
  description: string;
  bookingCount: number;
  status: PackageStatus;
}

export interface PackageOption {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  photoCount: number;
}
