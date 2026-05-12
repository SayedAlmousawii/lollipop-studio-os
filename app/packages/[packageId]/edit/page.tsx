import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { PackageForm } from "@/components/packages/package-form";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import {
  getPackageTaxonomyOptions,
  getPackageWithItems,
} from "@/modules/packages/package.service";
import { getActiveProductOptions } from "@/modules/products/product.service";

export default async function EditPackagePage(
  props: {
    params: Promise<{ packageId: string }>;
  }
) {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
  const { packageId } = await props.params;
  const [packageRecord, productOptions, taxonomyOptions] = await Promise.all([
    getPackageWithItems(packageId),
    getActiveProductOptions(),
    getPackageTaxonomyOptions(),
  ]);

  if (!packageRecord) notFound();

  return (
    <PageContainer>
      <div className="mx-auto max-w-5xl space-y-8">
        <Button type="button" variant="ghost" asChild className="px-0 text-text-secondary hover:text-text-primary">
          <Link href="/packages">
            <ChevronLeft className="h-4 w-4" />
            Back to Packages
          </Link>
        </Button>

        <div>
          <h1 className="text-[28px] font-semibold text-text-primary">
            Edit Package
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Update pricing, status, and included deliverables without touching existing orders or invoices.
          </p>
        </div>

        <div className="rounded-[14px] border border-border bg-surface p-8">
          <PackageForm
            mode="edit"
            packageId={packageRecord.id}
            productOptions={productOptions}
            taxonomyOptions={taxonomyOptions}
            presentation="page"
            cancelHref="/packages"
            defaultValues={{
              name: packageRecord.name,
              departmentId: packageRecord.departmentId,
              sessionTypeId: packageRecord.sessionTypeId,
              packageFamilyId: packageRecord.packageFamilyId,
              price: packageRecord.priceValue.toFixed(3),
              photoCount: String(packageRecord.photoCount),
              durationMinutes: String(packageRecord.durationMinutes),
              description: packageRecord.description,
              isActive: packageRecord.isActive ? "on" : "",
              items: packageRecord.items.map((item) => ({
                productId: item.productId,
                quantity: String(item.quantity),
                priceSnapshot: item.priceSnapshotValue.toFixed(3),
                sortOrder: String(item.sortOrder),
              })),
            }}
          />
        </div>
      </div>
    </PageContainer>
  );
}
