"use client";

import { useState, useRef, useId, useCallback } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { createBooking, type ActionState } from "@/app/bookings/new/actions";

const SESSION_TYPES = [
  { value: "NEWBORN", label: "Newborn" },
  { value: "KIDS", label: "Kids" },
  { value: "FAMILY", label: "Family" },
  { value: "MATERNITY", label: "Maternity" },
  { value: "OTHER", label: "Other" },
] as const;

interface Customer {
  id: string;
  name: string;
}

interface NewBookingFormProps {
  customers: Customer[];
  packages: { id: string; name: string; price: string }[];
  photographers: { id: string; name: string }[];
  departments: { id: string; name: string; code: string }[];
  initialCustomerId?: string;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} className="min-w-[140px]">
      {pending ? "Creating…" : "Create Booking"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p className="mt-1 text-xs text-(--color-destructive)">{messages[0]}</p>
  );
}

interface CustomerComboboxProps {
  customers: Customer[];
  error?: string[];
  initialCustomerId?: string;
}

function CustomerCombobox({
  customers,
  error,
  initialCustomerId,
}: CustomerComboboxProps) {
  const initialCustomer =
    customers.find((customer) => customer.id === initialCustomerId) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialCustomer?.name ?? "");
  const [selected, setSelected] = useState<Customer | null>(initialCustomer);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? customers.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase())
      )
    : customers;

  const handleSelect = useCallback(
    (customer: Customer) => {
      setSelected(customer);
      setQuery(customer.name);
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    []
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && activeIndex >= 0) {
      e.preventDefault();
      const customer = filtered[activeIndex];
      if (customer) handleSelect(customer);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input type="hidden" name="customerId" value={selected?.id ?? ""} />
      <div className="relative">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={
            open && activeIndex >= 0
              ? `${listboxId}-opt-${activeIndex}`
              : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
            if (selected && e.target.value !== selected.name) setSelected(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Search customers…"
          autoComplete="off"
          className="flex h-10 w-full rounded-sm border border-(--color-border) bg-(--color-surface) px-3 py-2 pr-8 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-0"
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-(--color-text-secondary)" />
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Customers"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-(--color-border) bg-(--color-surface) py-1 shadow-md"
        >
          {filtered.length === 0 ? (
            <li
              role="option"
              aria-selected={false}
              className="px-3 py-2 text-sm text-(--color-text-secondary)"
            >
              No customers found.
            </li>
          ) : (
            filtered.map((c, i) => (
              <li
                key={c.id}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={selected?.id === c.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(c);
                }}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  i === activeIndex
                    ? "bg-(--color-surface-soft) text-(--color-text-primary)"
                    : "text-(--color-text-secondary) hover:bg-(--color-surface-soft) hover:text-(--color-text-primary)"
                )}
              >
                {c.name}
              </li>
            ))
          )}
        </ul>
      )}

      <FieldError messages={error} />
    </div>
  );
}

export function NewBookingForm({
  customers,
  packages,
  photographers,
  departments,
  initialCustomerId,
}: NewBookingFormProps) {
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedSessionType, setSelectedSessionType] = useState("");
  const [state, formAction] = useActionState<ActionState, FormData>(
    createBooking,
    {}
  );
  const createDisabled = departments.length === 0;

  return (
    <form action={formAction} className="space-y-6">
      {/* Global error */}
      {state.errors?._global && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-(--color-destructive)">
          {state.errors._global[0]}
        </p>
      )}

      {/* Customer */}
      {departments.length === 0 ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          An active department is required before this booking can be saved.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="customerId-input">Customer</Label>
        <CustomerCombobox
          customers={customers}
          error={state.errors?.customerId}
          initialCustomerId={initialCustomerId}
        />
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

      <div className="space-y-1.5">
        <Label htmlFor="departmentId">Department</Label>
        <input type="hidden" name="departmentId" value={selectedDepartmentId} />
        <Select
          value={selectedDepartmentId}
          onValueChange={setSelectedDepartmentId}
          disabled={departments.length === 0}
        >
          <SelectTrigger id="departmentId" className="w-full">
            <SelectValue placeholder="Select department…" />
          </SelectTrigger>
          <SelectContent>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={state.errors?.departmentId} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assignedPhotographerId">Assigned Photographer</Label>
        <select
          id="assignedPhotographerId"
          name="assignedPhotographerId"
          defaultValue=""
          className="flex h-10 w-full rounded-sm border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-0 disabled:opacity-50"
        >
          <option value="">Unassigned</option>
          {photographers.map((photographer) => (
            <option key={photographer.id} value={photographer.id}>
              {photographer.name}
            </option>
          ))}
        </select>
        <FieldError messages={state.errors?.assignedPhotographerId} />
      </div>

      {/* Session Type */}
      <div className="space-y-1.5">
        <Label htmlFor="sessionType">Session Type</Label>
        <input type="hidden" name="sessionType" value={selectedSessionType} />
        <Select value={selectedSessionType} onValueChange={setSelectedSessionType}>
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

      <div className="space-y-1.5">
        <Label htmlFor="themes">Themes</Label>
        <Textarea
          id="themes"
          name="themes"
          rows={3}
          placeholder="One theme per line or comma separated"
          className="resize-none"
        />
        <FieldError messages={state.errors?.themes} />
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
        <SubmitButton disabled={createDisabled} />
      </div>
    </form>
  );
}
