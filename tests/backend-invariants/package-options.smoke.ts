import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function runPackageOptionsSmokeTest(): Promise<void> {
  const [{ db }, { getActivePackageOptions }] = await Promise.all([
    import("../../src/lib/db"),
    import("../../src/modules/packages/package.service"),
  ]);
  const fixtureId = randomUUID().replace(/-/g, "").slice(0, 8);

  try {
    const department = await db.studioDepartment.create({
      data: {
        code: `BT_${fixtureId}`,
        name: "Backend Test",
        isActive: true,
        sortOrder: 1,
      },
    });
    const sessionType = await db.sessionType.create({
      data: {
        code: `BT_REGULAR_${fixtureId}`,
        name: "Backend Test Session",
        departmentId: department.id,
        isActive: true,
        sortOrder: 1,
      },
    });
    const packageFamily = await db.packageFamily.create({
      data: {
        code: `BT_REGULAR_DEFAULT_${fixtureId}`,
        name: "Backend Test Packages",
        sessionTypeId: sessionType.id,
        isActive: true,
        sortOrder: 1,
      },
    });
    const pkg = await db.package.create({
      data: {
        name: "Backend Test Package",
        packageFamilyId: packageFamily.id,
        price: 125,
        photoCount: 12,
        durationMinutes: 45,
        isActive: true,
      },
    });

    const packageOptions = await getActivePackageOptions();
    const createdPackageOption = packageOptions.find((option) => option.id === pkg.id);

    assert.ok(
      createdPackageOption,
      "expected the package options service to return the created package fixture"
    );
    assert.equal(createdPackageOption.name, "Backend Test Package");
    assert.equal(createdPackageOption.photoCount, 12);
    assert.equal(createdPackageOption.durationMinutes, 45);
    assert.equal(createdPackageOption.price, 125);
  } finally {
    await db.$disconnect();
  }
}
