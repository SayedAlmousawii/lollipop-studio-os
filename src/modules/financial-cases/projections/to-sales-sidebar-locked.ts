import type {
  FinancialCaseSummary,
} from "../financial-case-summary.types";
import {
  toFinancialTabBlock,
  type FinancialTabBlockProjection,
} from "./to-financial-tab-block";

export type SalesSidebarLockedProjection = FinancialTabBlockProjection;

export function toSalesSidebarLocked(
  summary: FinancialCaseSummary
): SalesSidebarLockedProjection | null {
  return toFinancialTabBlock(summary);
}
