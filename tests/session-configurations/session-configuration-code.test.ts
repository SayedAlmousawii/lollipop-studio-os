import assert from "node:assert/strict";
import test from "node:test";
import { generateSessionConfigurationCode } from "@/modules/session-configurations/session-configuration-code";

test("session configuration code uses the session type code boundary", () => {
  assert.equal(
    generateSessionConfigurationCode("KD_BIRTHDAY", "Cake Theme"),
    "KD_BIRTHDAY__CAKE_THEME"
  );
});
