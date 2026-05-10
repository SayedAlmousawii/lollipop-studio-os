export type WorkflowGuardErrorCode =
  | "ACTOR_MISSING"
  | "PAYMENT_OVERRIDE_NOT_ALLOWED"
  | "PAYMENT_OVERRIDE_REASON_MISSING";

export class WorkflowGuardError extends Error {
  readonly code: WorkflowGuardErrorCode;
  constructor(code: WorkflowGuardErrorCode, message: string) {
    super(message);
    this.name = "WorkflowGuardError";
    this.code = code;
  }
}
