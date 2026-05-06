"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createInvoiceForOrder } from "@/modules/invoices/invoice.service";

export async function createOrderInvoiceAction(orderId: string): Promise<void> {
  const invoice = await createInvoiceForOrder(orderId);
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}
