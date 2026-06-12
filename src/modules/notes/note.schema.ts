import { z } from "zod";
import { NOTE_KIND } from "./note.constants";

export const noteKindSchema = z.enum([
  NOTE_KIND.CUSTOMER,
  NOTE_KIND.PHOTOGRAPHER,
  NOTE_KIND.EDITING,
  NOTE_KIND.PRODUCTION,
  NOTE_KIND.DELIVERY,
  NOTE_KIND.INTERNAL,
]);

const actorContextSchema = z
  .object({
    actorUserId: z.string().min(1),
    actorRole: z.string().min(1).optional(),
  })
  .passthrough();

const noteBodySchema = z.string().trim().min(1);
const nullableScopeIdSchema = z.string().min(1).nullable().optional();

export const getOrderNotesInputSchema = z
  .object({
    orderId: z.string().min(1),
    kind: noteKindSchema.optional(),
    orderPackageId: nullableScopeIdSchema,
  })
  .strict();

export const createNoteInputSchema = z
  .object({
    orderId: z.string().min(1),
    kind: noteKindSchema,
    body: noteBodySchema,
    orderPackageId: nullableScopeIdSchema,
    authorUserId: z.string().min(1).nullable().optional(),
    actorContext: actorContextSchema,
  })
  .strict();

export const updateNoteInputSchema = z
  .object({
    id: z.string().min(1),
    body: noteBodySchema.optional(),
    kind: noteKindSchema.optional(),
    orderPackageId: nullableScopeIdSchema,
    actorContext: actorContextSchema,
  })
  .strict()
  .refine(
    (input) =>
      input.body !== undefined ||
      input.kind !== undefined ||
      input.orderPackageId !== undefined,
    {
      message: "At least one note field must be provided.",
    }
  );

export const deleteNoteInputSchema = z
  .object({
    id: z.string().min(1),
    actorContext: actorContextSchema,
  })
  .strict();
