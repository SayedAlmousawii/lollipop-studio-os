import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { PackageForm } from "@/components/packages/package-form";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import { getActiveProductOptions } from "@/modules/products/product.service";

export default async function NewPackagePage() {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
  const productOptions = await getActiveProductOptions();

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
            New Package
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Build a commercial bundle with structured deliverables and a visible package adjustment.
          </p>
        </div>

        <div className="rounded-[14px] border border-border bg-surface p-8">
          <PackageForm
            mode="create"
            productOptions={productOptions}
            presentation="page"
            cancelHref="/packages"
          />
        </div>
      </div>
    </PageContainer>
  );
}
