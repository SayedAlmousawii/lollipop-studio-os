"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createOrderInvoiceAction,
  type CreateOrderInvoiceActionState,
} from "@/app/orders/[orderId]/actions";
import { Button } from "@/components/ui/button";

export function CreateOrderInvoiceForm({
  orderId,
  returnToSales = false,
  variant = "default",
}: {
  orderId: string;
  returnToSales?: boolean;
  variant?: "default" | "outline";
}) {
  const [state, formAction] = useActionState<
    CreateOrderInvoiceActionState,
    FormData
  >(createOrderInvoiceAction.bind(null, orderId), {});

  return (
    <form action={formAction} className="space-y-2">
      {returnToSales ? <input type="hidden" name="returnTo" value="sales" /> : null}
      <SubmitButton variant={variant} />
      {state.errors?._global?.length ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          {state.errors._global.join(" ")}
        </div>
      ) : null}
    </form>
  );
}

function SubmitButton({ variant }: { variant: "default" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} className="w-full" disabled={pending}>
      {pending ? "Creating..." : "Create Invoice"}
    </Button>
  );
}
