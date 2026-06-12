import Link from "next/link";
import { Plus } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { DevResetSessionConfigurationsButton } from "@/components/session-configurations/dev-reset-session-configurations-button";
import { SessionConfigurationCreateDialog } from "@/components/session-configurations/session-configuration-create-dialog";
import { SessionConfigurationTable } from "@/components/session-configurations/session-configuration-table";
import { Button } from "@/components/ui/button";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import { listActiveProducts } from "@/modules/products/product.service";
import {
  listSessionConfigurations,
} from "@/modules/session-configurations/session-configuration.service";
import { listSessionTypes } from "@/modules/session-types/session-type.service";

export default async function SessionConfigurationsPage(
  props: PageProps<"/session-configurations">
) {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);

  const searchParams = await props.searchParams;
  const includeArchived = searchParams.includeArchived === "1";
  let configurations: Awaited<ReturnType<typeof listSessionConfigurations>> = [];
  let sessionTypes: Awaited<ReturnType<typeof listSessionTypes>> = [];
  let products: Awaited<ReturnType<typeof listActiveProducts>> = [];
  let fetchError = false;

  try {
    [configurations, sessionTypes, products] = await Promise.all([
      listSessionConfigurations({ includeArchived }),
      listSessionTypes({ includeArchived: false }),
      listActiveProducts(),
    ]);
  } catch (error) {
    console.error("Failed to load session configurations", error);
    fetchError = true;
  }

  const sessionTypeOptions = sessionTypes.map((sessionType) => ({
    id: sessionType.id,
    code: sessionType.code,
    name: sessionType.name,
  }));
  const showDevReset = process.env.NODE_ENV === "development";

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              Session Configurations
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Manage operational and pricing modifiers shown during session setup.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {showDevReset ? <DevResetSessionConfigurationsButton /> : null}
            <Button type="button" variant="outline" asChild>
              <Link
                href={
                  includeArchived
                    ? "/session-configurations"
                    : "/session-configurations?includeArchived=1"
                }
              >
                {includeArchived ? "Hide Archived" : "Include Archived"}
              </Link>
            </Button>
            {!fetchError && sessionTypeOptions.length > 0 ? (
              <SessionConfigurationCreateDialog
                sessionTypes={sessionTypeOptions}
                products={products}
                trigger={
                  <Button type="button">
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    New Configuration
                  </Button>
                }
              />
            ) : null}
          </div>
        </div>

        {fetchError ? (
          <p className="text-sm text-danger">
            Failed to load session configurations. Please try refreshing the page.
          </p>
        ) : (
          <SessionConfigurationTable
            configurations={configurations}
            sessionTypes={sessionTypeOptions}
            products={products}
          />
        )}
      </div>
    </PageContainer>
  );
}
