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
import {
  getEffectiveCompositionForInvoice,
  getOpenWorkspaceForInvoice,
} from "@/modules/adjustment-workspace/adjustment-workspace.service";
import { buildCompositionView } from "@/modules/composition-view/composition-view.model";
import {
  deriveLockedFinancialSidebarSummary,
  getLinkedFinancialDocumentsForOrder,
  getPOSWorkspace,
} from "@/modules/orders/order.service";
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
    const [effectiveComposition, openWorkspace, linkedDocuments] = await Promise.all([
      getEffectiveCompositionForInvoice(workspace.invoice.invoiceId),
      getOpenWorkspaceForInvoice(workspace.invoice.invoiceId),
      getLinkedFinancialDocumentsForOrder(workspace.orderId),
    ]);
    const finalizedAdjustments = linkedDocuments
      .filter(
        (document) =>
          document.invoiceType === "ADJUSTMENT" &&
          document.invoiceStatus !== "DRAFT"
      )
      .map((document) => ({
        totalAmount: document.invoiceTotal,
        remainingAmount: document.remainingAmount,
      }));
    const financialSummary = deriveLockedFinancialSidebarSummary({
      finalInvoice: {
        totalAmount: workspace.invoice.invoiceTotal,
        remainingAmount: workspace.invoice.remainingAmount,
        depositPaidAmount: workspace.invoice.depositPaidAmount,
      },
      finalizedAdjustments,
      orderId: workspace.orderId,
    });
    console.info(
      JSON.stringify({
        metric: "sales_page.locked.rendered",
        orderId: workspace.orderId,
        invoiceId: workspace.invoice.invoiceId,
      })
    );

    return (
      <div className={styles.salesGrid}>
        <main className="space-y-5">
          <LockedCompositionView
            effectiveComposition={effectiveComposition}
            packageLines={workspace.packageLines}
            orderId={workspace.orderId}
            workspaceIsOpen={Boolean(openWorkspace)}
          />
        </main>
        <FinancialSidebarLocked
          workspace={workspace}
          linkedDocuments={linkedDocuments}
          financialSummary={financialSummary}
          openWorkspace={openWorkspace}
          currentUserId={appUser.id}
          isManager={appUser.role === "ADMIN" || appUser.role === "MANAGER"}
          className={styles.financialSidebar}
        />
      </div>
    );
  }

  const compositionHandlers = createPOSCompositionHandlers(orderId, workspace);
  const addOnHandlers = createPOSAddOnHandlers(orderId);

  return (
    <div className={styles.salesGrid}>
      <main className="space-y-5">
        <POSPackageComposition
          workspace={workspace}
          handlers={compositionHandlers}
        />
        <POSPhotoCountCard
          workspace={workspace}
          handlers={compositionHandlers}
        />
        <POSAddOnMarketplace
          workspace={workspace}
          handlers={addOnHandlers}
        />
      </main>
      <FinancialSidebarDraft
        workspace={workspace}
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
  effectiveComposition,
  packageLines,
  orderId,
  workspaceIsOpen,
}: {
  effectiveComposition: Awaited<ReturnType<typeof getEffectiveCompositionForInvoice>>;
  packageLines: POSWorkspace["packageLines"];
  orderId: string;
  workspaceIsOpen: boolean;
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
        key={line.id}
        orderId={orderId}
        orderPackageId={line.id}
        packageName={line.currentPackage.name}
        sessionTypeName={line.sessionTypeName}
        mode={{ kind: "locked", workspaceIsOpen }}
        availableConfigurations={line.availableConfigurations}
        currentSelections={line.currentSelections}
      />,
    ])
  );

  return (
    <CurrentCompositionCard
      view={buildCompositionView({
        lines: effectiveComposition.lines,
        totals: effectiveComposition.totals,
        mode: "locked",
      })}
      rowActions={rowActions}
    />
  );
}
