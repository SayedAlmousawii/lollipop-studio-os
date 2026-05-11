"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CheckCircle2,
  CirclePlay,
  ClipboardCheck,
  CreditCard,
  Forward,
  RotateCcw,
  UserPen,
} from "lucide-react";
import {
  updateEditingWorkflowAction,
  type UpdateEditingActionState,
} from "@/app/orders/[orderId]/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RecordUpgradePaymentDialog } from "@/components/orders/record-upgrade-payment-dialog";
import type { OrderEditingWorkflow } from "@/modules/orders/order.types";

interface EditingWorkflowFormProps {
  editing: OrderEditingWorkflow;
}

export function EditingWorkflowForm({ editing }: EditingWorkflowFormProps) {
  const [selectedEditorId, setSelectedEditorId] = useState(
    editing.assignedEditorId ?? editing.editorOptions[0]?.id ?? ""
  );
  const [editedPhotoCount, setEditedPhotoCount] = useState(editing.editedPhotoCount);
  const [estimatedEditingCompletionAt, setEstimatedEditingCompletionAt] = useState(
    editing.estimatedCompletionDateInput ?? ""
  );
  const [state, formAction] = useActionState<UpdateEditingActionState, FormData>(
    updateEditingWorkflowAction.bind(null, editing.orderId),
    {}
  );
  const hasEditors = editing.editorOptions.length > 0;

  return (
    <form action={formAction} className="space-y-4">
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}

      {editing.outstandingBalanceLabel ? (
        <div className="flex flex-col gap-3 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning sm:flex-row sm:items-center sm:justify-between">
          <p>
            Outstanding balance of {editing.outstandingBalanceLabel} must be paid before
            editing can start.
          </p>
          {editing.invoiceId && editing.outstandingBalanceAmount ? (
            <RecordUpgradePaymentDialog
              orderId={editing.orderId}
              invoiceId={editing.invoiceId}
              defaultAmount={editing.outstandingBalanceAmount}
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <CreditCard className="h-4 w-4" />
                  Record Upgrade Payment
                </Button>
              }
            />
          ) : null}
        </div>
      ) : !editing.basePaymentVerified ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          Base package payment is not recorded yet. Editing can be assigned, but it cannot
          start until the base payment exists.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editor Assignment</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[1fr_220px]">
              <div className="space-y-2">
                <Label htmlFor="assignedEditorId">Assigned editor</Label>
                <input type="hidden" name="assignedEditorId" value={selectedEditorId} />
                <Select
                  value={selectedEditorId}
                  onValueChange={setSelectedEditorId}
                  disabled={!hasEditors || !editing.canAssignEditor}
                >
                  <SelectTrigger
                    id="assignedEditorId"
                    aria-invalid={state.errors?.assignedEditorId?.length ? true : undefined}
                  >
                    <SelectValue placeholder="Select editor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {editing.editorOptions.map((editor) => (
                      <SelectItem key={editor.id} value={editor.id}>
                        {editor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError messages={state.errors?.assignedEditorId} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimatedEditingCompletionAt">Estimated completion</Label>
                <input
                  type="hidden"
                  name="estimatedEditingCompletionAt"
                  value={estimatedEditingCompletionAt}
                />
                <DatePicker
                  value={estimatedEditingCompletionAt}
                  onChange={(value) => setEstimatedEditingCompletionAt(value ?? "")}
                  placeholder="Select date"
                  className={`w-full ${!editing.canAssignEditor ? "pointer-events-none opacity-50" : ""}`}
                />
              </div>
              {!hasEditors ? (
                <p className="text-sm text-text-secondary md:col-span-2">
                  No editor users are available yet.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Progress</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="editedPhotoCount">Edited photos</Label>
                <Input
                  id="editedPhotoCount"
                  name="editedPhotoCount"
                  type="number"
                  min="0"
                  max={editing.targetPhotoCount}
                  step="1"
                  value={editedPhotoCount}
                  onChange={(event) =>
                    setEditedPhotoCount(Math.max(Number(event.target.value), 0))
                  }
                  aria-invalid={state.errors?.editedPhotoCount?.length ? true : undefined}
                />
                <FieldError messages={state.errors?.editedPhotoCount} />
              </div>
              <ReadOnlyMetric label="Target photos" value={String(editing.targetPhotoCount)} />
              <ReadOnlyMetric label="Progress" value={`${editing.progressPercent}%`} />
              <progress
                className="h-2 w-full overflow-hidden rounded-full md:col-span-3"
                value={editing.progressPercent}
                max={100}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editing State</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ReadOnlyMetric label="Status" value={editing.editingStatus} />
              <ReadOnlyMetric label="Assigned" value={editing.assignedAt ?? "Not assigned"} />
              <ReadOnlyMetric label="Started" value={editing.startedAt ?? "Not started"} />
              <ReadOnlyMetric label="Completed" value={editing.completedAt ?? "Not completed"} />
              <ReadOnlyMetric label="Revisions" value={editing.revisionState} />
              <ReadOnlyMetric label="Approval" value={editing.approvalState} />
              <ReadOnlyMetric
                label="Customer approved"
                value={editing.customerApprovedAt ?? "Not approved"}
              />
              <ReadOnlyMetric
                label="Sent to production"
                value={editing.sentToProductionAt ?? "Not sent"}
              />
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            <EditingSubmitButton
              action="assignEditor"
              disabled={!hasEditors || !editing.canAssignEditor}
              variant="outline"
            >
              <UserPen className="h-4 w-4" />
              Assign
            </EditingSubmitButton>
            <EditingSubmitButton action="markStarted" disabled={!editing.canMarkStarted}>
              <CirclePlay className="h-4 w-4" />
              Start
            </EditingSubmitButton>
            <EditingSubmitButton
              action="requestRevision"
              disabled={!editing.canRequestRevision}
              variant="outline"
            >
              <RotateCcw className="h-4 w-4" />
              Revision
            </EditingSubmitButton>
            <EditingSubmitButton action="markComplete" disabled={!editing.canMarkComplete}>
              <ClipboardCheck className="h-4 w-4" />
              Complete
            </EditingSubmitButton>
            <EditingSubmitButton action="markApproved" disabled={!editing.canMarkApproved}>
              <CheckCircle2 className="h-4 w-4" />
              Approve
            </EditingSubmitButton>
            <EditingSubmitButton action="sendToProduction" disabled={!editing.canSendToProduction}>
              <Forward className="h-4 w-4" />
              Production
            </EditingSubmitButton>
          </div>
        </div>
      </div>
    </form>
  );
}

function EditingSubmitButton({
  action,
  children,
  disabled,
  variant,
}: {
  action: string;
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
