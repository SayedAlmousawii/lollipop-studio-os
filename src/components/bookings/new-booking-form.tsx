"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBooking, type ActionState } from "@/app/bookings/new/actions";

const SESSION_TYPES = [
  { value: "NEWBORN", label: "Newborn" },
  { value: "KIDS", label: "Kids" },
  { value: "FAMILY", label: "Family" },
  { value: "MATERNITY", label: "Maternity" },
  { value: "OTHER", label: "Other" },
] as const;

interface NewBookingFormProps {
  customers: { id: string; name: string }[];
  packages: { id: string; name: string; price: string }[];
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-w-[140px]">
      {pending ? "Creating…" : "Create Booking"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="mt-1 text-xs text-(--color-destructive)">{messages[0]}</p>;
}

export function NewBookingForm({ customers, packages }: NewBookingFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    createBooking,
    {}
  );

  return (
    <form action={formAction} className="space-y-6">
      {/* Customer */}
      <div className="space-y-1.5">
        <Label htmlFor="customerId">Customer</Label>
        <select
          id="customerId"
          name="customerId"
          defaultValue=""
          className="flex h-10 w-full rounded-sm border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-0 disabled:opacity-50"
        >
          <option value="" disabled>
            Select a customer…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <FieldError messages={state.errors?.customerId} />
      </div>

      {/* Package */}
      <div className="space-y-1.5">
        <Label htmlFor="packageId">Package</Label>
        <select
          id="packageId"
          name="packageId"
          defaultValue=""
          className="flex h-10 w-full rounded-sm border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-0 disabled:opacity-50"
        >
          <option value="" disabled>
            Select a package…
          </option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.price}
            </option>
          ))}
        </select>
        <FieldError messages={state.errors?.packageId} />
      </div>

      {/* Session Date */}
      <div className="space-y-1.5">
        <Label htmlFor="sessionDate">Session Date</Label>
        <Input
          id="sessionDate"
          name="sessionDate"
          type="date"
          className="w-full"
        />
        <FieldError messages={state.errors?.sessionDate} />
      </div>

      {/* Session Type */}
      <div className="space-y-1.5">
        <Label htmlFor="sessionType">Session Type</Label>
        <Select name="sessionType">
          <SelectTrigger id="sessionType" className="w-full">
            <SelectValue placeholder="Select session type…" />
          </SelectTrigger>
          <SelectContent>
            {SESSION_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={state.errors?.sessionType} />
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          placeholder="Optional notes…"
          rows={3}
          className="w-full resize-none"
        />
        <FieldError messages={state.errors?.notes} />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="outline" asChild>
          <Link href="/bookings">Cancel</Link>
        </Button>
        <SubmitButton />
      </div>
    </form>
  );
}
