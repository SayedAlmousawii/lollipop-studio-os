import { notFound } from "next/navigation";
import { stageSalesChangeAction } from "@/app/orders/[orderId]/sales/actions";
import { requireCurrentAppUser } from "@/lib/auth";
import { OrderCommitFinancialSidebar } from "@/components/orders/order-commit-financial-sidebar";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import {
  POSPackageComposition,
  POSPhotoCountCard,
} from "@/components/orders/pos-package-composition";
import { SalesDraftOwnershipBanner } from "@/components/orders/sales-draft-ownership-banner";
import { SalesStagedCommitControls } from "@/components/orders/sales-staged-commit-controls";
import {
  toPOSAddOnMarketplace,
} from "@/modules/orders/composition";
import { getPOSWorkspace } from "@/modules/orders/order.service";
import {
  buildPOSAddOnEditPolicies,
  buildPOSFinancialSidebarEditPolicies,
  buildPOSPackageCompositionEditPolicies,
  orderEditModeContextFromWorkspace,
} from "@/modules/orders/policies/edit-mode-policy";
import {
  applyOrderCommitSalesSurfaceToAddOnPolicies,
  applyOrderCommitSalesSurfaceToFinancialPolicies,
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
  const financialSidebarPolicies =
    applyOrderCommitSalesSurfaceToFinancialPolicies(
      buildPOSFinancialSidebarEditPolicies(salesPolicyContext)
    );
  const compositionHandlers = createOrderCommitSalesCompositionHandlers({
    orderId,
    expectedVersion: salesPageView.draft?.version ?? 0,
    stageSalesChangeAction,
  });
  const addOnHandlers = createOrderCommitSalesAddOnHandlers();

  return (
    <div className={styles.salesGrid}>
      <main className="space-y-5">
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
        <SalesStagedCommitControls
          orderId={workspace.orderId}
          draft={salesPageView.draft}
          preview={salesPageView.preview}
          stagedChanges={salesPageView.stagedChanges}
          financialPreview={salesPageView.financialPreview}
          ownership={salesPageView.ownership}
        />
      </main>
      <OrderCommitFinancialSidebar
        workspace={workspace}
        financialPreview={salesPageView.financialPreview}
        financialCase={salesPageView.financialCase}
        preview={salesPageView.preview}
        editPolicies={financialSidebarPolicies}
        className={styles.financialSidebar}
      />
    </div>
  );
}
