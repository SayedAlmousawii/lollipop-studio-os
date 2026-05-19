import { formatMoney } from "@/lib/formatting/money";
import type { POSMutationActionState } from "@/modules/orders/pos-handlers.types";
import type { POSCompositionPackageLineProjection } from "./to-draft-pos-composition";

export const PHOTO_BILLING_MODE_OPTIONS = [
  { value: "DIGITAL", label: "Digital" },
  { value: "PRINT", label: "Print" },
  { value: "SPLIT", label: "Split" },
] as const;

export type PhotoBillingMode = (typeof PHOTO_BILLING_MODE_OPTIONS)[number]["value"];

export interface PhotoLineDraft {
  selectedPhotoCount: string;
  billingMode: PhotoBillingMode;
  splitDigitalCount: string;
  splitPrintCount: string;
}

export type PhotoPayload = {
  selectedPhotoCount: number;
  extraDigitalCount: number;
  extraPrintCount: number;
};

export function createProjectedPhotoDraft(
  line: POSCompositionPackageLineProjection
): PhotoLineDraft {
  return {
    selectedPhotoCount: String(line.selectedPhotoCount),
    billingMode: getProjectedBillingMode(line),
    splitDigitalCount: String(line.extraDigitalCount),
    splitPrintCount: String(line.extraPrintCount),
  };
}

export function readProjectedPhotoPreview(
  draft: PhotoLineDraft,
  line: POSCompositionPackageLineProjection
) {
  const selectedPhotoCount = parseDraftCount(draft.selectedPhotoCount) ?? 0;
  const extraCount = Math.max(selectedPhotoCount - line.includedPhotoCount, 0);
  const resolved = readProjectedPhotoPayload(draft, line.includedPhotoCount);
  const extraDigitalCount = resolved.payload?.extraDigitalCount ?? 0;
  const extraPrintCount = resolved.payload?.extraPrintCount ?? 0;
  const extraPhotoTotal =
    extraDigitalCount * line.extraDigitalUnitPrice +
    extraPrintCount * line.extraPrintUnitPrice;
  const activeModeLabel =
    extraCount === 0
      ? "No extras"
      : draft.billingMode === "DIGITAL"
        ? "Digital"
        : draft.billingMode === "PRINT"
          ? "Print"
          : "Split";
  const allocationStatus =
    draft.billingMode !== "SPLIT" || extraCount === 0
      ? ""
      : `Split keeps ${extraCount} extras allocated across digital and print.`;

  return {
    extraCount,
    allocationStatus,
    compactSummary:
      extraCount === 0
        ? "No extra-photo charges"
        : `${extraCount} ${extraCount === 1 ? "extra" : "extras"} · ${activeModeLabel} · ${formatMoney(extraPhotoTotal)}`,
    detailSummary:
      extraCount === 0
        ? "No digital or print extras are saved for this line."
        : `Digital ${extraDigitalCount} x ${formatMoney(line.extraDigitalUnitPrice)} · Print ${extraPrintCount} x ${formatMoney(line.extraPrintUnitPrice)} · Total ${formatMoney(extraPhotoTotal)}`,
  };
}

export function readProjectedPhotoPayload(
  draft: PhotoLineDraft,
  includedPhotoCount: number
): {
  payload?: PhotoPayload;
  errors?: POSMutationActionState["errors"];
} {
  const selectedPhotoCount = parseDraftCount(draft.selectedPhotoCount);
  if (selectedPhotoCount === null) {
    return {
      errors: { selectedPhotoCount: ["Selected photos are required"] },
    };
  }
  if (selectedPhotoCount < includedPhotoCount) {
    return {
      errors: {
        selectedPhotoCount: [
          `Selected photos cannot be below the ${includedPhotoCount} included photos`,
        ],
      },
    };
  }

  const extraCount = Math.max(selectedPhotoCount - includedPhotoCount, 0);
  if (extraCount === 0) {
    return {
      payload: {
        selectedPhotoCount,
        extraDigitalCount: 0,
        extraPrintCount: 0,
      },
    };
  }

  if (draft.billingMode === "DIGITAL") {
    return {
      payload: {
        selectedPhotoCount,
        extraDigitalCount: extraCount,
        extraPrintCount: 0,
      },
    };
  }

  if (draft.billingMode === "PRINT") {
    return {
      payload: {
        selectedPhotoCount,
        extraDigitalCount: 0,
        extraPrintCount: extraCount,
      },
    };
  }

  const extraDigitalCount = parseDraftCount(draft.splitDigitalCount);
  const extraPrintCount = parseDraftCount(draft.splitPrintCount);
  if (extraDigitalCount === null || extraPrintCount === null) {
    return {
      errors: {
        extraDigitalCount: ["Split allocations are required for both media types"],
      },
    };
  }
  if (extraDigitalCount + extraPrintCount !== extraCount) {
    return {
      errors: {
        extraDigitalCount: [
          `Split allocations must total ${extraCount} derived extra photos`,
        ],
      },
    };
  }

  return {
    payload: {
      selectedPhotoCount,
      extraDigitalCount,
      extraPrintCount,
    },
  };
}

function getProjectedBillingMode(
  line: POSCompositionPackageLineProjection
): PhotoBillingMode {
  if (line.extraDigitalCount > 0 && line.extraPrintCount > 0) {
    return "SPLIT";
  }
  if (line.extraPrintCount > 0) {
    return "PRINT";
  }
  return "DIGITAL";
}

function parseDraftCount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}
