import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { PackageCreateDialog } from "@/components/packages/package-create-dialog";
import { PackagesTable } from "@/components/packages/packages-table";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import { getPackages } from "@/modules/packages/package.service";
import { getActiveProductOptions } from "@/modules/products/product.service";

export default async function PackagesPage() {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);

  let packages: Awaited<ReturnType<typeof getPackages>> = [];
  let productOptions: Awaited<ReturnType<typeof getActiveProductOptions>> = [];
  let fetchError = false;

  try {
    [packages, productOptions] = await Promise.all([
      getPackages(),
      getActiveProductOptions(),
    ]);
  } catch {
    fetchError = true;
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              Packages
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Build commercial bundles from structured product deliverables.
            </p>
          </div>
          <PackageCreateDialog
            productOptions={productOptions}
            trigger={<Button type="button">Create Package</Button>}
          />
        </div>

        {fetchError ? (
          <p className="text-sm text-danger">
            Failed to load packages. Please try refreshing the page.
          </p>
        ) : (
          <PackagesTable packages={packages} productOptions={productOptions} />
        )}
      </div>
    </PageContainer>
  );
}
