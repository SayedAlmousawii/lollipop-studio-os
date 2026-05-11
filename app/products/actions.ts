"use server";

import { revalidatePath } from "next/cache";
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";
import {
  archiveProduct,
  createProduct as createProductRecord,
  ProductArchiveBlockedError,
  ProductNotFoundError,
  updateProduct as updateProductRecord,
} from "@/modules/products/product.service";
import { DEFAULT_PRODUCT_CATEGORY } from "@/modules/products/product.constants";
import {
  createProductSchema,
  updateProductSchema,
} from "@/modules/products/product.schema";

export type ProductActionState = {
  errors?: Partial<Record<string, string[]>>;
  values?: ProductFormValues;
  success?: string;
};

type ProductFormValues = {
  name: string;
  category: string;
  canonicalPrice: string;
  description: string;
  isPackageDeliverable: string;
  isAddOn: string;
  isActive?: string;
};

export type ProductArchiveActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

const PRODUCT_ACTION_GENERIC_ERROR =
  "An unexpected error occurred while processing the product.";

export async function createProduct(
  _prev: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
  const values = productFormValues(formData);
  const parsed = createProductSchema.safeParse(values);

  if (!parsed.success) {
    return {
      values,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await createProductRecord(parsed.data);
  } catch (error) {
    logProductActionError("createProduct", error);
    return {
      values,
      errors: { _global: [PRODUCT_ACTION_GENERIC_ERROR] },
    };
  }

  revalidatePath("/products");
  return {
    success: "Product created.",
    values: emptyProductValues(),
  };
}

export async function updateProduct(
  productId: string,
  _prev: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
  const values = {
    ...productFormValues(formData),
    isActive: formData.get("isActive") === "on" ? "on" : "",
  };
  const parsed = updateProductSchema.safeParse(values);

  if (!parsed.success) {
    return {
      values,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await updateProductRecord(productId, parsed.data);
  } catch (error) {
    logProductActionError("updateProduct", error);
    return {
      values,
      errors: {
        _global: [
          error instanceof ProductNotFoundError
            ? "Product not found."
            : PRODUCT_ACTION_GENERIC_ERROR,
        ],
      },
    };
  }

  revalidatePath("/products");
  return { success: "Product updated.", values };
}

export async function archiveProductAction(
  productId: string,
  _prev: ProductArchiveActionState,
  _formData: FormData
): Promise<ProductArchiveActionState> {
  void _prev;
  void _formData;

  await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);

  try {
    await archiveProduct(productId);
  } catch (error) {
    logProductActionError("archiveProduct", error);
    return {
      errors: {
        _global: [
          error instanceof ProductArchiveBlockedError
            ? "This product is used by active packages and cannot be archived yet."
            : error instanceof ProductNotFoundError
              ? "Product not found."
              : PRODUCT_ACTION_GENERIC_ERROR,
        ],
      },
    };
  }

  revalidatePath("/products");
  return { success: "Product archived." };
}

function productFormValues(formData: FormData): ProductFormValues {
  return {
    name: formValue(formData.get("name")),
    category: formValue(formData.get("category")) || DEFAULT_PRODUCT_CATEGORY,
    canonicalPrice: formValue(formData.get("canonicalPrice")),
    description: formValue(formData.get("description")),
    isPackageDeliverable:
      formData.get("isPackageDeliverable") === "on" ? "on" : "",
    isAddOn: formData.get("isAddOn") === "on" ? "on" : "",
  };
}

function emptyProductValues(): ProductFormValues {
  return {
    name: "",
    category: DEFAULT_PRODUCT_CATEGORY,
    canonicalPrice: "",
    description: "",
    isPackageDeliverable: "on",
    isAddOn: "",
  };
}

function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function logProductActionError(action: string, error: unknown): void {
  console.error(`[products] ${action} failed`, error);
}
