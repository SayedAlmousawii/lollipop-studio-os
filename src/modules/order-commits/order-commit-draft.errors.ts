export class OrderCommitDraftMissingError extends Error {
  constructor(orderId: string, action: string) {
    super(
      `OrderCommitDraft ${action} failed: draft for order ${orderId} was not found.`
    );
    this.name = "OrderCommitDraftMissingError";
  }
}

export class OrderCommitDraftStaleVersionError extends Error {
  constructor(expectedVersion: number, currentVersion: number, draftId: string) {
    super(
      `OrderCommitDraft operation failed: stale expectedVersion ${expectedVersion} for draft ${draftId}; current version is ${currentVersion}.`
    );
    this.name = "OrderCommitDraftStaleVersionError";
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
    this.draftId = draftId;
  }

  readonly expectedVersion: number;
  readonly currentVersion: number;
  readonly draftId: string;
}

export class OrderCommitDraftPermissionError extends Error {
  constructor(actorUserId: string, draftId: string, action: string) {
    super(
      `OrderCommitDraft ${action} failed: actor ${actorUserId} cannot mutate draft ${draftId}.`
    );
    this.name = "OrderCommitDraftPermissionError";
  }
}
