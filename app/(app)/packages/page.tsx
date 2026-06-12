import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { PackagesTable } from "@/components/packages/packages-table";
import { PackagesFilters } from "@/components/packages/packages-filters";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import {
  getPackages,
  getPackageTaxonomyOptions,
  parsePackageFilters,
} from "@/modules/packages/package.service";

export default async function PackagesPage(props: PageProps<"/packages">) {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
  const filters = parsePackageFilters(await props.searchParams);

  let packages: Awaited<ReturnType<typeof getPackages>> = [];
  let taxonomyOptions: Awaited<ReturnType<typeof getPackageTaxonomyOptions>> = {
    departments: [],
  };
  let fetchError = false;

  try {
    [packages, taxonomyOptions] = await Promise.all([
      getPackages(filters),
      getPackageTaxonomyOptions(),
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
          <Button type="button" asChild>
            <Link href="/packages/new">Create Package</Link>
          </Button>
        </div>

        <PackagesFilters taxonomyOptions={taxonomyOptions} />

        {fetchError ? (
          <p className="text-sm text-danger">
            Failed to load packages. Please try refreshing the page.
          </p>
        ) : (
          <PackagesTable packages={packages} />
        )}
      </div>
    </PageContainer>
  );
}
