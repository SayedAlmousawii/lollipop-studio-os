import type { z } from "zod";
import type {
  createNoteInputSchema,
  deleteNoteInputSchema,
  getOrderNotesInputSchema,
  noteKindSchema,
  updateNoteInputSchema,
} from "./note.schema";

export type NoteKindValue = z.infer<typeof noteKindSchema>;

export type GetOrderNotesInput = z.infer<typeof getOrderNotesInputSchema>;

export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;

export type DeleteNoteInput = z.infer<typeof deleteNoteInputSchema>;
