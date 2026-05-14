"use server";

import { InvoiceLineType, Prisma } from "@prisma/client";
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
import {
  PERMISSIONS,
  requireCurrentAppUserPermission,
} from "@/lib/permissions";

export type RecordPaymentActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

export async function issueInvoiceAction(invoiceId: string): Promise<void> {
  const appUser = await requireCurrentAppUserPermission(PERMISSIONS.INVOICE_ISSUE);
  await issueInvoice(invoiceId, { actorUserId: appUser.id });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function closeInvoiceAction(invoiceId: string): Promise<void> {
  const appUser = await requireCurrentAppUserPermission(PERMISSIONS.INVOICE_CLOSE);
  await closeInvoice(invoiceId, { actorUserId: appUser.id });
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
    const appUser = await requireCurrentAppUserPermission(PERMISSIONS.PAYMENT_CREATE);
    await recordPayment(invoiceId, parsed.data, { actorUserId: appUser.id });
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    return { success: "Payment recorded." };
  } catch (error) {
    if (error instanceof Error && "digest" in error) throw error;
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

  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.INVOICE_ADJUSTMENT_CREATE
  );
  const invoice = await createAdjustmentInvoice({
    parentFinalInvoiceId: parentInvoiceId,
    notes: parsed.data.notes,
    createdByUserId: appUser.id,
    lines: [{
      lineType: InvoiceLineType.MANUAL_SURCHARGE,
      description: parsed.data.notes?.trim() || "Manual adjustment",
      quantity: 1,
      unitPrice: new Prisma.Decimal(parsed.data.totalAmount),
    }],
  });
  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}
