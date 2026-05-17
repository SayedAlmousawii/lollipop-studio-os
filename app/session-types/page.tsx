import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { SessionTypeCreateDialog } from "@/components/session-types/session-type-create-dialog";
import { SessionTypeTable } from "@/components/session-types/session-type-table";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import { getActiveStudioDepartments } from "@/modules/departments/studio-department.service";
import { listSessionTypes } from "@/modules/session-types/session-type.service";

export default async function SessionTypesPage(
  props: PageProps<"/session-types">
) {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);

  const searchParams = await props.searchParams;
  const includeArchived = searchParams.includeArchived === "1";
  let sessionTypes: Awaited<ReturnType<typeof listSessionTypes>> = [];
  let departments: Awaited<ReturnType<typeof getActiveStudioDepartments>> = [];
  let fetchError = false;

  try {
    [sessionTypes, departments] = await Promise.all([
      listSessionTypes({ includeArchived }),
      getActiveStudioDepartments(),
    ]);
  } catch (error) {
    console.error("Failed to load session types", error);
    fetchError = true;
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              Session Types
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Manage department session labels, calendar display, and archive status.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" asChild>
              <Link
                href={
                  includeArchived
                    ? "/session-types"
                    : "/session-types?includeArchived=1"
                }
              >
                {includeArchived ? "Hide Archived" : "Include Archived"}
              </Link>
            </Button>
            {!fetchError && departments.length > 0 ? (
              <SessionTypeCreateDialog
                departments={departments}
                trigger={
                  <Button type="button">
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    New Session Type
                  </Button>
                }
              />
            ) : null}
          </div>
        </div>

        <div className="rounded-[14px] border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          New session types start with 0 KD extra-photo prices until pricing is configured.
        </div>

        {fetchError ? (
          <p className="text-sm text-danger">
            Failed to load session types. Please try refreshing the page.
          </p>
        ) : (
          <SessionTypeTable
            sessionTypes={sessionTypes}
            departments={departments}
          />
        )}
      </div>
    </PageContainer>
  );
}
