import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  createOrderCommitDocumentLinks,
  ORDER_COMMIT_DOCUMENT_ROLE,
} from "@/modules/order-commits";
import type { OrderCommitDocumentRole } from "@/modules/order-commits";

type DocumentRow = {
  orderCommitId: string;
  invoiceId: string;
  role: OrderCommitDocumentRole;
};

test("creates one invoice document link per emission role", async () => {
  const client = fakeDocumentClient();

  const result = await createOrderCommitDocumentLinks({
    orderCommitId: "commit-1",
    emissions: [
      {
        invoice: { id: "base-invoice" },
        role: ORDER_COMMIT_DOCUMENT_ROLE.BASE_INVOICE,
      },
      {
        invoice: { id: "adjustment-invoice" },
        role: ORDER_COMMIT_DOCUMENT_ROLE.ADJUSTMENT_INVOICE,
      },
      {
        invoice: { id: "credit-note" },
        role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE,
      },
    ],
    client: client.transaction,
  });

  assert.deepEqual(result, { created: 3 });
  assert.deepEqual(client.rows, [
    {
      orderCommitId: "commit-1",
      invoiceId: "base-invoice",
      role: ORDER_COMMIT_DOCUMENT_ROLE.BASE_INVOICE,
    },
    {
      orderCommitId: "commit-1",
      invoiceId: "adjustment-invoice",
      role: ORDER_COMMIT_DOCUMENT_ROLE.ADJUSTMENT_INVOICE,
    },
    {
      orderCommitId: "commit-1",
      invoiceId: "credit-note",
      role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE,
    },
  ]);
});

test("returns zero without writing when there are no emissions", async () => {
  const client = fakeDocumentClient();

  const result = await createOrderCommitDocumentLinks({
    orderCommitId: "commit-1",
    emissions: [],
    client: client.transaction,
  });

  assert.deepEqual(result, { created: 0 });
  assert.equal(client.createManyCalls, 0);
  assert.deepEqual(client.rows, []);
});

test("surfaces duplicate link unique-constraint errors", async () => {
  const client = fakeDocumentClient({
    rows: [
      {
        orderCommitId: "commit-1",
        invoiceId: "invoice-1",
        role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE,
      },
    ],
  });

  await assert.rejects(
    createOrderCommitDocumentLinks({
      orderCommitId: "commit-1",
      emissions: [
        {
          invoice: { id: "invoice-1" },
          role: ORDER_COMMIT_DOCUMENT_ROLE.CREDIT_NOTE,
        },
      ],
      client: client.transaction,
    }),
    (error) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
  );
  assert.equal(client.rows.length, 1);
});

test("writer source stays invoice-link-only and Task 5 scoped", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/modules/order-commits/order-commit-document.service.ts"
    ),
    "utf8"
  );

  assert.doesNotMatch(source, /@\/modules\/payments/);
  assert.doesNotMatch(source, /@\/modules\/refunds/);
  assert.doesNotMatch(source, /@\/modules\/audit/);
  assert.doesNotMatch(source, /@\/modules\/adjustment-workspace/);
  assert.doesNotMatch(source, /\bpayment\./i);
  assert.doesNotMatch(source, /\brefund\./i);
  assert.doesNotMatch(source, /\bauditLog\./);
  assert.doesNotMatch(source, /\badjustmentWorkspace\./);
  assert.doesNotMatch(source, /\bcommitOrderChanges\b/);
});

function fakeDocumentClient(input?: { rows?: DocumentRow[] }) {
  const rows = [...(input?.rows ?? [])];
  let createManyCalls = 0;

  return {
    rows,
    get createManyCalls() {
      return createManyCalls;
    },
    transaction: {
      orderCommitDocument: {
        createMany: async (args: { data: DocumentRow[] }) => {
          createManyCalls += 1;
          for (const row of args.data) {
            if (rows.some((existing) => uniqueKey(existing) === uniqueKey(row))) {
              throw new Prisma.PrismaClientKnownRequestError(
                "Unique constraint failed on the fields: (`orderCommitId`,`invoiceId`,`role`)",
                {
                  code: "P2002",
                  clientVersion: "test",
                  meta: {
                    target: ["orderCommitId", "invoiceId", "role"],
                  },
                }
              );
            }
          }

          rows.push(...args.data);
          return { count: args.data.length };
        },
      },
    } as unknown as Prisma.TransactionClient,
  };
}

function uniqueKey(row: DocumentRow): string {
  return `${row.orderCommitId}:${row.invoiceId}:${row.role}`;
}
