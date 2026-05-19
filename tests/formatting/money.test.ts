import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMoney,
  formatMoneyInputValue,
  formatSignedMoney,
  parseMoneyInput,
} from "@/lib/formatting/money";

test("formatMoney renders KD values with three decimals by default", () => {
  assert.equal(formatMoney(12), "12.000 KD");
  assert.equal(formatMoney(12.5), "12.500 KD");
  assert.equal(formatMoney(12.5555), "12.556 KD");
  assert.equal(formatMoney(0), "0.000 KD");
  assert.equal(formatMoney(-1), "-1.000 KD");
});

test("formatMoney supports numeric strings, Decimal-like values, currency, and density options", () => {
  assert.equal(formatMoney("1,234.5"), "1234.500 KD");
  assert.equal(formatMoney({ toFixed: (dp: number) => (7.125).toFixed(dp) }), "7.125 KD");
  assert.equal(formatMoney(12.5, { currency: "USD" }), "12.500 USD");
  assert.equal(formatMoney(12.5, { currency: "KD", density: "dense" }), "12.500KD");
});

test("formatSignedMoney centralizes explicit signed display", () => {
  assert.equal(formatSignedMoney(1), "+1.000 KD");
  assert.equal(formatSignedMoney(-1), "-1.000 KD");
  assert.equal(formatSignedMoney(0), "0.000 KD");
  assert.equal(formatSignedMoney(0, { signDisplay: "always" }), "+0.000 KD");
});

test("parseMoneyInput normalizes form and legacy formatted inputs", () => {
  assert.equal(parseMoneyInput(12), 12);
  assert.equal(parseMoneyInput("12.5"), 12.5);
  assert.equal(parseMoneyInput("12.500"), 12.5);
  assert.equal(parseMoneyInput("KD 12.500"), 12.5);
  assert.equal(parseMoneyInput("12.500 KD"), 12.5);
  assert.equal(parseMoneyInput("1,234.500 KD"), 1234.5);
  assert.equal(parseMoneyInput("-1,234.500 KD"), -1234.5);
  assert.equal(parseMoneyInput("not money"), 0);
  assert.equal(formatMoneyInputValue("KD 1,234.5"), "1234.500");
});
