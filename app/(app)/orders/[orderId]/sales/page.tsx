import { notFound } from "next/navigation";
import {
  addStandaloneAlbumAction,
  stageSalesChangeAction,
  stageAlbumExtraPagesAction,
  stageAlbumSizeSwapAction,
  updateOrderAlbumFinishingAction,
} from "@/app/(app)/orders/[orderId]/sales/actions";
import { requireCurrentAppUser } from "@/lib/auth";
import { POSAddOnMarketplace } from "@/components/orders/pos-add-on-marketplace";
import { POSPackageComposition } from "@/components/orders/pos-package-composition";
import type {
  SalesAlbumProductOption,
  SalesAlbumView,
} from "@/components/orders/sales-album-config";
import {
  EXTRA_ALBUM_PAGE_PRODUCT_ID,
  getSalesOrderAlbums,
  ORDER_ALBUM_SOURCE_TYPE,
  type SalesOrderAlbumRow,
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
    getSalesOrderAlbums({ orderId }),
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
            stageAlbumExtraPagesAction={stageAlbumExtraPagesAction}
            stageAlbumSizeSwapAction={stageAlbumSizeSwapAction}
            albumProductOptions={toAlbumProductOptions(workspace.productOptions)}
            albumExtraPagesPolicy={addOnEditPolicies.addAddOn}
          />
          <POSAddOnMarketplace
            workspace={workspace}
            marketplace={addOnMarketplace}
            handlers={addOnHandlers}
            editPolicies={addOnEditPolicies}
            expectedVersion={salesPageView.draft?.version ?? 0}
            standaloneAlbums={albumRead.standaloneAlbums}
            updateAlbumFinishingAction={updateOrderAlbumFinishingAction}
            stageAlbumExtraPagesAction={stageAlbumExtraPagesAction}
            stageAlbumSizeSwapAction={stageAlbumSizeSwapAction}
            addStandaloneAlbumAction={addStandaloneAlbumAction}
            albumProductOptions={toAlbumProductOptions(workspace.addOnCatalog)}
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
  albums: SalesOrderAlbumRow[];
  packageLines: Array<{
    orderPackageId: string;
    packageItems: Array<{
      id: string;
      productId: string | null;
      productName: string;
      category: string | null;
      quantity: number;
    }>;
  }>;
  currentAddOns: Array<{
    orderAddOnId: string | null;
    name: string;
    productId: string | null;
    currentQuantity: number;
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
  album: SalesOrderAlbumRow;
  packageLine: {
    packageItems: Array<{ id: string; productName: string; category: string | null }>;
  } | null;
  addOnNameById: Map<string, string>;
}): string {
  if (album.productLabel) return album.productLabel;

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
  album: SalesOrderAlbumRow,
  productLabel: string
): SalesAlbumView {
  return {
    id: album.id,
    orderPackageId: album.orderPackageId,
    sourceType: album.sourceType,
    backingLineKind: album.backingLineKind,
    backingLineId: album.backingLineId,
    packageItemId: album.packageItemId,
    currentProductId: album.productId,
    productLabel,
    extraPages: album.extraPages,
    quantity: 1,
    coverMaterial: album.coverMaterial,
    threadColor: album.threadColor,
    layout: album.layout,
    coverText: album.coverText,
    coverImageRef: album.coverImageRef,
    instructions: album.instructions,
  };
}

function toAlbumProductOptions(
  options: Array<{
    id: string;
    name: string;
    category: string;
    canonicalPriceLabel?: string;
    priceLabel?: string;
  }>
): SalesAlbumProductOption[] {
  return options
    .filter(
      (option) =>
        option.category === "ALBUM" && option.id !== EXTRA_ALBUM_PAGE_PRODUCT_ID
    )
    .map((option) => ({
      id: option.id,
      name: option.name,
      priceLabel: option.canonicalPriceLabel ?? option.priceLabel ?? "",
    }));
}
