"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCustomer,
  type CustomerActionState,
} from "@/app/customers/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CustomerForm() {
  const [state, formAction] = useActionState<CustomerActionState, FormData>(
    createCustomer,
    {}
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}

      <CustomerFields state={state} />

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="outline" asChild>
          <Link href="/customers">Cancel</Link>
        </Button>
        <SubmitButton />
      </div>
    </form>
  );
}

function CustomerFields({ state }: { state: CustomerActionState }) {
  const { pending } = useFormStatus();

  return (
    <>
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
        <Label htmlFor="phone">Phone number</Label>
        <Input
          id="phone"
          name="phone"
          defaultValue={state.values?.phone ?? ""}
          disabled={pending}
          aria-invalid={state.errors?.phone?.length ? true : undefined}
          autoComplete="tel"
          inputMode="tel"
        />
        <FieldError messages={state.errors?.phone} />
      </div>

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

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="min-w-[140px]">
      {pending ? "Creating..." : "Create Customer"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}
