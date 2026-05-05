"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  closeInvoice,
  createAdjustmentInvoice,
  issueInvoice,
} from "@/modules/invoices/invoice.service";
import { createAdjustmentInvoiceSchema } from "@/modules/invoices/invoice.schema";
import { recordPaymentSchema } from "@/modules/payments/payment.schema";
import { recordPayment } from "@/modules/payments/payment.service";

export type RecordPaymentActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

export async function issueInvoiceAction(invoiceId: string): Promise<void> {
  await issueInvoice(invoiceId);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function closeInvoiceAction(invoiceId: string): Promise<void> {
  await closeInvoice(invoiceId);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function recordPaymentAction(
  invoiceId: string,
  _prev: RecordPaymentActionState,
  formData: FormData
): Promise<RecordPaymentActionState> {
  const parsed = recordPaymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paymentType: formData.get("paymentType"),
    paidAt: formData.get("paidAt") || undefined,
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await recordPayment(invoiceId, parsed.data);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    return { success: "Payment recorded." };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to record payment";
    return { errors: { _global: [message] } };
  }
}

export async function createAdjustmentInvoiceAction(
  parentInvoiceId: string,
  formData: FormData
): Promise<void> {
  const parsed = createAdjustmentInvoiceSchema.safeParse({
    totalAmount: formData.get("totalAmount"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new Error("Invalid adjustment invoice details");
  }

  const invoice = await createAdjustmentInvoice(parentInvoiceId, parsed.data);
  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}
