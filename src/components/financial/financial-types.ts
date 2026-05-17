import type { deriveLockedFinancialSidebarSummary } from "@/modules/orders/order-settlement";

export type LockedFinancialSidebarSummary = ReturnType<
  typeof deriveLockedFinancialSidebarSummary
>;
