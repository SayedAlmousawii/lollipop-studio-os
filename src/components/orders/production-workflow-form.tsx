"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  CheckCircle2,
  CirclePlay,
  Hammer,
  PackageCheck,
  Printer,
  Send,
  Truck,
} from "lucide-react";
import {
  updateProductionWorkflowAction,
  type UpdateProductionActionState,
} from "@/app/orders/[orderId]/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  OrderProductionAction,
  OrderProductionSection,
  OrderProductionWorkflow,
} from "@/modules/orders/order.types";

interface ProductionWorkflowFormProps {
  production: OrderProductionWorkflow;
}

export function ProductionWorkflowForm({ production }: ProductionWorkflowFormProps) {
  const [state, formAction] = useActionState<UpdateProductionActionState, FormData>(
    updateProductionWorkflowAction.bind(null, production.orderId),
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}

      {production.readinessWarning ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          {production.readinessWarning}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageCheck className="h-4 w-4 text-accent" />
              Production State
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReadOnlyMetric label="Production status" value={production.productionStatus} />
            <ReadOnlyMetric label="Delivery readiness" value={production.deliveryStatus} />
            <ReadOnlyMetric label="Editing status" value={production.editingStatus} />
            <ReadOnlyMetric
              label="Ready for pickup"
              value={production.readyAt ?? "Not ready"}
            />
            <div className="flex justify-end pt-2">
              <ProductionSubmitButton
                action="markProductionReadyForPickup"
                disabled={!production.canMarkReadyForPickup}
              >
                <Truck className="h-4 w-4" />
                Ready for pickup
              </ProductionSubmitButton>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {production.sections.map((section) => (
            <ProductionSectionCard
              key={section.key}
              section={section}
              disabled={!production.canUpdateProduction}
            />
          ))}
        </div>
      </div>
    </form>
  );
}

function ProductionSectionCard({
  section,
  disabled,
}: {
  section: OrderProductionSection;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {sectionIcon(section.key)}
          {section.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-text-secondary">{section.description}</p>
        <ReadOnlyMetric label="Status" value={section.status} />
        {section.action && section.actionLabel ? (
          <div className="flex justify-end">
            <ProductionSubmitButton action={section.action} disabled={disabled}>
              {buttonIcon(section.action)}
              {section.actionLabel}
            </ProductionSubmitButton>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProductionSubmitButton({
  action,
  children,
  disabled,
}: {
  action: OrderProductionAction;
  children: React.ReactNode;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="action" value={action} disabled={disabled || pending}>
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

function sectionIcon(section: OrderProductionSection["key"]) {
  switch (section) {
    case "printing":
    case "framedPrints":
      return <Printer className="h-4 w-4 text-accent" />;
    case "vendor":
      return <Send className="h-4 w-4 text-accent" />;
    case "assembly":
      return <Hammer className="h-4 w-4 text-accent" />;
    case "finalReadiness":
      return <CheckCircle2 className="h-4 w-4 text-accent" />;
    case "albumDesign":
      return <PackageCheck className="h-4 w-4 text-accent" />;
  }
}

function buttonIcon(action: OrderProductionAction) {
  switch (action) {
    case "markAlbumDesignStarted":
    case "markAssemblyStarted":
    case "markVendorInProgress":
    case "markSentToPrint":
      return <CirclePlay className="h-4 w-4" />;
    case "markProductionReadyForPickup":
      return <Truck className="h-4 w-4" />;
    case "markAlbumDesignCompleted":
    case "markAssemblyCompleted":
    case "markVendorCompleted":
    case "markPrintsReady":
      return <CheckCircle2 className="h-4 w-4" />;
  }
}
