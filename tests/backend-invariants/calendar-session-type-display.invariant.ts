import { mapCalendarSessionType } from "@/modules/calendar/calendar.service";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

export async function runCalendarSessionTypeDisplayInvariantTest() {
  assertEqual(
    mapCalendarSessionType({
      sessionTypeCode: "NB_NEWBORN",
      departmentCode: "NB",
    }),
    "Newborn",
    "Newborn session type code should bucket as Newborn"
  );

  assertEqual(
    mapCalendarSessionType({
      sessionTypeCode: "KD_FAMILY",
      departmentCode: "KD",
    }),
    "Family",
    "Family session type code should override the Kids department bucket"
  );

  assertEqual(
    mapCalendarSessionType({
      sessionTypeCode: "KD_SCHOOL",
      departmentCode: "KD",
    }),
    "Kids",
    "New Kids department session type codes should bucket as Kids"
  );

  assertEqual(
    mapCalendarSessionType({
      sessionTypeCode: "UNMAPPED",
      departmentCode: "NB",
    }),
    "Newborn",
    "New Newborn department session type codes should bucket as Newborn"
  );

  assertEqual(
    mapCalendarSessionType({
      sessionTypeCode: null,
      departmentCode: null,
    }),
    "Other",
    "Missing taxonomy codes should bucket as Other"
  );
}
