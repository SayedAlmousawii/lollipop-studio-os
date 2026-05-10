"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCustomer,
  updateCustomer,
  type CustomerActionState,
} from "@/app/customers/actions";
import { DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerStatus } from "@prisma/client";

interface CustomerFormProps {
  mode?: "create" | "edit";
  customerId?: string;
  defaultValues?: {
    name: string;
    phone: string;
    notes: string;
    status?: CustomerStatus;
  };
  returnTo?: string;
  variant?: "page" | "dialog";
}

export function CustomerForm({
  mode = "create",
  customerId,
  defaultValues,
  returnTo,
  variant = "page",
}: CustomerFormProps) {
  const action =
    mode === "edit" && customerId
      ? updateCustomer.bind(null, customerId)
      : createCustomer;
  const [state, formAction] = useActionState<CustomerActionState, FormData>(
    action,
    { values: defaultValues }
  );
  const isEdit = mode === "edit";

  return (
    <form action={formAction} className="space-y-6">
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}

      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

      <CustomerFields state={state} showStatus={isEdit} />

      <div className="flex items-center justify-end gap-3 pt-2">
        <CancelButton variant={variant} />
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}

function CancelButton({ variant }: { variant: "page" | "dialog" }) {
  if (variant === "dialog") {
    return (
      <DialogClose asChild>
        <Button type="button" variant="outline">
          Cancel
        </Button>
      </DialogClose>
    );
  }

  return (
    <Button variant="outline" asChild>
      <Link href="/customers">Cancel</Link>
    </Button>
  );
}

function CustomerFields({
  state,
  showStatus,
}: {
  state: CustomerActionState;
  showStatus: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            name="name"
            defaultValue={state.values?.name ?? ""}
            disabled={pending}
            aria-invalid={state.errors?.name?.length ? true : undefined}
            autoComplete="name"
          />
          <FieldError messages={state.errors?.name} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone number *</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={state.values?.phone ?? ""}
            disabled={pending}
            aria-invalid={state.errors?.phone?.length ? true : undefined}
            autoComplete="tel"
            inputMode="tel"
            placeholder="e.g. +965 96669101"
            required
          />
          <FieldError messages={state.errors?.phone} />
        </div>
      </div>

      {showStatus ? (
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select
            name="status"
            defaultValue={state.values?.status ?? "ACTIVE"}
            disabled={pending}
          >
            <SelectTrigger
              id="status"
              aria-invalid={state.errors?.status?.length ? true : undefined}
            >
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <FieldError messages={state.errors?.status} />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="notes">Internal notes</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={state.values?.notes ?? ""}
          disabled={pending}
          aria-invalid={state.errors?.notes?.length ? true : undefined}
          placeholder="Optional notes for studio staff..."
          rows={4}
        />
        <FieldError messages={state.errors?.notes} />
      </div>
    </>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label = mode === "edit" ? "Save Changes" : "Create Customer";
  const pendingLabel = mode === "edit" ? "Saving..." : "Creating...";

  return (
    <Button type="submit" disabled={pending} className="min-w-[140px]">
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}
