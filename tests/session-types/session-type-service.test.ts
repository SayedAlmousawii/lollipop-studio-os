import "dotenv/config";

import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";
import test, { after } from "node:test";
import { MediaType, UserRole } from "@prisma/client";
import { withIsolatedBackendInvariantSchema } from "../backend-invariants/harness";

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

const managerActor = { id: "manager-user", role: UserRole.MANAGER };

test("session type service creates, blocks collisions, archives idempotently, and protects identity fields", async () => {
  await withIsolatedBackendInvariantSchema(async (databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    try {
      const { db } = await import("@/lib/db");
      const {
        archiveSessionType,
        createSessionType,
        SessionTypeNameConflictError,
        unarchiveSessionType,
        updateSessionType,
      } = await import("@/modules/session-types/session-type.service");

      const department = await db.studioDepartment.upsert({
        where: { code: "KD" },
        update: {
          name: "Kids",
          sortOrder: 10,
          isActive: true,
        },
        create: {
          id: "dept-session-types",
          code: "KD",
          name: "Kids",
          sortOrder: 10,
        },
      });

      const created = await createSessionType(
        {
          departmentId: department.id,
          name: "Birthday Party",
          calendarLabel: "Kids",
          calendarColor: "var(--color-info-soft)",
        },
        managerActor
      );

      const sessionType = await db.sessionType.findUniqueOrThrow({
        where: { id: created.id },
        include: { extraPhotoPricing: true },
      });
      assert.equal(sessionType.code, "KD_BIRTHDAY_PARTY");
      assert.equal(sessionType.isActive, true);
      assert.deepEqual(
        sessionType.extraPhotoPricing
          .map((row) => [row.mediaType, row.unitPrice.toFixed(3)])
          .sort(),
        [
          [MediaType.DIGITAL, "0.000"],
          [MediaType.PRINT, "0.000"],
        ]
      );

      await assert.rejects(
        () =>
          createSessionType(
            {
              departmentId: department.id,
              name: "birthday party",
              calendarLabel: "Kids",
              calendarColor: "",
            },
            managerActor
          ),
        SessionTypeNameConflictError
      );

      await archiveSessionType(created.id, managerActor);
      await archiveSessionType(created.id, managerActor);
      assert.equal(
        (await db.sessionType.findUniqueOrThrow({ where: { id: created.id } }))
          .isActive,
        false
      );

      await assert.rejects(
        () =>
          createSessionType(
            {
              departmentId: department.id,
              name: "Birthday Party",
              calendarLabel: "Kids",
              calendarColor: "",
            },
            managerActor
          ),
        SessionTypeNameConflictError
      );

      await assert.rejects(
        () =>
          updateSessionType(
            created.id,
            {
              name: "Birthday Party",
              departmentId: department.id,
            } as unknown as Parameters<typeof updateSessionType>[1],
            managerActor
          ),
        /Unrecognized key/
      );

      await db.sessionType.create({
        data: {
          code: "KD_BIRTHDAY_PARTY_TRAILING",
          name: "Birthday Party ",
          departmentId: department.id,
          calendarLabel: "Kids",
          calendarColor: "var(--color-info-soft)",
          isActive: false,
        },
      });

      await unarchiveSessionType(created.id, managerActor);
      const trailingArchived = await db.sessionType.findUniqueOrThrow({
        where: { code: "KD_BIRTHDAY_PARTY_TRAILING" },
        select: { id: true },
      });
      await assert.rejects(
        () =>
          unarchiveSessionType(trailingArchived.id, managerActor),
        SessionTypeNameConflictError
      );
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});
