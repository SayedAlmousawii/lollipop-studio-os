"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Bell,
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  ShieldAlert,
  Truck,
} from "lucide-react";
import {
  updateDeliveryWorkflowAction,
  type UpdateDeliveryActionState,
} from "@/app/orders/[orderId]/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  OrderDeliveryAction,
  OrderDeliveryWorkflow,
} from "@/modules/orders/order.types";

interface DeliveryWorkflowFormProps {
  delivery: OrderDeliveryWorkflow;
}

export function DeliveryWorkflowForm({ delivery }: DeliveryWorkflowFormProps) {
  const [state, formAction] = useActionState<UpdateDeliveryActionState, FormData>(
    updateDeliveryWorkflowAction.bind(null, delivery.orderId),
    {}
  );
  const [allowOverride, setAllowOverride] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}

      {delivery.completionBlockers.length > 0 ? (
        <div className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4" />
            <div className="space-y-1">
              {delivery.completionBlockers.map((blocker) => (
                <p key={blocker}>{blocker}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4 text-accent" />
              Delivery State
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReadOnlyMetric label="Delivery status" value={delivery.deliveryStatus} />
            <ReadOnlyMetric label="Production status" value={delivery.productionStatus} />
            <ReadOnlyMetric label="Payment status" value={delivery.paymentStatus} />
            <ReadOnlyMetric label="Ready for pickup" value={delivery.readyAt ?? "Not ready"} />
            <ReadOnlyMetric label="Prepared" value={delivery.preparedAt ?? "Not prepared"} />
            <ReadOnlyMetric label="Customer notified" value={delivery.customerNotifiedAt ?? "Not notified"} />
            <ReadOnlyMetric label="Picked up" value={delivery.pickedUpAt ?? "Not recorded"} />
            <ReadOnlyMetric label="Completed" value={delivery.completedAt ?? "Not completed"} />
            <ReadOnlyMetric label="Completed by" value={delivery.completedBy || "Not recorded"} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pickup Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="pickupNotes">Notes</Label>
              <Textarea
                id="pickupNotes"
                name="pickupNotes"
                defaultValue={delivery.pickupNotes}
                rows={5}
                aria-invalid={state.errors?.pickupNotes?.length ? true : undefined}
              />
              <FieldError messages={state.errors?.pickupNotes} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Completion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="rounded-md border border-border bg-surface-soft px-3 py-2 text-sm text-text-secondary">
                Completion will be attributed to your signed-in staff account.
              </p>

              {delivery.requiresPaymentOverride ? (
                <div className="space-y-3 rounded-md border border-border bg-surface-soft p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <input
                      type="checkbox"
                      name="allowPaymentOverride"
                      value="true"
                      checked={allowOverride}
                      onChange={(event) => setAllowOverride(event.target.checked)}
                    />
                    Allow manager/admin payment override
                  </label>
                  <div className="space-y-2">
                    <Label htmlFor="overrideReason">Override reason</Label>
                    <Textarea
                      id="overrideReason"
                      name="overrideReason"
                      defaultValue={delivery.overrideReason}
                      rows={3}
                      disabled={!allowOverride}
                      aria-invalid={state.errors?.overrideReason?.length ? true : undefined}
                    />
                    <FieldError messages={state.errors?.overrideReason} />
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            <DeliverySubmitButton
              action="prepareForPickup"
              disabled={!delivery.canPrepareForPickup}
              variant="outline"
            >
              <PackageCheck className="h-4 w-4" />
              Prepare
            </DeliverySubmitButton>
            <DeliverySubmitButton
              action="recordCustomerNotification"
              disabled={!delivery.canRecordNotification}
              variant="outline"
            >
              <Bell className="h-4 w-4" />
              Notify
            </DeliverySubmitButton>
            <DeliverySubmitButton
              action="markPickedUp"
              disabled={!delivery.canMarkPickedUp}
            >
              <ClipboardCheck className="h-4 w-4" />
              Picked up
            </DeliverySubmitButton>
            <DeliverySubmitButton
              action="completeOrder"
              disabled={!delivery.canCompleteOrder}
            >
              <CheckCircle2 className="h-4 w-4" />
              Complete
            </DeliverySubmitButton>
          </div>
        </div>
      </div>
    </form>
  );
}

function DeliverySubmitButton({
  action,
  children,
  disabled,
  variant,
}: {
  action: OrderDeliveryAction;
  children: React.ReactNode;
  disabled: boolean;
  variant?: "default" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="action"
      value={action}
      variant={variant}
      disabled={disabled || pending}
    >
      {pending ? "Saving..." : children}
    </Button>
  );
}

function ReadOnlyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-soft p-3">
      <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-sm text-danger">{messages[0]}</p>;
}
