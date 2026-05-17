import type { MediaType } from "@prisma/client";

export type SessionTypeStatus = "Active" | "Archived";

export interface SessionTypeDepartmentOption {
  id: string;
  name: string;
  code: string;
}

export interface SessionTypeRow {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  calendarLabel: string;
  calendarColor: string;
  isActive: boolean;
  status: SessionTypeStatus;
  sortOrder: number;
  pricingConfigured: boolean;
  zeroPriceMediaTypes: MediaType[];
}
