import assert from "node:assert/strict";
import test from "node:test";
import { generateSessionTypeCode } from "@/modules/session-types/session-type-code";

test("generateSessionTypeCode joins uppercase department prefix and slugified name", () => {
  assert.equal(
    generateSessionTypeCode("KD", "Birthday Party"),
    "KD_BIRTHDAY_PARTY"
  );
  assert.equal(
    generateSessionTypeCode("nb", "Gender-Reveal"),
    "NB_GENDER_REVEAL"
  );
  assert.equal(
    generateSessionTypeCode("KD", "  Cake smash / two years!  "),
    "KD_CAKE_SMASH_TWO_YEARS"
  );
  assert.equal(generateSessionTypeCode("KD", "Café bébé"), "KD_CAF_B_B");
});
