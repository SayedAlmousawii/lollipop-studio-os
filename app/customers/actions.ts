"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createCustomerSchema,
  updateCustomerSchema,
} from "@/modules/customers/customer.schema";
import {
  createCustomer as createCustomerRecord,
  updateCustomer as updateCustomerRecord,
  CustomerNotFoundError,
  CustomerPhoneConflictError,
} from "@/modules/customers/customer.service";

export type CustomerActionState = {
  errors?: Partial<Record<string, string[]>>;
  values?: {
    name: string;
    phone: string;
    notes: string;
    status?: string;
  };
};

export async function createCustomer(
  _prev: CustomerActionState,
  formData: FormData
): Promise<CustomerActionState> {
  const values = {
    name: formValue(formData.get("name")),
    phone: formValue(formData.get("phone")),
    notes: formValue(formData.get("notes")),
  };

  const parsed = createCustomerSchema.safeParse(values);
  if (!parsed.success) {
    return {
      values,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  let customer: { id: string };
  try {
    customer = await createCustomerRecord(parsed.data);
  } catch (error) {
    if (error instanceof CustomerPhoneConflictError) {
      return {
        values,
        errors: { phone: [error.message] },
      };
    }

    const message =
      error instanceof Error ? error.message : "Unable to create customer";
    return {
      values,
      errors: { _global: [message] },
    };
  }

  revalidatePath("/customers");
  redirect(`/customers/${customer.id}`);
}

export async function updateCustomer(
  customerId: string,
  _prev: CustomerActionState,
  formData: FormData
): Promise<CustomerActionState> {
  const values = {
    name: formValue(formData.get("name")),
    phone: formValue(formData.get("phone")),
    notes: formValue(formData.get("notes")),
    status: formValue(formData.get("status")),
  };
  const returnTo = customerReturnPath(formData.get("returnTo"), customerId);

  const parsed = updateCustomerSchema.safeParse(values);
  if (!parsed.success) {
    return {
      values,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await updateCustomerRecord(customerId, parsed.data);
  } catch (error) {
    if (error instanceof CustomerPhoneConflictError) {
      return {
        values,
        errors: { phone: [error.message] },
      };
    }
    if (error instanceof CustomerNotFoundError) {
      return {
        values,
        errors: { _global: [error.message] },
      };
    }

    const message =
      error instanceof Error ? error.message : "Unable to update customer";
    return {
      values,
      errors: { _global: [message] },
    };
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(returnTo);
}

function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function customerReturnPath(
  value: FormDataEntryValue | null,
  customerId: string
): string {
  if (typeof value !== "string") {
    return `/customers/${customerId}`;
  }

  if (value === "/customers" || value === `/customers/${customerId}`) {
    return value;
  }

  return `/customers/${customerId}`;
}
