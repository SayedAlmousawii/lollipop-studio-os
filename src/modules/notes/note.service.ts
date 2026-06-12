import { OrderActivityType, Prisma } from "@prisma/client";
import type { ActorContext } from "@/lib/auth";
import { assertActorPermission } from "@/lib/auth/assert-actor-permission";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { recordOrderActivity } from "@/modules/orders/order-activity.service";
import { NOTE_KIND_LABEL } from "./note.constants";
import {
  createNoteInputSchema,
  deleteNoteInputSchema,
  getOrderNotesInputSchema,
  updateNoteInputSchema,
} from "./note.schema";
import type {
  CreateNoteInput,
  DeleteNoteInput,
  GetOrderNotesInput,
  UpdateNoteInput,
} from "./note.types";

type DbClient = typeof db | Prisma.TransactionClient;

const noteSelect = {
  id: true,
  orderId: true,
  orderPackageId: true,
  kind: true,
  body: true,
  authorUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NoteSelect;

export type NoteRow = Prisma.NoteGetPayload<{
  select: typeof noteSelect;
}>;

export async function getOrderNotes(
  input: GetOrderNotesInput,
  client: DbClient = db
): Promise<NoteRow[]> {
  const parsed = getOrderNotesInputSchema.parse(input);
  const where: Prisma.NoteWhereInput = {
    orderId: parsed.orderId,
    ...(parsed.kind ? { kind: parsed.kind } : {}),
    ...(Object.prototype.hasOwnProperty.call(parsed, "orderPackageId")
      ? { orderPackageId: parsed.orderPackageId ?? null }
      : {}),
  };

  return client.note.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: noteSelect,
  });
}

export async function createNote(
  input: CreateNoteInput,
  client: DbClient = db
): Promise<NoteRow> {
  const parsed = createNoteInputSchema.parse(input);
  assertActorPermission(parsed.actorContext as unknown as ActorContext, PERMISSIONS.NOTE_WRITE);

  if ("$transaction" in client) {
    return client.$transaction((tx) => createNoteWithClient(parsed, tx));
  }

  return createNoteWithClient(parsed, client);
}

export async function updateNote(
  input: UpdateNoteInput,
  client: DbClient = db
): Promise<NoteRow> {
  const parsed = updateNoteInputSchema.parse(input);
  assertActorPermission(parsed.actorContext as unknown as ActorContext, PERMISSIONS.NOTE_WRITE);

  return client.note.update({
    where: { id: parsed.id },
    data: {
      ...(parsed.body !== undefined ? { body: parsed.body } : {}),
      ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
      ...(Object.prototype.hasOwnProperty.call(parsed, "orderPackageId")
        ? { orderPackageId: parsed.orderPackageId ?? null }
        : {}),
    },
    select: noteSelect,
  });
}

export async function deleteNote(
  input: DeleteNoteInput,
  client: DbClient = db
): Promise<NoteRow> {
  const parsed = deleteNoteInputSchema.parse(input);
  assertActorPermission(parsed.actorContext as unknown as ActorContext, PERMISSIONS.NOTE_WRITE);

  return client.note.delete({
    where: { id: parsed.id },
    select: noteSelect,
  });
}

async function createNoteWithClient(
  parsed: CreateNoteInput,
  client: Prisma.TransactionClient
): Promise<NoteRow> {
  const note = await client.note.create({
    data: {
      orderId: parsed.orderId,
      orderPackageId: parsed.orderPackageId ?? null,
      kind: parsed.kind,
      body: parsed.body,
      authorUserId:
        Object.prototype.hasOwnProperty.call(parsed, "authorUserId")
          ? parsed.authorUserId ?? null
          : parsed.actorContext.actorUserId,
    },
    select: noteSelect,
  });

  await recordOrderActivity(client, {
    orderId: note.orderId,
    userId: parsed.actorContext.actorUserId,
    type: OrderActivityType.NOTE_ADDED,
    title: "Note added",
    description: `${NOTE_KIND_LABEL[note.kind]} note added.`,
    metadata: {
      noteId: note.id,
      kind: note.kind,
      orderPackageId: note.orderPackageId,
    },
  });

  return note;
}
