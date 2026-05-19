import { notFound } from "next/navigation";
import {
  addOrderProductAddOnAction,
  removeOrderAddOnAction,
  updateOrderPackageAction,
  updateOrderSelectedPhotoCountAction,
  upgradeOrderPackageItemAction,
  type POSCompositionActionState,
} from "@/app/orders/[orderId]/sales/actions";
import { requireCurrentAppUser } from "@/lib/auth";
import { CurrentCompositionCard } from "@/components/orders/current-composition-card";
import { FinancialSidebarDraft } from "@/components/orders/financial-sidebar-draft";
import { FinancialSidebarLocked } from "@/components/orders/financial-sidebar-locked";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import {
  POSPackageComposition,
  POSPhotoCountCard,
} from "@/components/orders/pos-package-composition";
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
  getDraftOrderCompositionViewModel,
  getLockedOrderCompositionViewModel,
  toCurrentCompositionCard,
  toDraftPOSComposition,
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
import type {
  HandlerResult,
  POSAddOnHandlers,
  POSCompositionHandlers,
} from "@/modules/orders/pos-handlers.types";
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

  const compositionModel = await getDraftOrderCompositionViewModel(orderId);
  if (!compositionModel) notFound();
  const draftComposition = toDraftPOSComposition(compositionModel);
  const addOnMarketplace = toPOSAddOnMarketplace(draftComposition);
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
  const compositionHandlers = createPOSCompositionHandlers(orderId, workspace);
  const addOnHandlers = createPOSAddOnHandlers(orderId);

  return (
    <div className={styles.salesGrid}>
      <main className="space-y-5">
        <POSPackageComposition
          workspace={workspace}
          composition={draftComposition}
          handlers={compositionHandlers}
          editPolicies={packageEditPolicies}
        />
        <POSPhotoCountCard
          workspace={workspace}
          composition={draftComposition}
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
      <FinancialSidebarDraft
        workspace={workspace}
        composition={draftComposition}
        editPolicies={financialSidebarPolicies}
        className={styles.financialSidebar}
      />
    </div>
  );
}

function createPOSCompositionHandlers(
  orderId: string,
  workspace: POSWorkspace
): POSCompositionHandlers {
  async function changePackageTier(input: {
    orderPackageId: string;
    toPackageRefId: string;
  }): Promise<HandlerResult> {
    "use server";

    return callPOSServerAction(updateOrderPackageAction, orderId, {
      orderPackageId: input.orderPackageId,
      packageId: input.toPackageRefId,
    });
  }

  async function upgradePackageItem(input: {
    orderPackageId: string;
    packageItemId: string;
    toProductId: string;
    quantity: number;
  }): Promise<HandlerResult> {
    "use server";

    const currentQuantity = workspace.packageLines
      .flatMap((line) => line.packageItems)
      .find((item) => item.id === input.packageItemId)?.quantity;
    if (currentQuantity !== input.quantity) {
      return {
        ok: false,
        errors: {
          _global: ["Package item quantity changed. Refresh before applying this upgrade."],
        },
      };
    }
    // Sales package-item actions replace the existing item quantity; they do not accept a quantity override.
    return callPOSServerAction(upgradeOrderPackageItemAction, orderId, {
      orderPackageId: input.orderPackageId,
      packageItemId: input.packageItemId,
      newProductId: input.toProductId,
    });
  }

  async function changeSelectedPhotoCount(input: {
    orderPackageId: string;
    selectedPhotoCount: number;
    extraDigitalCount: number;
    extraPrintCount: number;
  }): Promise<HandlerResult> {
    "use server";

    return callPOSServerAction(updateOrderSelectedPhotoCountAction, orderId, {
      orderPackageId: input.orderPackageId,
      selectedPhotoCount: input.selectedPhotoCount,
      extraDigitalCount: input.extraDigitalCount,
      extraPrintCount: input.extraPrintCount,
    });
  }

  return {
    changePackageTier,
    upgradePackageItem,
    changeSelectedPhotoCount,
    shouldPromptInlineApproval: true,
  };
}

function createPOSAddOnHandlers(orderId: string): POSAddOnHandlers {
  async function addAddOn(input: {
    productId: string;
    quantity: number;
  }): Promise<HandlerResult> {
    "use server";

    // Sales add-on actions add one row per submit; they do not accept a quantity override.
    return callPOSServerAction(addOrderProductAddOnAction, orderId, {
      productId: input.productId,
    });
  }

  async function removeAddOn(input: {
    addOnId: string;
  }): Promise<HandlerResult> {
    "use server";

    return callPOSServerAction(removeOrderAddOnAction, orderId, {
      addOnId: input.addOnId,
    });
  }

  return {
    addAddOn,
    removeAddOn,
    shouldPromptInlineApproval: true,
  };
}

type POSServerAction = (
  orderId: string,
  previousState: POSCompositionActionState,
  formData: FormData
) => Promise<POSCompositionActionState>;

async function callPOSServerAction(
  action: POSServerAction,
  orderId: string,
  fields: Record<string, string | number>
): Promise<HandlerResult> {
  const formData = new FormData();
  for (const [field, value] of Object.entries(fields)) {
    formData.set(field, String(value));
  }

  // POS composition actions ignore previousState; adapters always submit a fresh state.
  return handlerResultFromActionState(await action(orderId, {}, formData));
}

function handlerResultFromActionState(
  state: POSCompositionActionState
): HandlerResult {
  if (state.kind === "success") {
    return { ok: true };
  }

  return {
    ok: false,
    errors: normalizeActionErrors(state.errors),
    approval: state.kind === "approval-required" ? state.payload : undefined,
  };
}

function normalizeActionErrors(
  errors: POSCompositionActionState["errors"]
): Record<string, string[]> {
  if (!errors) {
    return {};
  }

  const normalized: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(errors)) {
    if (messages?.length) {
      normalized[field] = messages;
    }
  }
  return normalized;
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
