import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStudioInputDate,
  formatStudioTime,
  studioWallClockToInstant,
} from "@/lib/formatting/dates";

test("booking edit prefill preserves a near-midnight session instant", () => {
  const original = studioWallClockToInstant("2026-01-01", "00:30");

  assert.equal(original?.toISOString(), "2025-12-31T21:30:00.000Z");
  const editDateValue = formatStudioInputDate(original!);
  const editTimeValue = formatStudioTime(original!);
  const unchangedResave = studioWallClockToInstant(editDateValue, editTimeValue);

  assert.equal(unchangedResave?.toISOString(), original?.toISOString());
});
