export type POSApprovalPayload = {
  reductions: Array<{ lineName: string; amount: string; reason: string }>;
  adjustmentLines: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
  }>;
};

export type HandlerResult<T = void> =
  | { ok: true; value?: T }
  | {
      ok: false;
      errors: Record<string, string[]>;
      approval?: POSApprovalPayload;
    };

export type POSMutationActionState = {
  kind?: "approval-required" | "success" | "error";
  errors?: Partial<Record<string, string[]>>;
  payload?: POSApprovalPayload;
};

export type POSCompositionHandlers = {
  changePackageTier: (input: {
    orderPackageId: string;
    toPackageRefId: string;
  }) => Promise<HandlerResult>;
  upgradePackageItem: (input: {
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }) => Promise<HandlerResult>;
  changeSelectedPhotoCount: (input: {
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }) => Promise<HandlerResult>;
  shouldPromptInlineApproval: boolean;
};

export type POSAddOnHandlers = {
  addAddOn: (input: {
    productId: string;
    quantity: number;
  }) => Promise<HandlerResult>;
  removeAddOn: (input: { addOnId: string }) => Promise<HandlerResult>;
  changeAddOnQuantity: (input: {
    addOnId: string;
    quantity: number;
  }) => Promise<HandlerResult>;
  shouldPromptInlineApproval: boolean;
};
