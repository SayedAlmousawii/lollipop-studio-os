"use server";

import { z } from "zod";
import { getCustomerByPhone, type CustomerPhoneLookup } from "@/modules/customers/customer.service";
import { getOrdersByCustomerId } from "@/modules/orders/order.service";
import type { CustomerOrderHistoryItem } from "@/modules/orders/order.types";

export type DashboardPhoneLookupState = {
  phoneSearch: string;
  customer: CustomerPhoneLookup | null;
  orders: CustomerOrderHistoryItem[];
  errors?: {
    phone?: string[];
    _global?: string[];
  };
  hasSearched: boolean;
};

const initialLookupState = {
  phoneSearch: "",
  customer: null,
  orders: [],
  hasSearched: false,
} satisfies DashboardPhoneLookupState;

const phoneLookupSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .regex(/^\+?[\d\s\-().]+$/, "Enter a valid phone number"),
});

export async function lookupDashboardSalesByPhone(
  _prev: DashboardPhoneLookupState,
  formData: FormData
): Promise<DashboardPhoneLookupState> {
  const phoneSearch = formValue(formData.get("phone"));
  const parsed = phoneLookupSchema.safeParse({ phone: phoneSearch });

  if (!parsed.success) {
    return {
      ...initialLookupState,
      phoneSearch,
      hasSearched: true,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const customer = await getCustomerByPhone(parsed.data.phone);

    if (!customer) {
      return {
        ...initialLookupState,
        phoneSearch: parsed.data.phone,
        hasSearched: true,
      };
    }

    const orders = await getOrdersByCustomerId(customer.id);

    return {
      phoneSearch: parsed.data.phone,
      customer,
      orders,
      hasSearched: true,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to search by phone";

    return {
      ...initialLookupState,
      phoneSearch: parsed.data.phone,
      hasSearched: true,
      errors: { _global: [message] },
    };
  }
}

function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
