import type {
  SessionConfigurationCounterPricingMode,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationLinkProductDisplay,
  SessionConfigurationPricingMode,
} from "@prisma/client";

export type SessionConfigurationStatus = "Active" | "Archived";

export interface SessionConfigurationOptionRow {
  id: string;
  label: string;
  value: string;
  priceDelta: number;
  sortOrder: number;
  isActive: boolean;
}

export interface SessionConfigurationRow {
  id: string;
  code: string;
  name: string;
  sessionTypeId: string;
  sessionTypeCode: string;
  sessionTypeName: string;
  inputType: SessionConfigurationInputType;
  pricingMode: SessionConfigurationPricingMode;
  financialBehavior: SessionConfigurationFinancialBehavior;
  required: boolean;
  isActive: boolean;
  status: SessionConfigurationStatus;
  sortOrder: number;
  fixedPriceDelta: number | null;
  linkedProductId: string | null;
  linkedProductName: string | null;
  linkProductDisplay: SessionConfigurationLinkProductDisplay | null;
  counterPricingMode: SessionConfigurationCounterPricingMode | null;
  counterUnitPrice: number | null;
  activeOptionCount: number;
  optionPreviewLabels: string[];
  options: SessionConfigurationOptionRow[];
}

export type SessionConfigurationDetail = SessionConfigurationRow;

export interface SessionConfigurationSessionTypeOption {
  id: string;
  code: string;
  name: string;
}

export interface SessionConfigurationProductOption {
  id: string;
  name: string;
}
