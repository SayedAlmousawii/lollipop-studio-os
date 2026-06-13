import { notFound } from "next/navigation";
import {
  stageSalesChangeAction,
  updateOrderAlbumFinishingAction,
} from "@/app/(app)/orders/[orderId]/sales/actions";
import { requireCurrentAppUser } from "@/lib/auth";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import { POSPackageComposition } from "@/components/orders/pos-package-composition";
import type { SalesAlbumView } from "@/components/orders/sales-album-config";
import {
  getOrderAlbums,
  ORDER_ALBUM_SOURCE_TYPE,
  type OrderAlbumRow,
} from "@/modules/albums";
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
  const [workspace, appUser, orderAlbums] = await Promise.all([
    getPOSWorkspace(orderId),
    requireCurrentAppUser(),
    getOrderAlbums({ orderId }),
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
  const albumRead = buildSalesAlbumRead({
    albums: orderAlbums,
    packageLines: salesPageView.composition.packageLines,
    currentAddOns: addOnMarketplace.currentAddOns,
  });
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
            albumsByPackageId={albumRead.albumsByPackageId}
            updateAlbumFinishingAction={updateOrderAlbumFinishingAction}
          />
          <POSAddOnMarketplace
            workspace={workspace}
            marketplace={addOnMarketplace}
            handlers={addOnHandlers}
            editPolicies={addOnEditPolicies}
            standaloneAlbums={albumRead.standaloneAlbums}
            updateAlbumFinishingAction={updateOrderAlbumFinishingAction}
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

function buildSalesAlbumRead({
  albums,
  packageLines,
  currentAddOns,
}: {
  albums: OrderAlbumRow[];
  packageLines: Array<{
    orderPackageId: string;
    packageItems: Array<{ id: string; productName: string; category: string | null }>;
  }>;
  currentAddOns: Array<{
    orderAddOnId: string | null;
    name: string;
  }>;
}): {
  albumsByPackageId: Record<string, SalesAlbumView[]>;
  standaloneAlbums: SalesAlbumView[];
} {
  const packageLineById = new Map(
    packageLines.map((line) => [line.orderPackageId, line])
  );
  const addOnNameById = new Map(
    currentAddOns.flatMap((addOn) =>
      addOn.orderAddOnId ? [[addOn.orderAddOnId, addOn.name] as const] : []
    )
  );
  const albumsByPackageId: Record<string, SalesAlbumView[]> = {};
  const standaloneAlbums: SalesAlbumView[] = [];

  for (const album of albums) {
    const productLabel = resolveAlbumProductLabel({
      album,
      packageLine: album.orderPackageId
        ? packageLineById.get(album.orderPackageId) ?? null
        : null,
      addOnNameById,
    });
    const view = toSalesAlbumView(album, productLabel);

    if (
      album.sourceType === ORDER_ALBUM_SOURCE_TYPE.PACKAGE &&
      album.orderPackageId
    ) {
      albumsByPackageId[album.orderPackageId] = [
        ...(albumsByPackageId[album.orderPackageId] ?? []),
        view,
      ];
      continue;
    }

    if (album.sourceType === ORDER_ALBUM_SOURCE_TYPE.ADDON) {
      standaloneAlbums.push(view);
    }
  }

  return { albumsByPackageId, standaloneAlbums };
}

function resolveAlbumProductLabel({
  album,
  packageLine,
  addOnNameById,
}: {
  album: OrderAlbumRow;
  packageLine: {
    packageItems: Array<{ id: string; productName: string; category: string | null }>;
  } | null;
  addOnNameById: Map<string, string>;
}): string {
  if (album.sourceType === ORDER_ALBUM_SOURCE_TYPE.ADDON) {
    return addOnNameById.get(album.backingLineId) ?? "Album product";
  }

  const exactItem = packageLine?.packageItems.find(
    (item) => item.id === album.backingLineId
  );
  if (exactItem) return exactItem.productName;

  const albumItem = packageLine?.packageItems.find(
    (item) => item.category?.toUpperCase() === "ALBUM"
  );
  return albumItem?.productName ?? "Album product";
}

function toSalesAlbumView(
  album: OrderAlbumRow,
  productLabel: string
): SalesAlbumView {
  return {
    id: album.id,
    orderPackageId: album.orderPackageId,
    backingLineId: album.backingLineId,
    productLabel,
    pageCount: album.extraPages,
    coverMaterial: album.coverMaterial,
    threadColor: album.threadColor,
    layout: album.layout,
    coverText: album.coverText,
    coverImageRef: album.coverImageRef,
    instructions: album.instructions,
  };
}
