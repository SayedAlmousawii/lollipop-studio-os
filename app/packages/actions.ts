"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";
import {
  archivePackage,
  createPackage as createPackageRecord,
  PackageArchiveBlockedError,
  PackageLockedInvoiceError,
  PackageNotFoundError,
  PackageProductNotFoundError,
  updatePackage as updatePackageRecord,
} from "@/modules/packages/package.service";
import {
  createPackageSchema,
  updatePackageSchema,
} from "@/modules/packages/package.schema";

export type PackageActionState = {
  errors?: Partial<Record<string, string[]>>;
  values?: PackageFormValues;
  success?: string;
};

export type PackageFormValues = {
  name: string;
  price: string;
  photoCount: string;
  description: string;
  isActive?: string;
  items: PackageItemFormValues[];
};

export type PackageItemFormValues = {
  productId: string;
  quantity: string;
  priceSnapshot: string;
  sortOrder: string;
};

export type PackageArchiveActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

const PACKAGE_ACTION_GENERIC_ERROR =
  "An unexpected error occurred while processing the package.";

export async function createPackage(
  _prev: PackageActionState,
  formData: FormData
): Promise<PackageActionState> {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
  const values = packageFormValues(formData);
  const parsed = createPackageSchema.safeParse(values);

  if (!parsed.success) {
    return {
      values,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await createPackageRecord(parsed.data);
  } catch (error) {
    logPackageActionError("createPackage", error);
    return {
      values,
      errors: { _global: [messageForPackageError(error)] },
    };
  }

  revalidatePath("/packages");
  redirect("/packages");
}

export async function updatePackage(
  packageId: string,
  _prev: PackageActionState,
  formData: FormData
): Promise<PackageActionState> {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
  const values = {
    ...packageFormValues(formData),
    isActive: formData.get("isActive") === "on" ? "on" : "",
  };
  const parsed = updatePackageSchema.safeParse(values);

  if (!parsed.success) {
    return {
      values,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await updatePackageRecord(packageId, parsed.data);
  } catch (error) {
    logPackageActionError("updatePackage", error);
    return {
      values,
      errors: { _global: [messageForPackageError(error)] },
    };
  }

  revalidatePath("/packages");
  redirect("/packages");
}

export async function archivePackageAction(
  packageId: string,
  _prev: PackageArchiveActionState,
  _formData: FormData
): Promise<PackageArchiveActionState> {
  void _prev;
  void _formData;

  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);

  try {
    await archivePackage(packageId);
  } catch (error) {
    logPackageActionError("archivePackage", error);
    return {
      errors: { _global: [messageForPackageError(error)] },
    };
  }

  revalidatePath("/packages");
  return { success: "Package archived." };
}

function packageFormValues(formData: FormData): PackageFormValues {
  return {
    name: formValue(formData.get("name")),
    price: formValue(formData.get("price")),
    photoCount: formValue(formData.get("photoCount")),
    description: formValue(formData.get("description")),
    items: packageItemFormValues(formData),
  };
}

function packageItemFormValues(formData: FormData): PackageItemFormValues[] {
  const productIds = formData.getAll("itemProductId").map(formValue);
  const quantities = formData.getAll("itemQuantity").map(formValue);
  const priceSnapshots = formData.getAll("itemPriceSnapshot").map(formValue);

  return productIds
    .map((productId, index) => ({
      productId,
      quantity: quantities[index] ?? "",
      priceSnapshot: priceSnapshots[index] ?? "",
      sortOrder: String(index),
    }))
    .filter(
      (item) =>
        item.productId !== "" || item.quantity !== "" || item.priceSnapshot !== ""
    );
}
function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function messageForPackageError(error: unknown): string {
  if (error instanceof PackageNotFoundError) {
    return "Package not found.";
  }
  if (error instanceof PackageArchiveBlockedError) {
    return "This package has active bookings or orders and cannot be archived yet.";
  }
  if (error instanceof PackageLockedInvoiceError) {
    return "Package commercial fields cannot change because locked invoices reference this package.";
  }
  if (error instanceof PackageProductNotFoundError) {
    return "One or more selected products are unavailable for package deliverables.";
  }
  return PACKAGE_ACTION_GENERIC_ERROR;
}

function logPackageActionError(action: string, error: unknown): void {
  console.error(`[packages] ${action} failed`, error);
}
