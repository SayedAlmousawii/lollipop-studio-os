import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { ProductCreateDialog } from "@/components/products/product-create-dialog";
import { ProductsTable } from "@/components/products/products-table";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import { getProducts } from "@/modules/products/product.service";

export default async function ProductsPage() {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);

  let products: Awaited<ReturnType<typeof getProducts>> = [];
  let fetchError = false;

  try {
    products = await getProducts();
  } catch {
    fetchError = true;
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              Products
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Manage canonical package deliverables and their studio prices.
            </p>
          </div>
          <ProductCreateDialog
            trigger={<Button type="button">Create Product</Button>}
          />
        </div>

        {fetchError ? (
          <p className="text-sm text-danger">
            Failed to load products. Please try refreshing the page.
          </p>
        ) : (
          <ProductsTable products={products} />
        )}
      </div>
    </PageContainer>
  );
}
