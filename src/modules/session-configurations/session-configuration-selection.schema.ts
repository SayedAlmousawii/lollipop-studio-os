import { z } from "zod";

const finiteNonNegativeNumberSchema = z
  .number({ error: "Value must be a number" })
  .finite("Value must be a number")
  .min(0, "Value must be zero or greater");

export const selectionInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      configurationId: z.string().trim().min(1, "Configuration is required"),
      kind: z.literal("toggle"),
    })
    .strict(),
  z
    .object({
      configurationId: z.string().trim().min(1, "Configuration is required"),
      kind: z.literal("select"),
      optionId: z.string().trim().min(1, "Option is required"),
    })
    .strict(),
  z
    .object({
      configurationId: z.string().trim().min(1, "Configuration is required"),
      kind: z.literal("number"),
      numericValue: finiteNonNegativeNumberSchema,
    })
    .strict(),
  z
    .object({
      configurationId: z.string().trim().min(1, "Configuration is required"),
      kind: z.literal("text"),
      textValue: z
        .string()
        .trim()
        .min(1, "Text value is required")
        .max(500, "Text value must be 500 characters or fewer"),
    })
    .strict(),
  z
    .object({
      configurationId: z.string().trim().min(1, "Configuration is required"),
      kind: z.literal("counter"),
      numericValue: finiteNonNegativeNumberSchema,
      optionId: z.string().trim().min(1, "Option is required").optional(),
    })
    .strict(),
]);

export const writeSelectionsPayloadSchema = z
  .object({
    orderPackageId: z.string().trim().min(1, "Order package is required"),
    selections: z.array(selectionInputSchema),
  })
  .strict();

export type SelectionInput = z.infer<typeof selectionInputSchema>;
export type WriteSelectionsPayload = z.infer<typeof writeSelectionsPayloadSchema>;
