import type { CustomerStatus as CustomerStatusValue } from "@prisma/client";
import type { CustomerStatus } from "@/components/customers/customer-status-badge";
import type { BookingStatus } from "@/components/bookings/booking-status-badge";
import type { OrderStatusLabel } from "@/modules/orders/order.types";

export interface Customer {
  id: string;
  fullName: string;
  phone: string;
  childrenCount: number;
  totalBookings: number;
  lastSessionDate: string;
  status: CustomerStatus;
  statusValue: CustomerStatusValue;
  notes: string;
}

export interface CustomerProfile {
  id: string;
  fullName: string;
  phone: string;
  status: CustomerStatus;
  statusValue: CustomerStatusValue;
  notes: string;
  createdAt: string;
  updatedAt: string;
  childrenCount: number;
  bookingsCount: number;
  ordersCount: number;
  children: CustomerProfileChild[];
  bookings: CustomerProfileBooking[];
  orders: CustomerProfileOrder[];
  recentHistory: CustomerProfileHistoryItem[];
}

export interface CustomerProfileChild {
  id: string;
  name: string;
  dateOfBirth: string;
}

export interface CustomerProfileBooking {
  id: string;
  publicId: string;
  jobNumber: string;
  sessionDate: string;
  sessionType: string;
  department: string;
  packageName: string;
  status: BookingStatus;
}

export interface CustomerProfileOrder {
  id: string;
  publicId: string;
  jobNumber: string;
  bookingDate: string;
  packageName: string;
  status: OrderStatusLabel;
}

export interface CustomerProfileHistoryItem {
  id: string;
  label: string;
  detail: string;
  date: string;
  href: string;
}
