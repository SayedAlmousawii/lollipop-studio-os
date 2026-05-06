export const PUBLIC_ID_KIND = {
  BOOKING: "BOOKING",
  ORDER: "ORDER",
  INVOICE: "INVOICE",
  PAYMENT: "PAYMENT",
} as const;

export type PublicIdKind =
  (typeof PUBLIC_ID_KIND)[keyof typeof PUBLIC_ID_KIND];

export const PUBLIC_ID_PREFIX: Record<PublicIdKind, string> = {
  [PUBLIC_ID_KIND.BOOKING]: "BKG",
  [PUBLIC_ID_KIND.ORDER]: "ORD",
  [PUBLIC_ID_KIND.INVOICE]: "INV-PUB",
  [PUBLIC_ID_KIND.PAYMENT]: "PAY",
};
