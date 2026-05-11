"use server";

import { revalidatePath } from "next/cache";
import { ProductCategory } from "@prisma/client";
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
  isActive?: string;
};

export type ProductArchiveActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

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
    const message =
      error instanceof Error ? error.message : "Unable to create product";
    return { values, errors: { _global: [message] } };
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
    const message =
      error instanceof ProductNotFoundError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unable to update product";
    return { values, errors: { _global: [message] } };
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
    const message =
      error instanceof ProductArchiveBlockedError ||
      error instanceof ProductNotFoundError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unable to archive product";
    return { errors: { _global: [message] } };
  }

  revalidatePath("/products");
  return { success: "Product archived." };
}

function productFormValues(formData: FormData): ProductFormValues {
  return {
    name: formValue(formData.get("name")),
    category: formValue(formData.get("category")) || ProductCategory.OTHER,
    canonicalPrice: formValue(formData.get("canonicalPrice")),
    description: formValue(formData.get("description")),
  };
}

function emptyProductValues(): ProductFormValues {
  return {
    name: "",
    category: ProductCategory.ALBUM,
    canonicalPrice: "",
    description: "",
  };
}

function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
