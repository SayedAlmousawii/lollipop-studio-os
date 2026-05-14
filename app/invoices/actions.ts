"use server";

import { InvoiceLineType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  closeInvoice,
  createAdjustmentInvoice,
  createCreditNote,
  issueInvoice,
} from "@/modules/invoices/invoice.service";
import {
  createAdjustmentInvoiceSchema,
  createCreditNoteSchema,
  createRefundInvoiceSchema,
} from "@/modules/invoices/invoice.schema";
import { recordPaymentSchema } from "@/modules/payments/payment.schema";
import { recordPayment } from "@/modules/payments/payment.service";
import { issueRefundWithPayment } from "@/modules/refunds/refund.service";
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
      unitPrice: parsed.data.totalAmount,
    }],
  });
  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}

export async function issueCreditNoteAction(
  targetFinalInvoiceId: string,
  formData: FormData
): Promise<void> {
  const parsed = createCreditNoteSchema.safeParse({
    reason: formData.get("reason"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new Error("Invalid credit note details");
  }

  const lines = parseCreditNoteLines(formData);
  const appUser = await requireCurrentAppUserPermission(
    PERMISSIONS.CREDIT_NOTE_ISSUE
  );
  const invoice = await createCreditNote({
    targetFinalInvoiceId,
    lines,
    reason: parsed.data.reason,
    notes: parsed.data.notes,
    createdByUserId: appUser.id,
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${targetFinalInvoiceId}`);
  redirect(`/invoices/${invoice.id}`);
}

export async function issueRefundAction(
  sourceInvoiceId: string,
  formData: FormData
): Promise<void> {
  const parsed = createRefundInvoiceSchema.safeParse({
    amount: formData.get("amount"),
    reason: formData.get("reason"),
    refundOfPaymentId: formData.get("refundOfPaymentId") || undefined,
    method: formData.get("method"),
    reference: formData.get("reference") || undefined,
    paidAt: formData.get("paidAt") || undefined,
  });

  if (!parsed.success) {
    throw new Error("Invalid refund details");
  }

  const appUser = await requireCurrentAppUserPermission(PERMISSIONS.REFUND_ISSUE);
  const result = await issueRefundWithPayment({
    sourceInvoiceId,
    amount: parsed.data.amount,
    reason: parsed.data.reason,
    createdByUserId: appUser.id,
    method: parsed.data.method,
    refundOfPaymentId: parsed.data.refundOfPaymentId,
    reference: parsed.data.reference,
    paidAt: parsed.data.paidAt,
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${sourceInvoiceId}`);
  redirect(`/invoices/${result.refundInvoiceId}`);
}

function parseCreditNoteLines(formData: FormData) {
  const descriptions = formData.getAll("creditLineDescription");
  const quantities = formData.getAll("creditLineQuantity");
  const unitPrices = formData.getAll("creditLineUnitPrice");

  const lines = descriptions.flatMap((descriptionEntry, index) => {
    const description = String(descriptionEntry ?? "").trim();
    const rawQuantity = String(quantities[index] ?? "").trim();
    const rawUnitPrice = String(unitPrices[index] ?? "").trim();
    if (!description && !rawQuantity && !rawUnitPrice) {
      return [];
    }

    const quantity = Number(rawQuantity);
    const unitPrice = Number(rawUnitPrice);
    if (
      !description ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0
    ) {
      throw new Error(`Invalid credit note line at index ${index}`);
    }

    return [{ description, quantity, unitPrice }];
  });

  if (lines.length === 0) {
    throw new Error("Credit note requires at least one line");
  }

  return lines;
}
