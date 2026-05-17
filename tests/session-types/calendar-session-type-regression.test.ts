import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

type ModuleLoader = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean
) => unknown;

const moduleWithLoader = Module as typeof Module & { _load: ModuleLoader };
const originalModuleLoad = moduleWithLoader._load;

test("calendar seeded session labels and colors match the previous hardcoded buckets", async () => {
  moduleWithLoader._load = function loadWithCalendarStubs(
    request,
    parent,
    isMain
  ) {
    if (request === "@/lib/db") return { db: {} };
    if (request === "@/lib/retry") {
      return { withRetry: async (fn: () => Promise<unknown>) => fn() };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  const {
    resolveCalendarColors,
    resolveCalendarSessionType,
  } = await import("@/modules/calendar/calendar.service");

  const newborn = resolveCalendarSessionType({
    calendarLabel: "Newborn",
    departmentCode: "NB",
  });
  const kids = resolveCalendarSessionType({
    calendarLabel: "Kids",
    departmentCode: "KD",
  });
  const family = resolveCalendarSessionType({
    calendarLabel: "Family",
    departmentCode: "KD",
  });

  assert.equal(newborn, "Newborn");
  assert.equal(kids, "Kids");
  assert.equal(family, "Family");
  assert.deepEqual(resolveCalendarColors({ calendarLabel: newborn }), {
    backgroundColor: "var(--color-accent-soft)",
    textColor: "var(--color-accent)",
    borderColor: "var(--color-accent-soft)",
  });
  assert.deepEqual(resolveCalendarColors({ calendarLabel: kids }), {
    backgroundColor: "var(--color-info-soft)",
    textColor: "var(--color-info)",
    borderColor: "var(--color-info-soft)",
  });
  assert.deepEqual(resolveCalendarColors({ calendarLabel: family }), {
    backgroundColor: "var(--color-success-soft)",
    textColor: "var(--color-success)",
    borderColor: "var(--color-success-soft)",
  });

  moduleWithLoader._load = originalModuleLoad;
});
