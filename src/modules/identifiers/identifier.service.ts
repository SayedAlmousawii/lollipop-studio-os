import { Prisma } from "@prisma/client";
import {
  PUBLIC_ID_KIND,
  PUBLIC_ID_PREFIX,
  WORKFLOW_REFERENCE_KIND,
  type PublicIdKind,
  type WorkflowReferenceKind,
} from "./identifier.constants";

type IdentifierClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function generatePublicId(
  client: IdentifierClient,
  kind: PublicIdKind
): Promise<string> {
  const nextValue = await nextPublicIdValue(client, kind);
  return `${PUBLIC_ID_PREFIX[kind]}-${String(nextValue).padStart(5, "0")}`;
}

export async function generateJobNumber(
  client: IdentifierClient,
  input: { departmentCode: string; sessionDate: Date }
): Promise<string> {
  return generateWorkflowReference(client, {
    ...input,
    kind: WORKFLOW_REFERENCE_KIND.JOB,
  });
}

export async function generateBookingReference(
  client: IdentifierClient,
  input: { departmentCode: string; sessionDate: Date }
): Promise<string> {
  return generateWorkflowReference(client, {
    ...input,
    kind: WORKFLOW_REFERENCE_KIND.BOOKING,
  });
}

async function generateWorkflowReference(
  client: IdentifierClient,
  input: {
    departmentCode: string;
    sessionDate: Date;
    kind: WorkflowReferenceKind;
  }
): Promise<string> {
  const code = input.departmentCode.trim().toUpperCase();
  const year = input.sessionDate.getUTCFullYear();
  const referencePrefix =
    input.kind === WORKFLOW_REFERENCE_KIND.BOOKING
      ? `${WORKFLOW_REFERENCE_KIND.BOOKING}-${code}-${year}`
      : `${code}-${year}`;
  const referenceLike = `${referencePrefix}-%`;
  const rows =
    input.kind === WORKFLOW_REFERENCE_KIND.BOOKING
      ? await nextBookingReferenceValue(client, {
          code,
          year,
          kind: input.kind,
          referenceLike,
        })
      : await nextJobNumberValue(client, {
          code,
          year,
          kind: input.kind,
          referenceLike,
        });
  const lastValue = rows[0]?.lastValue;
  if (lastValue === undefined) {
    throw new Error("Unable to generate workflow reference");
  }

  return `${referencePrefix}-${String(Number(lastValue)).padStart(5, "0")}`;
}

function nextJobNumberValue(
  client: IdentifierClient,
  input: {
    code: string;
    year: number;
    kind: WorkflowReferenceKind;
    referenceLike: string;
  }
) {
  return client.$queryRaw<Array<{ lastValue: number | bigint }>>`
    INSERT INTO "identifier_sequences" ("scope", "year", "kind", "lastValue", "createdAt", "updatedAt")
    VALUES (
      ${input.code},
      ${input.year},
      ${input.kind},
      (
        SELECT COALESCE(MAX(substring("jobNumber" FROM '[0-9]+$')::INTEGER), 0) + 1
        FROM "jobs"
        WHERE "jobNumber" LIKE ${input.referenceLike}
      ),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("scope", "year", "kind")
    DO UPDATE SET
      "lastValue" = GREATEST(
        "identifier_sequences"."lastValue" + 1,
        (
          SELECT COALESCE(MAX(substring("jobNumber" FROM '[0-9]+$')::INTEGER), 0) + 1
          FROM "jobs"
          WHERE "jobNumber" LIKE ${input.referenceLike}
        )
      ),
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "lastValue"
  `;
}

function nextBookingReferenceValue(
  client: IdentifierClient,
  input: {
    code: string;
    year: number;
    kind: WorkflowReferenceKind;
    referenceLike: string;
  }
) {
  return client.$queryRaw<Array<{ lastValue: number | bigint }>>`
    INSERT INTO "identifier_sequences" ("scope", "year", "kind", "lastValue", "createdAt", "updatedAt")
    VALUES (
      ${input.code},
      ${input.year},
      ${input.kind},
      (
        SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) + 1
        FROM "bookings"
        WHERE "publicId" LIKE ${input.referenceLike}
      ),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("scope", "year", "kind")
    DO UPDATE SET
      "lastValue" = GREATEST(
        "identifier_sequences"."lastValue" + 1,
        (
          SELECT COALESCE(MAX(substring("publicId" FROM '[0-9]+$')::INTEGER), 0) + 1
          FROM "bookings"
          WHERE "publicId" LIKE ${input.referenceLike}
        )
      ),
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "lastValue"
  `;
}

async function nextPublicIdValue(
  client: IdentifierClient,
  kind: PublicIdKind
): Promise<number> {
  const rows = await queryPublicIdSequence(client, kind);
  const value = rows[0]?.value;
  if (value === undefined) {
    throw new Error("Unable to generate public ID");
  }
  return Number(value);
}

function queryPublicIdSequence(
  client: IdentifierClient,
  kind: PublicIdKind
): Promise<Array<{ value: number | bigint }>> {
  switch (kind) {
    case PUBLIC_ID_KIND.ORDER:
      return client.$queryRaw<Array<{ value: number | bigint }>>`
        SELECT nextval('"order_public_id_seq"') AS value
      `;
    case PUBLIC_ID_KIND.INVOICE:
      return client.$queryRaw<Array<{ value: number | bigint }>>`
        SELECT nextval('"invoice_public_id_seq"') AS value
      `;
    case PUBLIC_ID_KIND.PAYMENT:
      return client.$queryRaw<Array<{ value: number | bigint }>>`
        SELECT nextval('"payment_public_id_seq"') AS value
      `;
  }
}
