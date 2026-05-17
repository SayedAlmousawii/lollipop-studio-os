import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

export async function runDuplicateBookingPackageInvariantTest(): Promise<void> {
  const { client, schemaName } = await connectPgToCurrentSchema();

  try {
    const fixture = await createDuplicateBookingPackageFixture(client, schemaName);

    await assert.rejects(
      client.query(
        `INSERT INTO ${quoteSchema(schemaName)}."booking_packages"
          ("id", "bookingId", "packageId", "sessionTypeId", "quantity", "sortOrder", "updatedAt")
         VALUES ($1, $2, $3, $4, 2, 1, now())`,
        [
          `booking_package_duplicate_${fixture.fixtureId}`,
          fixture.bookingId,
          fixture.packageId,
          fixture.sessionTypeId,
        ]
      ),
      (error: unknown) => isPgUniqueViolation(error),
      "expected duplicate booking/package rows to be rejected by a unique constraint"
    );
  } finally {
    await client.end();
  }
}

interface DuplicateBookingPackageFixture {
  fixtureId: string;
  bookingId: string;
  packageId: string;
  sessionTypeId: string;
}

async function createDuplicateBookingPackageFixture(
  client: Client,
  schemaName: string
): Promise<DuplicateBookingPackageFixture> {
  const fixtureId = randomUUID().replace(/-/g, "").slice(0, 10);
  const schema = quoteSchema(schemaName);
  const departmentId = `dept_dbp_${fixtureId}`;
  const sessionTypeId = `session_dbp_${fixtureId}`;
  const packageFamilyId = `family_dbp_${fixtureId}`;
  const packageId = `package_dbp_${fixtureId}`;
  const customerId = `customer_dbp_${fixtureId}`;
  const bookingId = `booking_dbp_${fixtureId}`;

  await client.query(
    `INSERT INTO ${schema}."studio_departments" ("id", "code", "name", "isActive", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, true, 1, now())`,
    [departmentId, `DBP_${fixtureId}`, "Duplicate Booking Package Test"]
  );
  await client.query(
    `INSERT INTO ${schema}."session_types" ("id", "code", "name", "departmentId", "calendarLabel", "isActive", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, true, 1, now())`,
    [
      sessionTypeId,
      `DBP_SESSION_${fixtureId}`,
      "Duplicate Booking Package Session",
      departmentId,
      "Duplicate Booking Package Session",
    ]
  );
  await client.query(
    `INSERT INTO ${schema}."package_families" ("id", "code", "name", "sessionTypeId", "isActive", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, $4, true, 1, now())`,
    [packageFamilyId, `DBP_FAMILY_${fixtureId}`, "Duplicate Booking Package Family", sessionTypeId]
  );
  await client.query(
    `INSERT INTO ${schema}."packages" ("id", "name", "packageFamilyId", "price", "photoCount", "durationMinutes", "isActive", "updatedAt")
     VALUES ($1, $2, $3, 75.000, 8, 45, true, now())`,
    [packageId, "Duplicate Booking Package", packageFamilyId]
  );
  await client.query(
    `INSERT INTO ${schema}."customers" ("id", "name", "phone", "updatedAt")
     VALUES ($1, $2, $3, now())`,
    [customerId, `Duplicate Booking Package Customer ${fixtureId}`, `+9655${fixtureId.slice(0, 7)}`]
  );
  await client.query(
    `INSERT INTO ${schema}."bookings"
      ("id", "customerId", "sessionDate", "sessionTime", "departmentId", "updatedAt")
     VALUES ($1, $2, $3, '09:00', $4, now())`,
    [bookingId, customerId, new Date("2026-05-14T09:00:00.000Z"), departmentId]
  );
  await client.query(
    `INSERT INTO ${schema}."booking_packages"
      ("id", "bookingId", "packageId", "sessionTypeId", "quantity", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, $4, 1, 0, now())`,
    [`booking_package_dbp_${fixtureId}`, bookingId, packageId, sessionTypeId]
  );

  return {
    fixtureId,
    bookingId,
    packageId,
    sessionTypeId,
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

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function quoteSchema(schemaName: string): string {
  return `"${schemaName.replace(/"/g, "\"\"")}"`;
}
