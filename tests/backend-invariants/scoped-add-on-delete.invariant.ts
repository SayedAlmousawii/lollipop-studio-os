import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

interface ScopedAddOnFixture {
  orderId: string;
  orderPackageId: string;
  scopedAddOnId: string;
  unscopedAddOnId: string;
}

export async function runScopedAddOnDeleteInvariantTest(): Promise<void> {
  const { client, schemaName } = await connectPgToCurrentSchema();

  try {
    const fixture = await createScopedAddOnFixture(client, schemaName);

    await client.query(
      `DELETE FROM ${quoteSchema(schemaName)}."order_packages" WHERE "id" = $1`,
      [fixture.orderPackageId]
    );

    const addOns = await client.query<{
      id: string;
      orderPackageId: string | null;
    }>(
      `SELECT "id", "orderPackageId"
       FROM ${quoteSchema(schemaName)}."order_add_ons"
       WHERE "orderId" = $1
       ORDER BY "createdAt" ASC`,
      [fixture.orderId]
    );

    assert.deepEqual(addOns.rows, [
      {
        id: fixture.unscopedAddOnId,
        orderPackageId: null,
      },
    ]);

    const scopedAddOn = await client.query<{ id: string }>(
      `SELECT "id"
       FROM ${quoteSchema(schemaName)}."order_add_ons"
       WHERE "id" = $1`,
      [fixture.scopedAddOnId]
    );
    assert.equal(scopedAddOn.rowCount, 0);
  } finally {
    await client.end();
  }
}

async function createScopedAddOnFixture(
  client: Client,
  schemaName: string
): Promise<ScopedAddOnFixture> {
  const fixtureId = randomUUID().replace(/-/g, "").slice(0, 10);
  const schema = quoteSchema(schemaName);
  const departmentId = `dept_${fixtureId}`;
  const sessionTypeId = `session_${fixtureId}`;
  const packageFamilyId = `family_${fixtureId}`;
  const packageId = `package_${fixtureId}`;
  const productId = `product_${fixtureId}`;
  const customerId = `customer_${fixtureId}`;
  const jobId = `job_${fixtureId}`;
  const bookingId = `booking_${fixtureId}`;
  const financialCaseId = `case_${fixtureId}`;
  const orderId = `order_${fixtureId}`;
  const orderPackageId = `line_${fixtureId}`;
  const scopedAddOnId = `scoped_${fixtureId}`;
  const unscopedAddOnId = `unscoped_${fixtureId}`;
  const jobNumber = `JOB-SAD-${fixtureId}`;

  await client.query(
    `INSERT INTO ${schema}."studio_departments" ("id", "code", "name", "isActive", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, true, 1, now())`,
    [departmentId, `SAD_${fixtureId}`, "Scoped Add-On Delete Test"]
  );
  await client.query(
    `INSERT INTO ${schema}."session_types" ("id", "code", "name", "departmentId", "calendarLabel", "isActive", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, true, 1, now())`,
    [
      sessionTypeId,
      `SAD_SESSION_${fixtureId}`,
      "Scoped Add-On Session",
      departmentId,
      "Scoped Add-On Session",
    ]
  );
  await client.query(
    `INSERT INTO ${schema}."package_families" ("id", "code", "name", "sessionTypeId", "isActive", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, $4, true, 1, now())`,
    [packageFamilyId, `SAD_FAMILY_${fixtureId}`, "Scoped Add-On Packages", sessionTypeId]
  );
  await client.query(
    `INSERT INTO ${schema}."packages" ("id", "name", "packageFamilyId", "price", "photoCount", "durationMinutes", "isActive", "updatedAt")
     VALUES ($1, $2, $3, 60.000, 10, 45, true, now())`,
    [packageId, "Scoped Add-On Package", packageFamilyId]
  );
  await client.query(
    `INSERT INTO ${schema}."products" ("id", "name", "category", "canonicalPrice", "isPackageDeliverable", "isAddOn", "updatedAt")
     VALUES ($1, $2, 'OTHER', 5.000, false, true, now())`,
    [productId, "Scoped Add-On Product"]
  );
  await client.query(
    `INSERT INTO ${schema}."customers" ("id", "name", "phone", "updatedAt")
     VALUES ($1, $2, $3, now())`,
    [customerId, `Scoped Add-On Customer ${fixtureId}`, `+9656${fixtureId.slice(0, 7)}`]
  );
  await client.query(
    `INSERT INTO ${schema}."jobs" ("id", "jobNumber", "customerId", "updatedAt")
     VALUES ($1, $2, $3, now())`,
    [jobId, jobNumber, customerId]
  );
  await client.query(
    `INSERT INTO ${schema}."bookings"
      ("id", "publicId", "jobNumber", "jobId", "customerId", "sessionDate", "sessionTime", "departmentId", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, '11:00', $7, now())`,
    [
      bookingId,
      `BK-SAD-${fixtureId}`,
      jobNumber,
      jobId,
      customerId,
      new Date("2026-05-14T11:00:00.000Z"),
      departmentId,
    ]
  );
  await client.query(
    `INSERT INTO ${schema}."financial_cases" ("id", "bookingId", "customerId", "jobId", "updatedAt")
     VALUES ($1, $2, $3, $4, now())`,
    [financialCaseId, bookingId, customerId, jobId]
  );
  await client.query(
    `INSERT INTO ${schema}."orders" ("id", "publicId", "jobNumber", "jobId", "bookingId", "customerId", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [orderId, `ORD-SAD-${fixtureId}`, jobNumber, jobId, bookingId, customerId]
  );
  await client.query(
    `INSERT INTO ${schema}."order_packages"
      ("id", "orderId", "packageId", "sessionTypeId", "originalPackagePriceSnapshot", "finalPackagePriceSnapshot", "selectedPhotoCount", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, $4, 60.000, 60.000, 10, 0, now())`,
    [orderPackageId, orderId, packageId, sessionTypeId]
  );
  await client.query(
    `INSERT INTO ${schema}."order_add_ons"
      ("id", "orderId", "orderPackageId", "productId", "nameSnapshot", "priceSnapshot", "quantity", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 5.000, 1, now())`,
    [scopedAddOnId, orderId, orderPackageId, productId, "Scoped Add-On Product"]
  );
  await client.query(
    `INSERT INTO ${schema}."order_add_ons"
      ("id", "orderId", "productId", "nameSnapshot", "priceSnapshot", "quantity", "updatedAt")
     VALUES ($1, $2, $3, $4, 3.000, 1, now())`,
    [unscopedAddOnId, orderId, productId, "Unscoped Add-On Product"]
  );

  return {
    orderId,
    orderPackageId,
    scopedAddOnId,
    unscopedAddOnId,
  };
}

async function connectPgToCurrentSchema(): Promise<{
  client: Client;
  schemaName: string;
}> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const url = new URL(databaseUrl);
  const schemaName = url.searchParams.get("schema");
  if (!schemaName) {
    throw new Error("DATABASE_URL schema is not set");
  }
  url.searchParams.delete("schema");

  const client = new Client({ connectionString: url.toString() });
  await client.connect();

  return { client, schemaName };
}

function quoteSchema(schemaName: string): string {
  return `"${schemaName.replace(/"/g, "\"\"")}"`;
}
