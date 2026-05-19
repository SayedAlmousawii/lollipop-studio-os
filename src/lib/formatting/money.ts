type DecimalLike = {
  toFixed(dp: number): string;
};

export type MoneyValue = number | string | DecimalLike | null | undefined;

export type MoneyFormatOptions = {
  currency?: string;
  density?: "compact" | "dense";
  signDisplay?: "never" | "exceptZero" | "always";
};

export function formatMoney(
  amount: MoneyValue,
  options: MoneyFormatOptions = {}
): string {
  const currency = options.currency ?? "KD";
  const density = options.density ?? "compact";
  const signDisplay = options.signDisplay ?? "never";
  const absoluteAmount = signDisplay === "never" ? amount : absMoneyValue(amount);
  const value = toFixedMoney(absoluteAmount);
  const sign = moneySign(amount, signDisplay);
  const separator = currency.length > 0 && density === "compact" ? " " : "";

  return `${sign}${value}${currency ? `${separator}${currency}` : ""}`;
}

export function formatSignedMoney(
  amount: MoneyValue,
  options: Omit<MoneyFormatOptions, "signDisplay"> & {
    signDisplay?: "exceptZero" | "always";
  } = {}
): string {
  return formatMoney(amount, {
    ...options,
    signDisplay: options.signDisplay ?? "exceptZero",
  });
}

export function parseMoneyInput(raw: MoneyValue): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "object") {
    const parsed = Number(raw.toFixed(3));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const match = raw.match(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/);
  const parsed = Number(match?.[0].replace(/,/g, "") ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoneyInputValue(raw: MoneyValue): string {
  return parseMoneyInput(raw).toFixed(3);
}

function toFixedMoney(amount: MoneyValue): string {
  if (amount === null || amount === undefined) return "0.000";
  if (typeof amount === "number") {
    return Number.isFinite(amount) ? amount.toFixed(3) : "0.000";
  }
  if (typeof amount === "string") {
    return parseMoneyInput(amount).toFixed(3);
  }
  return amount.toFixed(3);
}

function absMoneyValue(amount: MoneyValue): MoneyValue {
  if (typeof amount === "number") return Math.abs(amount);
  if (typeof amount === "string") return Math.abs(parseMoneyInput(amount));
  if (amount === null || amount === undefined) return amount;
  return Math.abs(parseMoneyInput(amount));
}

function moneySign(
  amount: MoneyValue,
  signDisplay: NonNullable<MoneyFormatOptions["signDisplay"]>
): string {
  if (signDisplay === "never") return "";
  const numericAmount = parseMoneyInput(amount);
  if (numericAmount > 0) return "+";
  if (numericAmount < 0) return "-";
  return signDisplay === "always" ? "+" : "";
}
