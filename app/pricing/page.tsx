import { PageContainer } from "@/components/layout/page-container";
import { ExtraPhotoPricingTable } from "@/components/pricing/extra-photo-pricing-table";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import { getExtraPhotoPricingCatalog } from "@/modules/pricing/pricing.service";

export default async function PricingPage() {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);

  let rows: Awaited<ReturnType<typeof getExtraPhotoPricingCatalog>> = [];
  let fetchError = false;

  try {
    rows = await getExtraPhotoPricingCatalog();
  } catch (error) {
    console.error("Failed to load extra-photo pricing catalog", error);
    fetchError = true;
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] font-semibold text-text-primary">
            Extra Photo Pricing
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Extra-photo prices are seeded. Contact engineering to update.
          </p>
        </div>

        {fetchError ? (
          <p className="text-sm text-danger">
            Failed to load extra-photo prices. Please try refreshing the page.
          </p>
        ) : (
          <ExtraPhotoPricingTable rows={rows} />
        )}
      </div>
    </PageContainer>
  );
}
