"use client";

import type { ReactNode } from "react";
import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import {
  createChild,
  updateChild,
  type ChildActionState,
} from "@/app/customers/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ChildFormDialogProps {
  customerId: string;
  mode: "create" | "edit";
  trigger: ReactNode;
  child?: {
    id: string;
    name: string;
    dateOfBirthInput: string;
  };
}

export function ChildFormDialog({
  customerId,
  mode,
  trigger,
  child,
}: ChildFormDialogProps) {
  const action =
    mode === "edit" && child
      ? updateChild.bind(null, customerId, child.id)
      : createChild.bind(null, customerId);
  const [state, formAction] = useActionState<ChildActionState, FormData>(
    action,
    {
      values: child
        ? {
            name: child.name,
            dateOfBirth: child.dateOfBirthInput,
          }
        : undefined,
    }
  );
  const isEdit = mode === "edit";

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Child" : "Add Child"}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-5">
          {state.errors?._global ? (
            <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
              {state.errors._global[0]}
            </p>
          ) : null}

          <ChildFields state={state} />

          <div className="flex items-center justify-end gap-3 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <SubmitButton mode={mode} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChildFields({ state }: { state: ChildActionState }) {
  const { pending } = useFormStatus();
  const fieldId = useId();
  const nameId = `${fieldId}-name`;
  const dateOfBirthId = `${fieldId}-date-of-birth`;

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={nameId}>Child name</Label>
        <Input
          id={nameId}
          name="name"
          defaultValue={state.values?.name ?? ""}
          disabled={pending}
          aria-invalid={state.errors?.name?.length ? true : undefined}
          autoComplete="off"
        />
        <FieldError messages={state.errors?.name} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={dateOfBirthId}>Date of birth</Label>
        <Input
          id={dateOfBirthId}
          name="dateOfBirth"
          type="date"
          defaultValue={state.values?.dateOfBirth ?? ""}
          disabled={pending}
          aria-invalid={state.errors?.dateOfBirth?.length ? true : undefined}
        />
        <FieldError messages={state.errors?.dateOfBirth} />
      </div>
    </>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label = mode === "edit" ? "Save Child" : "Add Child";
  const pendingLabel = mode === "edit" ? "Saving..." : "Adding...";

  return (
    <Button type="submit" disabled={pending} className="min-w-[120px]">
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}
