import { Prisma } from "@prisma/client";
import {
  DEFAULT_DEPARTMENT_JOB_CODE,
  DEPARTMENT_JOB_CODES,
  PUBLIC_ID_KIND,
  PUBLIC_ID_PREFIX,
  type PublicIdKind,
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
  input: { department: string; sessionDate: Date }
): Promise<string> {
  const code = getDepartmentJobCode(input.department);
  const year = input.sessionDate.getUTCFullYear();
  const rows = await client.$queryRaw<Array<{ lastValue: number | bigint }>>`
    INSERT INTO "identifier_sequences" ("scope", "year", "lastValue", "createdAt", "updatedAt")
    VALUES (${code}, ${year}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("scope", "year")
    DO UPDATE SET
      "lastValue" = "identifier_sequences"."lastValue" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "lastValue"
  `;
  const lastValue = rows[0]?.lastValue;
  if (lastValue === undefined) {
    throw new Error("Unable to generate job number");
  }

  return `${code}-${year}-${String(Number(lastValue)).padStart(5, "0")}`;
}

export function getDepartmentJobCode(department: string): string {
  const normalized = department.trim().toLowerCase();
  return DEPARTMENT_JOB_CODES[normalized as keyof typeof DEPARTMENT_JOB_CODES]
    ?? DEFAULT_DEPARTMENT_JOB_CODE;
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
    case PUBLIC_ID_KIND.BOOKING:
      return client.$queryRaw<Array<{ value: number | bigint }>>`
        SELECT nextval('"booking_public_id_seq"') AS value
      `;
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
