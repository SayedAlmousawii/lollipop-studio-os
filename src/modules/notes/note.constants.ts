export const NOTE_KIND = {
  CUSTOMER: "CUSTOMER",
  PHOTOGRAPHER: "PHOTOGRAPHER",
  EDITING: "EDITING",
  PRODUCTION: "PRODUCTION",
  DELIVERY: "DELIVERY",
  INTERNAL: "INTERNAL",
} as const;

export const NOTE_KIND_LABEL: Record<(typeof NOTE_KIND)[keyof typeof NOTE_KIND], string> = {
  CUSTOMER: "Customer",
  PHOTOGRAPHER: "Photographer",
  EDITING: "Editing",
  PRODUCTION: "Production",
  DELIVERY: "Delivery",
  INTERNAL: "Internal",
};
