import type { CustomerStatus } from "@/components/customers/customer-status-badge";

export interface Customer {
  id: string;
  fullName: string;
  phone: string;
  childrenCount: number;
  totalBookings: number;
  lastSessionDate: string;
  status: CustomerStatus;
}
