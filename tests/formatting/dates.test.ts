import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  formatStudioDate,
  formatStudioDateTime,
  formatStudioInputDate,
  formatStudioTime,
  getStudioDateParts,
  studioDayRange,
  studioWallClockToInstant,
} from "@/lib/formatting/dates";

test("formatStudioDate renders UTC evening timestamps on the Kuwait calendar day", () => {
  const date = new Date("2026-06-09T23:57:46.000Z");

  assert.equal(formatStudioDate(date), "10 Jun 2026");
});

test("formatStudioDateTime renders Kuwait time with 24-hour display", () => {
  const date = new Date("2026-06-09T23:57:46.000Z");

  assert.equal(formatStudioDateTime(date), "10 Jun 2026, 02:57");
});

test("studioDayRange returns UTC instants for the Kuwait calendar day", () => {
  const range = studioDayRange("2026-06-10");

  assert.ok(range);
  assert.equal(range.start.toISOString(), "2026-06-09T21:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-06-10T20:59:59.999Z");
});

test("studioDayRange ignores invalid date input", () => {
  assert.equal(studioDayRange(undefined), undefined);
  assert.equal(studioDayRange("not-a-date"), undefined);
  assert.equal(studioDayRange("2026-02-30"), undefined);
});

test("studioWallClockToInstant stores Kuwait wall-clock sessions as UTC instants", () => {
  const instant = studioWallClockToInstant("2026-06-11", "17:00");

  assert.equal(instant?.toISOString(), "2026-06-11T14:00:00.000Z");
  assert.equal(formatStudioDateTime(instant!), "11 Jun 2026, 17:00");
});

test("studioWallClockToInstant round-trips UTC-date-crossing evening sessions", () => {
  const instant = studioWallClockToInstant("2026-06-11", "23:30");

  assert.equal(instant?.toISOString(), "2026-06-11T20:30:00.000Z");
  assert.equal(formatStudioInputDate(instant!), "2026-06-11");
  assert.equal(formatStudioTime(instant!), "23:30");
});

test("studio input date and time preserve near-midnight edit round-trips", () => {
  const original = studioWallClockToInstant("2026-01-01", "00:30");

  assert.equal(original?.toISOString(), "2025-12-31T21:30:00.000Z");
  const inputDate = formatStudioInputDate(original!);
  const inputTime = formatStudioTime(original!);
  const resaved = studioWallClockToInstant(inputDate, inputTime);

  assert.equal(resaved?.toISOString(), original?.toISOString());
});

test("getStudioDateParts returns the Kuwait calendar year for identifier boundaries", () => {
  const parts = getStudioDateParts(new Date("2025-12-31T21:30:00.000Z"));

  assert.equal(parts?.year, 2026);
  assert.equal(parts?.month, 1);
  assert.equal(parts?.day, 1);
});

test("modules do not use UTC for user-facing date display", () => {
  const violations: string[] = [];

  for (const relativePath of walk("src/modules")) {
    const contents = readFileSync(join(process.cwd(), relativePath), "utf8");
    if (
      contents.includes('timeZone: "UTC"') &&
      !contents.includes("studio-timezone-utc-ok")
    ) {
      violations.push(relativePath);
    }
  }

  assert.deepEqual(violations, []);
});

function walk(relativePath: string): string[] {
  const absolutePath = join(process.cwd(), relativePath);
  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    return /\.(?:ts|tsx)$/.test(relativePath) ? [relativePath] : [];
  }

  return readdirSync(absolutePath).flatMap((entry) =>
    walk(join(relativePath, entry))
  );
}
