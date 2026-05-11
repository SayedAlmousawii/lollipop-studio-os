"use server";

import { z } from "zod";
import {
  getCustomerByPhone,
  getCustomerPhoneLookupById,
  type CustomerPhoneLookup,
} from "@/modules/customers/customer.service";
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
    .regex(/^(?=.*\d)\+?[\d\s\-().]+$/, "Enter a valid phone number"),
});

const customerIdLookupSchema = z.object({
  customerId: z.string().trim().min(1, "Customer is required"),
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
    console.error("Dashboard phone lookup failed", error);

    return {
      ...initialLookupState,
      phoneSearch: parsed.data.phone,
      hasSearched: true,
      errors: { _global: ["Unable to complete phone search, please try again."] },
    };
  }
}

export async function lookupDashboardSalesByCustomerId(
  customerId: string
): Promise<DashboardPhoneLookupState> {
  const parsed = customerIdLookupSchema.safeParse({ customerId });

  if (!parsed.success) {
    return {
      ...initialLookupState,
      hasSearched: true,
      errors: { _global: ["Customer is required."] },
    };
  }

  try {
    const customer = await getCustomerPhoneLookupById(parsed.data.customerId);

    if (!customer) {
      return {
        ...initialLookupState,
        hasSearched: true,
      };
    }

    const orders = await getOrdersByCustomerId(customer.id);

    return {
      phoneSearch: customer.phone,
      customer,
      orders,
      hasSearched: true,
    };
  } catch (error) {
    console.error("Dashboard customer lookup failed", error);

    return {
      ...initialLookupState,
      hasSearched: true,
      errors: { _global: ["Unable to complete customer search, please try again."] },
    };
  }
}

function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
