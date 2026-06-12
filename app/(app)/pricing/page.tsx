import { PageContainer } from "@/components/layout/page-container";
import { ExtraPhotoPricingTable } from "@/components/pricing/extra-photo-pricing-table";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import { listExtraPhotoPricing } from "@/modules/pricing/extra-photo-pricing.service";

export default async function PricingPage() {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);

  let rows: Awaited<ReturnType<typeof listExtraPhotoPricing>> = [];
  let fetchError = false;

  try {
    rows = await listExtraPhotoPricing();
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
            Manage the digital and print unit prices used for extra selected photos.
          </p>
        </div>

        <div className="rounded-[14px] border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
          Changes apply to invoices generated after this point. Orders already invoiced are not retroactively adjusted.
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
