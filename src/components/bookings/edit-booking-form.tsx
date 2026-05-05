"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Save } from "lucide-react";
import {
  updateBookingAction,
  type UpdateBookingActionState,
} from "@/app/bookings/[bookingId]/edit/actions";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { PaymentStatusBadge } from "@/components/bookings/payment-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { EditableBooking } from "@/modules/bookings/booking.service";

const SESSION_TYPES = [
  { value: "NEWBORN", label: "Newborn" },
  { value: "KIDS", label: "Kids" },
  { value: "FAMILY", label: "Family" },
  { value: "MATERNITY", label: "Maternity" },
  { value: "OTHER", label: "Other" },
] as const;

interface BookingOption {
  id: string;
  name: string;
}

interface PackageOption extends BookingOption {
  priceLabel: string;
}

interface EditBookingFormProps {
  booking: EditableBooking;
  customers: BookingOption[];
  packages: PackageOption[];
  photographers: BookingOption[];
}

export function EditBookingForm({
  booking,
  customers,
  packages,
  photographers,
}: EditBookingFormProps) {
  const packageOptions = useMemo(
    () => mergePackageOptions(packages, booking),
    [packages, booking]
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState(booking.customerId);
  const [selectedPackageId, setSelectedPackageId] = useState(booking.packageId);
  const [selectedSessionType, setSelectedSessionType] = useState(
    booking.sessionType
  );
  const [state, formAction] = useActionState<
    UpdateBookingActionState,
    FormData
  >(updateBookingAction.bind(null, booking.id), {});

  const selectedCustomer =
    customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedPackage =
    packageOptions.find((item) => item.id === selectedPackageId) ?? null;
  const saveDisabled =
    !booking.canEdit || customers.length === 0 || packageOptions.length === 0;

  return (
    <form action={formAction} className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-text-primary">
            Edit Booking
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {selectedCustomer?.name ?? booking.customerName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" asChild>
            <Link href="/bookings">Back to Bookings</Link>
          </Button>
          <SubmitButton disabled={saveDisabled} />
        </div>
      </div>

      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}

      {!booking.canEdit ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          Completed and cancelled bookings cannot be edited.
        </p>
      ) : null}

      {customers.length === 0 || packageOptions.length === 0 ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          A customer and package are required before this booking can be saved.
        </p>
      ) : null}

      <Section title="Booking Summary">
        <InfoGrid
          items={[
            ["Customer name", booking.customerName],
            [
              "Current package",
              `${booking.packageName}${
                booking.packagePriceLabel !== "—"
                  ? ` · ${booking.packagePriceLabel}`
                  : ""
              }`,
            ],
            ["Department", booking.department],
            ["Photographer", booking.assignedPhotographerName],
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-6">
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-text-muted">
              Booking status
            </p>
            <BookingStatusBadge status={booking.bookingStatus} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-text-muted">
              Deposit status
            </p>
            <PaymentStatusBadge status={booking.depositStatus} />
          </div>
        </div>
      </Section>

      <Section title="Customer">
        <div className="space-y-2">
          <Label htmlFor="customerId">Customer</Label>
          <Select
            name="customerId"
            value={selectedCustomerId}
            onValueChange={setSelectedCustomerId}
            disabled={!booking.canEdit || customers.length === 0}
            required
          >
            <SelectTrigger
              id="customerId"
              aria-invalid={state.errors?.customerId?.length ? true : undefined}
            >
              <SelectValue placeholder="Select a customer..." />
            </SelectTrigger>
            <SelectContent>
              {customers.map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={state.errors?.customerId} />
        </div>
      </Section>

      <Section title="Package">
        <div className="space-y-2">
          <Label htmlFor="packageId">Package</Label>
          <Select
            name="packageId"
            value={selectedPackageId}
            onValueChange={setSelectedPackageId}
            disabled={!booking.canEdit || packageOptions.length === 0}
            required
          >
            <SelectTrigger
              id="packageId"
              aria-invalid={state.errors?.packageId?.length ? true : undefined}
            >
              <SelectValue placeholder="Select a package..." />
            </SelectTrigger>
            <SelectContent>
              {packageOptions.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} · {item.priceLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={state.errors?.packageId} />
          {selectedPackage ? (
            <p className="text-xs text-text-muted">
              Selected package: {selectedPackage.name}
            </p>
          ) : null}
        </div>
      </Section>

      <Section title="Date & Time">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              defaultValue={booking.sessionDate}
              disabled={!booking.canEdit}
              aria-invalid={state.errors?.date?.length ? true : undefined}
            />
            <FieldError messages={state.errors?.date} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="time">Time</Label>
            <Input
              id="time"
              name="time"
              type="time"
              defaultValue={booking.sessionTime}
              disabled={!booking.canEdit}
              aria-invalid={state.errors?.time?.length ? true : undefined}
            />
            <FieldError messages={state.errors?.time} />
          </div>
        </div>
      </Section>

      <Section title="Assignment">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="department">Department</Label>
            <Input
              id="department"
              name="department"
              defaultValue={booking.department}
              disabled={!booking.canEdit}
              aria-invalid={state.errors?.department?.length ? true : undefined}
            />
            <FieldError messages={state.errors?.department} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignedPhotographerId">Assigned photographer</Label>
            <select
              id="assignedPhotographerId"
              name="assignedPhotographerId"
              defaultValue={booking.assignedPhotographerId}
              disabled={!booking.canEdit}
              className="flex h-10 w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0 disabled:opacity-50"
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
        </div>
      </Section>

      <Section title="Session Type">
        <div className="space-y-2">
          <Label htmlFor="sessionType">Session type</Label>
          <Select
            name="sessionType"
            value={selectedSessionType}
            onValueChange={(value) =>
              setSelectedSessionType(value as EditableBooking["sessionType"])
            }
            disabled={!booking.canEdit}
            required
          >
            <SelectTrigger
              id="sessionType"
              aria-invalid={state.errors?.sessionType?.length ? true : undefined}
            >
              <SelectValue placeholder="Select session type..." />
            </SelectTrigger>
            <SelectContent>
              {SESSION_TYPES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={state.errors?.sessionType} />
        </div>
      </Section>

      <Section title="Themes">
        <div className="space-y-2">
          <Label htmlFor="themes">Themes</Label>
          <Textarea
            id="themes"
            name="themes"
            defaultValue={booking.themes.map((theme) => theme.themeName).join("\n")}
            rows={4}
            disabled={!booking.canEdit}
            className="resize-none"
          />
          <p className="text-xs text-text-muted">
            Enter one theme per line or separate them with commas.
          </p>
          <FieldError messages={state.errors?.themes} />
        </div>
      </Section>

      <Section title="Notes">
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            defaultValue={booking.notes}
            rows={5}
            disabled={!booking.canEdit}
            className="resize-none"
          />
          <FieldError messages={state.errors?.notes} />
        </div>
      </Section>

      <div className="flex justify-end">
        <SubmitButton disabled={saveDisabled} />
      </div>
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} className="min-w-[120px]">
      <Save className="mr-2 h-4 w-4" />
      {pending ? "Saving..." : "Save"}
    </Button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="space-y-1">
          <p className="text-xs font-medium uppercase text-text-muted">{label}</p>
          <p className="text-sm font-medium text-text-primary">{value}</p>
        </div>
      ))}
    </div>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}

function mergePackageOptions(
  packages: PackageOption[],
  booking: EditableBooking
): PackageOption[] {
  if (!booking.packageId) return packages;
  if (packages.some((item) => item.id === booking.packageId)) return packages;

  return [
    ...packages,
    {
      id: booking.packageId,
      name: booking.packageName,
      priceLabel: booking.packagePriceLabel,
    },
  ];
}
