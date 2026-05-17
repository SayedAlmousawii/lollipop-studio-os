import { resolveCalendarSessionType } from "@/modules/calendar/calendar.service";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

export async function runCalendarSessionTypeDisplayInvariantTest() {
  assertEqual(
    resolveCalendarSessionType({
      calendarLabel: "Newborn",
      departmentCode: "NB",
    }),
    "Newborn",
    "Newborn session type code should bucket as Newborn"
  );

  assertEqual(
    resolveCalendarSessionType({
      calendarLabel: "Family",
      departmentCode: "KD",
    }),
    "Family",
    "Family session type code should override the Kids department bucket"
  );

  assertEqual(
    resolveCalendarSessionType({
      calendarLabel: "Kids",
      departmentCode: "KD",
    }),
    "Kids",
    "New Kids department session type codes should bucket as Kids"
  );

  assertEqual(
    resolveCalendarSessionType({
      calendarLabel: "Newborn",
      departmentCode: "NB",
    }),
    "Newborn",
    "New Newborn department session type codes should bucket as Newborn"
  );

  assertEqual(
    resolveCalendarSessionType({
      calendarLabel: null,
      departmentCode: null,
    }),
    "Other",
    "Missing taxonomy codes should bucket as Other"
  );
}
