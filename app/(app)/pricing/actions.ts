"use server";

import { revalidatePath } from "next/cache";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";
import {
  ExtraPhotoPricingDataError,
  ExtraPhotoPricingNotFoundError,
  updateExtraPhotoPricing as updateExtraPhotoPricingRecord,
} from "@/modules/pricing/extra-photo-pricing.service";
import { updateExtraPhotoPricingSchema } from "@/modules/pricing/extra-photo-pricing.schema";

export type ExtraPhotoPricingActionState = {
  errors?: Partial<Record<string, string[]>>;
  values?: ExtraPhotoPricingFormValues;
  success?: string;
};

export type ExtraPhotoPricingFormValues = {
  digitalUnitPrice: string;
  printUnitPrice: string;
};

const EXTRA_PHOTO_PRICING_ACTION_GENERIC_ERROR =
  "An unexpected error occurred while updating extra-photo prices.";

export async function updateExtraPhotoPricingAction(
  sessionTypeId: string,
  _prev: ExtraPhotoPricingActionState,
  formData: FormData
): Promise<ExtraPhotoPricingActionState> {
  const actor = await requireCurrentAppUserPermission(
    PERMISSIONS.PACKAGE_CATALOG_MANAGE
  );
  const values = extraPhotoPricingFormValues(formData);
  const parsed = updateExtraPhotoPricingSchema.safeParse(values);

  if (!parsed.success) {
    return {
      values,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await updateExtraPhotoPricingRecord(sessionTypeId, parsed.data, actor);
  } catch (error) {
    logExtraPhotoPricingActionError("updateExtraPhotoPricing", error);
    return {
      values,
      errors: {
        _global: [
          error instanceof ExtraPhotoPricingNotFoundError
            ? "Extra-photo pricing rows are missing for this session type."
            : error instanceof ExtraPhotoPricingDataError
              ? "Extra-photo pricing data is inconsistent for this session type."
            : EXTRA_PHOTO_PRICING_ACTION_GENERIC_ERROR,
        ],
      },
    };
  }

  revalidatePath("/pricing");
  return { success: "Extra-photo prices updated.", values };
}

function extraPhotoPricingFormValues(
  formData: FormData
): ExtraPhotoPricingFormValues {
  return {
    digitalUnitPrice: formValue(formData.get("digitalUnitPrice")),
    printUnitPrice: formValue(formData.get("printUnitPrice")),
  };
}

function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function logExtraPhotoPricingActionError(action: string, error: unknown): void {
  console.error(`[pricing] ${action} failed`, error);
}
