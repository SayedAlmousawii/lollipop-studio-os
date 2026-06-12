import { notFound } from "next/navigation";
import { stageSalesChangeAction } from "@/app/(app)/orders/[orderId]/sales/actions";
import { requireCurrentAppUser } from "@/lib/auth";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import {
  POSPackageComposition,
  POSPhotoCountCard,
} from "@/components/orders/pos-package-composition";
import { SalesDraftOwnershipBanner } from "@/components/orders/sales-draft-ownership-banner";
import {
  toPOSAddOnMarketplace,
} from "@/modules/orders/composition";
import { getPOSWorkspace } from "@/modules/orders/order.service";
import {
  buildPOSAddOnEditPolicies,
  buildPOSPackageCompositionEditPolicies,
  orderEditModeContextFromWorkspace,
} from "@/modules/orders/policies/edit-mode-policy";
import {
  applyOrderCommitSalesSurfaceToAddOnPolicies,
  applyOrderCommitSalesSurfaceToPackagePolicies,
  applySalesDraftOwnershipToAddOnPolicies,
  applySalesDraftOwnershipToPackagePolicies,
  getSalesPageView,
} from "@/modules/order-commits/projections";
import {
  createOrderCommitSalesAddOnHandlers,
  createOrderCommitSalesCompositionHandlers,
} from "@/modules/order-commits/sales-staging-handler-adapter";
import styles from "./sales-page.module.css";
import { SalesRightColumn } from "./sales-right-column";
import { SalesWorkspaceHeader } from "./sales-workspace-header";

export default async function SalesPage(
  props: PageProps<"/orders/[orderId]/sales">
) {
  const { orderId } = await props.params;
  const [workspace, appUser] = await Promise.all([
    getPOSWorkspace(orderId),
    requireCurrentAppUser(),
  ]);
  if (!workspace) notFound();

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
  const salesPolicyContext = orderEditModeContextFromWorkspace({
    orderId: workspace.orderId,
    orderStatus: workspace.orderStatusRaw,
    finalInvoiceIsLocked: workspace.invoice?.isLocked ?? false,
    persistenceContext: "sales",
  });
  const packageEditPolicies =
    applySalesDraftOwnershipToPackagePolicies(
      applyOrderCommitSalesSurfaceToPackagePolicies(
        buildPOSPackageCompositionEditPolicies(salesPolicyContext)
      ),
      salesPageView.ownership
    );
  const addOnEditPolicies = applySalesDraftOwnershipToAddOnPolicies(
    applyOrderCommitSalesSurfaceToAddOnPolicies(
      buildPOSAddOnEditPolicies(salesPolicyContext)
    ),
    salesPageView.ownership
  );
  const compositionHandlers = createOrderCommitSalesCompositionHandlers({
    orderId,
    expectedVersion: salesPageView.draft?.version ?? 0,
    stageSalesChangeAction,
  });
  const addOnHandlers = createOrderCommitSalesAddOnHandlers({
    orderId,
    expectedVersion: salesPageView.draft?.version ?? 0,
    stageSalesChangeAction,
  });

  return (
    <div className={styles.salesGrid}>
      <div className={styles.leftColumn}>
        <SalesWorkspaceHeader workspace={workspace} />
        <main className={styles.compositionPanel}>
          <SalesDraftOwnershipBanner
            orderId={workspace.orderId}
            ownership={salesPageView.ownership}
          />
          <POSPackageComposition
            workspace={workspace}
            composition={salesPageView.composition}
            handlers={compositionHandlers}
            editPolicies={packageEditPolicies}
            configurePanelMode="commit-staging"
            expectedVersion={salesPageView.draft?.version ?? 0}
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
        </main>
      </div>
      <SalesRightColumn
        workspace={workspace}
        composition={salesPageView.composition}
        financialPreview={salesPageView.financialPreview}
        draft={salesPageView.draft}
        preview={salesPageView.preview}
        stagedChanges={salesPageView.stagedChanges}
        ownership={salesPageView.ownership}
      />
    </div>
  );
}
