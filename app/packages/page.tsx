import { PageContainer } from "@/components/layout/page-container";
import { PackagesFilters } from "@/components/packages/packages-filters";
import { PackagesTable } from "@/components/packages/packages-table";
import { getPackages } from "@/modules/packages/package.service";

export default async function PackagesPage() {
  let packages: Awaited<ReturnType<typeof getPackages>> = [];
  let fetchError = false;

  try {
    packages = await getPackages();
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
              View and manage your studio packages
            </p>
          </div>
        </div>

        {fetchError ? (
          <p className="text-sm text-danger">
            Failed to load packages. Please try refreshing the page.
          </p>
        ) : (
          <>
            {/* Filters */}
            <PackagesFilters />

            {/* Table */}
            <PackagesTable packages={packages} />
          </>
        )}
      </div>
    </PageContainer>
  );
}
