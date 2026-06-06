export type WorkflowGuardErrorCode =
  | "ACTOR_MISSING"
  | "PAYMENT_SUMMARY_MISSING"
  | "PAYMENT_OVERRIDE_NOT_ALLOWED"
  | "PAYMENT_OVERRIDE_REASON_MISSING"
  | "EDITING_INCOMPLETE"
  | "ALBUM_DESIGN_INCOMPLETE";

export class WorkflowGuardError extends Error {
  readonly code: WorkflowGuardErrorCode;
  constructor(code: WorkflowGuardErrorCode, message: string) {
    super(message);
    this.name = "WorkflowGuardError";
    this.code = code;
  }
}

export class OrderCommitDraftActiveError extends Error {
  constructor() {
    super(
      "An order commit draft is in progress for this order. Use the staged sales workflow to apply changes."
    );
    this.name = "OrderCommitDraftActiveError";
  }
}
