export const PUBLIC_ID_KIND = {
  ORDER: "ORDER",
  INVOICE: "INVOICE",
  PAYMENT: "PAYMENT",
} as const;

export type PublicIdKind =
  (typeof PUBLIC_ID_KIND)[keyof typeof PUBLIC_ID_KIND];

export const PUBLIC_ID_PREFIX: Record<PublicIdKind, string> = {
  [PUBLIC_ID_KIND.ORDER]: "ORD",
  [PUBLIC_ID_KIND.INVOICE]: "INV-PUB",
  [PUBLIC_ID_KIND.PAYMENT]: "PAY",
};

export const WORKFLOW_REFERENCE_KIND = {
  BOOKING: "BK",
  JOB: "JOB",
} as const;

export type WorkflowReferenceKind =
  (typeof WORKFLOW_REFERENCE_KIND)[keyof typeof WORKFLOW_REFERENCE_KIND];
