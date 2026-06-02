import { notFound } from "next/navigation";
import { stageSalesChangeAction } from "@/app/orders/[orderId]/sales/actions";
import { requireCurrentAppUser } from "@/lib/auth";
import { CurrentCompositionCard } from "@/components/orders/current-composition-card";
import { FinancialSidebarDraft } from "@/components/orders/financial-sidebar-draft";
import { FinancialSidebarLocked } from "@/components/orders/financial-sidebar-locked";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import {
  POSPackageComposition,
  POSPhotoCountCard,
} from "@/components/orders/pos-package-composition";
import { SalesStagedCommitControls } from "@/components/orders/sales-staged-commit-controls";
import { ConfigureSessionPanel } from "@/components/session-configurations/configure-session-panel";
import { Card, CardContent } from "@/components/ui/card";
import {
  getOpenWorkspaceForInvoice,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import {
  getFinancialCaseSummary,
  toSalesSidebarLocked,
} from "@/modules/financial-cases";
import {
  getLockedOrderCompositionViewModel,
  toCurrentCompositionCard,
  toPOSAddOnMarketplace,
} from "@/modules/orders/composition";
import {
  getLinkedFinancialDocumentsForOrder,
  getPOSWorkspace,
} from "@/modules/orders/order.service";
import {
  buildPOSAddOnEditPolicies,
  buildPOSFinancialSidebarEditPolicies,
  buildPOSPackageCompositionEditPolicies,
  orderEditModeContextFromWorkspace,
} from "@/modules/orders/policies/edit-mode-policy";
import type { POSWorkspace } from "@/modules/orders/order.types";
import { getSalesPageView } from "@/modules/order-commits/projections";
import {
  createOrderCommitSalesAddOnHandlers,
  createOrderCommitSalesCompositionHandlers,
} from "@/modules/order-commits/sales-staging-handler-adapter";
import styles from "./sales-page.module.css";

export default async function SalesPage(
  props: PageProps<"/orders/[orderId]/sales">
) {
  const { orderId } = await props.params;
  const [workspace, appUser] = await Promise.all([
    getPOSWorkspace(orderId),
    requireCurrentAppUser(),
  ]);
  if (!workspace) notFound();

  if (workspace.invoice?.isLocked) {
    const [
      compositionModel,
      openWorkspace,
      linkedDocuments,
      financialCaseSummary,
    ] = await Promise.all([
      getLockedOrderCompositionViewModel({
        invoiceId: workspace.invoice.invoiceId,
      }),
      getOpenWorkspaceForInvoice(workspace.invoice.invoiceId),
      getLinkedFinancialDocumentsForOrder(workspace.orderId),
      getFinancialCaseSummary({ orderId: workspace.orderId }),
    ]);
    const currentComposition = toCurrentCompositionCard(compositionModel, {
      mode: "locked",
      source: "effective",
    });
    const lockedPolicyContext = orderEditModeContextFromWorkspace({
      orderId: workspace.orderId,
      orderStatus: workspace.orderStatusRaw,
      finalInvoiceIsLocked: true,
      openAdjustmentWorkspaceId: openWorkspace?.id ?? null,
      persistenceContext: "sales",
    });
    const packageEditPolicies =
      buildPOSPackageCompositionEditPolicies(lockedPolicyContext);
    const financialSummary = financialCaseSummary
      ? toSalesSidebarLocked(financialCaseSummary)
      : null;
    if (financialSummary && financialCaseSummary?.stage === "active") {
      console.info(
        JSON.stringify({
          metric: "sales_page.locked.rendered",
          orderId: workspace.orderId,
          financialCaseId: financialCaseSummary.financialCaseId,
          invoiceId: workspace.invoice.invoiceId,
        })
      );
    } else if (financialCaseSummary?.stage === "active") {
      console.error(
        JSON.stringify({
          metric: "sales_page.locked.financial_projection_missing",
          orderId: workspace.orderId,
          invoiceId: workspace.invoice.invoiceId,
          financialCaseId: financialCaseSummary?.financialCaseId ?? null,
          stage: financialCaseSummary?.stage ?? null,
        })
      );
    } else if (financialCaseSummary) {
      console.info(
        JSON.stringify({
          metric: "sales_page.locked.inactive_stage",
          orderId: workspace.orderId,
          invoiceId: workspace.invoice.invoiceId,
          financialCaseId: financialCaseSummary.financialCaseId,
          stage: financialCaseSummary.stage,
        })
      );
    }

    return (
      <div className={styles.salesGrid}>
        <main className="space-y-5">
          <LockedCompositionView
            composition={currentComposition}
            packageLines={workspace.packageLines}
            orderId={workspace.orderId}
            editPolicies={packageEditPolicies}
          />
        </main>
        {financialSummary ? (
          <FinancialSidebarLocked
            workspace={workspace}
            linkedDocuments={linkedDocuments}
            financialSummary={financialSummary}
            openWorkspace={openWorkspace}
            currentUserId={appUser.id}
            isManager={appUser.role === "ADMIN" || appUser.role === "MANAGER"}
            className={styles.financialSidebar}
          />
        ) : (
          <aside className={styles.financialSidebar}>
            <Card className="border-danger/30">
              <CardContent className="p-5">
                <p className="text-sm text-text-secondary">
                  Financial summary unavailable. Please refresh or contact an administrator.
                </p>
              </CardContent>
            </Card>
          </aside>
        )}
      </div>
    );
  }

  const salesPageView = await getSalesPageView({
    orderId,
    actorContext: {
      actorUserId: appUser.id,
      actorRole: appUser.role,
    },
    dependencies: {
      getPOSWorkspace: async () => workspace,
    },
  });
  const addOnMarketplace = toPOSAddOnMarketplace(salesPageView.composition);
  const draftPolicyContext = orderEditModeContextFromWorkspace({
    orderId: workspace.orderId,
    orderStatus: workspace.orderStatusRaw,
    finalInvoiceIsLocked: workspace.invoice?.isLocked ?? false,
    persistenceContext: "sales",
  });
  const packageEditPolicies =
    buildPOSPackageCompositionEditPolicies(draftPolicyContext);
  const addOnEditPolicies = buildPOSAddOnEditPolicies(draftPolicyContext);
  const financialSidebarPolicies =
    buildPOSFinancialSidebarEditPolicies(draftPolicyContext);
  const compositionHandlers = createOrderCommitSalesCompositionHandlers({
    orderId,
    expectedVersion: salesPageView.draft?.version ?? 0,
    stageSalesChangeAction,
  });
  const addOnHandlers = createOrderCommitSalesAddOnHandlers();

  return (
    <div className={styles.salesGrid}>
      <main className="space-y-5">
        <POSPackageComposition
          workspace={workspace}
          composition={salesPageView.composition}
          handlers={compositionHandlers}
          editPolicies={packageEditPolicies}
        />
        <POSPhotoCountCard
          workspace={workspace}
          composition={salesPageView.composition}
          handlers={compositionHandlers}
          editPolicies={packageEditPolicies}
        />
        <POSAddOnMarketplace
          workspace={workspace}
          marketplace={addOnMarketplace}
          handlers={addOnHandlers}
          editPolicies={addOnEditPolicies}
        />
        <SalesStagedCommitControls
          orderId={workspace.orderId}
          draft={salesPageView.draft}
          preview={salesPageView.preview}
          stagedChanges={salesPageView.stagedChanges}
          financialPreview={salesPageView.financialPreview}
        />
      </main>
      <FinancialSidebarDraft
        workspace={workspace}
        composition={salesPageView.composition}
        editPolicies={financialSidebarPolicies}
        className={styles.financialSidebar}
      />
    </div>
  );
}

function LockedCompositionView({
  composition,
  packageLines,
  orderId,
  editPolicies,
}: {
  composition: ReturnType<typeof toCurrentCompositionCard>;
  packageLines: POSWorkspace["packageLines"];
  orderId: string;
  editPolicies: ReturnType<typeof buildPOSPackageCompositionEditPolicies>;
}) {
  console.info(
    JSON.stringify({
      metric: "pos.locked.configure_session_panel_rendered",
      orderId,
      packageCount: packageLines.length,
    })
  );
  const rowActions = Object.fromEntries(
    packageLines.map((line) => [
      `package:${line.id}`,
      <ConfigureSessionPanel
        key={JSON.stringify({
          id: line.id,
          openWorkspaceIsActive:
            editPolicies.sessionConfigurationFinancialEdit.openWorkspaceIsActive,
          currentSelections: line.currentSelections,
        })}
        orderId={orderId}
        orderPackageId={line.id}
        packageName={line.currentPackage.name}
        sessionTypeName={line.sessionTypeName}
        mode={{
          kind: "locked",
          workspaceIsOpen:
            editPolicies.sessionConfigurationFinancialEdit.openWorkspaceIsActive,
        }}
        editPolicies={{
          operational: editPolicies.sessionConfigurationOperationalEdit,
          financial: editPolicies.sessionConfigurationFinancialEdit,
        }}
        availableConfigurations={line.availableConfigurations}
        currentSelections={line.currentSelections}
      />,
    ])
  );

  return (
    <CurrentCompositionCard
      view={composition}
      rowActions={rowActions}
    />
  );
}
