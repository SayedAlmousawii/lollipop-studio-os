import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import test, { after } from "node:test";
import { OrderActivityType, UserRole } from "@prisma/client";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;
moduleWithLoader._load = function loadWithServerOnlyShim(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

after(() => {
  moduleWithLoader._load = originalModuleLoad;
});

test("Note CRUD writes live rows and only create emits NOTE_ADDED activity", async () => {
  const {
    createNote,
    deleteNote,
    NOTE_KIND,
    updateNote,
  } = await import("@/modules/notes");
  const client = fakeNoteClient();
  const actorContext = { actorUserId: "user-1", actorRole: UserRole.MANAGER };

  const created = await createNote(
    {
      orderId: "order-1",
      orderPackageId: "order-package-1",
      kind: NOTE_KIND.CUSTOMER,
      body: " Please keep the first outfit. ",
      actorContext,
    },
    client
  );

  assert.equal(created.body, "Please keep the first outfit.");
  assert.equal(created.authorUserId, "user-1");
  assert.equal(client.activities.length, 1);
  assert.equal(client.activities[0]?.type, OrderActivityType.NOTE_ADDED);
  assert.deepEqual(client.activities[0]?.metadata, {
    noteId: created.id,
    kind: "CUSTOMER",
    orderPackageId: "order-package-1",
  });

  const updated = await updateNote(
    {
      id: created.id,
      body: "Use softer retouching.",
      kind: NOTE_KIND.EDITING,
      orderPackageId: null,
      actorContext,
    },
    client
  );

  assert.equal(updated.body, "Use softer retouching.");
  assert.equal(updated.kind, NOTE_KIND.EDITING);
  assert.equal(updated.orderPackageId, null);
  assert.equal(client.activities.length, 1);

  const deleted = await deleteNote({ id: created.id, actorContext }, client);

  assert.equal(deleted.id, created.id);
  assert.equal(client.rows.length, 0);
  assert.equal(client.activities.length, 1);
});

test("createNote preserves explicit customer-relayed null author", async () => {
  const { createNote, NOTE_KIND } = await import("@/modules/notes");
  const client = fakeNoteClient();

  const note = await createNote(
    {
      orderId: "order-1",
      kind: NOTE_KIND.INTERNAL,
      body: "Customer called reception.",
      authorUserId: null,
      actorContext: { actorUserId: "user-1", actorRole: UserRole.RECEPTIONIST },
    },
    client
  );

  assert.equal(note.authorUserId, null);
});

test("getOrderNotes returns kind and package slices including order-level only", async () => {
  const { getOrderNotes, NOTE_KIND } = await import("@/modules/notes");
  const client = fakeNoteClient([
    noteRow({ id: "note-1", orderId: "order-1", kind: NOTE_KIND.CUSTOMER, orderPackageId: null }),
    noteRow({ id: "note-2", orderId: "order-1", kind: NOTE_KIND.CUSTOMER, orderPackageId: "package-1" }),
    noteRow({ id: "note-3", orderId: "order-1", kind: NOTE_KIND.PRODUCTION, orderPackageId: "package-1" }),
    noteRow({ id: "note-4", orderId: "order-2", kind: NOTE_KIND.CUSTOMER, orderPackageId: null }),
  ]);

  assert.deepEqual(
    (await getOrderNotes({ orderId: "order-1" }, client)).map((row) => row.id),
    ["note-1", "note-2", "note-3"]
  );
  assert.deepEqual(
    (await getOrderNotes({ orderId: "order-1", kind: NOTE_KIND.CUSTOMER }, client)).map((row) => row.id),
    ["note-1", "note-2"]
  );
  assert.deepEqual(
    (await getOrderNotes({ orderId: "order-1", orderPackageId: "package-1" }, client)).map((row) => row.id),
    ["note-2", "note-3"]
  );
  assert.deepEqual(
    (await getOrderNotes({ orderId: "order-1", orderPackageId: null }, client)).map((row) => row.id),
    ["note-1"]
  );
});

test("note writes enforce NOTE_WRITE through actor permission checks", async () => {
  const { MissingActorRoleError } = await import("@/lib/auth/assert-actor-permission");
  const { hasPermission, PERMISSIONS } = await import("@/lib/permissions");
  const { createNote, NOTE_KIND } = await import("@/modules/notes");
  const client = fakeNoteClient();

  await assert.rejects(
    () =>
      createNote(
        {
          orderId: "order-1",
          kind: NOTE_KIND.CUSTOMER,
          body: "Missing role.",
          actorContext: { actorUserId: "user-1" } as never,
        },
        client
      ),
    MissingActorRoleError
  );

  for (const role of Object.values(UserRole)) {
    assert.equal(hasPermission({ role }, PERMISSIONS.NOTE_WRITE), true);
  }
});

function fakeNoteClient(initialRows: NoteRow[] = []) {
  const rows = [...initialRows];
  const activities: ActivityRow[] = [];
  const client = {
    rows,
    activities,
    $transaction: async <T>(run: (tx: typeof client) => Promise<T>) => run(client),
    note: {
      findMany: async (args: {
        where: { orderId: string; kind?: string; orderPackageId?: string | null };
      }) =>
        rows.filter(
          (row) =>
            row.orderId === args.where.orderId &&
            (args.where.kind === undefined || row.kind === args.where.kind) &&
            (!Object.prototype.hasOwnProperty.call(args.where, "orderPackageId") ||
              row.orderPackageId === args.where.orderPackageId)
        ),
      create: async (args: { data: Partial<NoteRow> }) => {
        const row = noteRow({
          id: `note-${rows.length + 1}`,
          orderId: args.data.orderId,
          orderPackageId: args.data.orderPackageId,
          kind: args.data.kind,
          body: args.data.body,
          authorUserId: args.data.authorUserId,
        });
        rows.push(row);
        return row;
      },
      update: async (args: { where: { id: string }; data: Partial<NoteRow> }) => {
        const index = rows.findIndex((row) => row.id === args.where.id);
        assert.notEqual(index, -1);
        rows[index] = { ...rows[index], ...args.data, updatedAt: new Date() };
        return rows[index];
      },
      delete: async (args: { where: { id: string } }) => {
        const index = rows.findIndex((row) => row.id === args.where.id);
        assert.notEqual(index, -1);
        const [deleted] = rows.splice(index, 1);
        return deleted;
      },
    },
    orderActivity: {
      create: async (args: { data: ActivityRow }) => {
        activities.push(args.data);
      },
    },
  };

  return client as never;
}

type ActivityRow = {
  orderId: string;
  userId?: string | null;
  type: OrderActivityType;
  title: string;
  description?: string | null;
  metadata?: unknown;
};

type NoteRow = {
  id: string;
  orderId: string;
  orderPackageId: string | null;
  kind: string;
  body: string;
  authorUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function noteRow(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: "note-1",
    orderId: "order-1",
    orderPackageId: null,
    kind: "CUSTOMER",
    body: "Customer note.",
    authorUserId: "user-1",
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
    ...overrides,
  };
}
