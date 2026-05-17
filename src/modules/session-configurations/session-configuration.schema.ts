import {
  SessionConfigurationCounterPricingMode,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationLinkProductDisplay,
  SessionConfigurationPricingMode,
} from "@prisma/client";
import { z } from "zod";

const moneySchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : Number(trimmed);
  },
  z
    .number({ error: "Amount must be a number" })
    .finite("Amount must be a number")
    .min(-9999999.999, "Amount is too small")
    .max(9999999.999, "Amount is too large")
    .optional()
);

const integerSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    return Number(value.trim());
  },
  z.number({ error: "Sort order must be a number" }).int()
);

const optionalIdSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z.string().optional()
);

const optionalNullableIdSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z.string().optional()
);

export const sessionConfigurationOptionInputSchema = z
  .object({
    id: optionalIdSchema,
    label: z
      .string()
      .trim()
      .min(1, "Option label is required")
      .max(120, "Option label must be 120 characters or fewer"),
    value: z
      .string()
      .trim()
      .min(1, "Option value is required")
      .max(120, "Option value must be 120 characters or fewer"),
    priceDelta: moneySchema.default(0),
    sortOrder: integerSchema.default(0),
    isActive: z.boolean().default(true),
  })
  .strict();

const baseSessionConfigurationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Configuration name is required")
      .max(120, "Configuration name must be 120 characters or fewer"),
    inputType: z.nativeEnum(SessionConfigurationInputType),
    pricingMode: z.nativeEnum(SessionConfigurationPricingMode),
    financialBehavior: z.nativeEnum(SessionConfigurationFinancialBehavior),
    required: z.boolean().default(false),
    sortOrder: integerSchema.default(0),
    fixedPriceDelta: moneySchema,
    linkedProductId: optionalNullableIdSchema,
    linkProductDisplay: z
      .nativeEnum(SessionConfigurationLinkProductDisplay)
      .optional(),
    counterPricingMode: z
      .nativeEnum(SessionConfigurationCounterPricingMode)
      .optional(),
    counterUnitPrice: moneySchema,
    options: z.array(sessionConfigurationOptionInputSchema).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const activeOptions = value.options.filter((option) => option.isActive);

    if (
      value.pricingMode === SessionConfigurationPricingMode.FIXED &&
      value.fixedPriceDelta === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixedPriceDelta"],
        message: "Fixed price delta is required for fixed pricing.",
      });
    }

    if (value.pricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT) {
      if (!value.linkedProductId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linkedProductId"],
          message: "Linked product is required for linked-product pricing.",
        });
      }
      if (!value.linkProductDisplay) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linkProductDisplay"],
          message: "Product display mode is required for linked-product pricing.",
        });
      }
    }

    if (
      value.inputType === SessionConfigurationInputType.COUNTER &&
      value.pricingMode !== SessionConfigurationPricingMode.NONE
    ) {
      if (!value.counterPricingMode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["counterPricingMode"],
          message: "Counter pricing mode is required when counter affects price.",
        });
      }
      if (
        value.counterPricingMode ===
          SessionConfigurationCounterPricingMode.PER_UNIT &&
        value.counterUnitPrice === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["counterUnitPrice"],
          message: "Counter unit price is required for per-unit counter pricing.",
        });
      }
    }

    if (
      value.inputType === SessionConfigurationInputType.SELECT &&
      activeOptions.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Select configurations require at least one active option.",
      });
    }

    if (
      value.pricingMode === SessionConfigurationPricingMode.TIERED &&
      value.inputType !== SessionConfigurationInputType.SELECT &&
      value.inputType !== SessionConfigurationInputType.COUNTER
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pricingMode"],
        message: "Tiered pricing requires select or counter input.",
      });
    }

    if (
      value.pricingMode === SessionConfigurationPricingMode.TIERED &&
      activeOptions.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Tiered pricing requires at least one active option.",
      });
    }
  });

export const createSessionConfigurationSchema =
  baseSessionConfigurationSchema.extend({
    sessionTypeId: z
      .string()
      .trim()
      .min(1, "Session type is required"),
  });

export const updateSessionConfigurationSchema = baseSessionConfigurationSchema;

export type SessionConfigurationOptionInput = z.infer<
  typeof sessionConfigurationOptionInputSchema
>;
export type CreateSessionConfigurationInput = z.infer<
  typeof createSessionConfigurationSchema
>;
export type UpdateSessionConfigurationInput = z.infer<
  typeof updateSessionConfigurationSchema
>;
