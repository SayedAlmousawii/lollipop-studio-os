"use client";

import { type ReactNode, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  checkInBookingAction,
  type CheckInBookingActionState,
} from "@/app/bookings/[bookingId]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  BookingPhotographerOption,
  RecommendedPhotographer,
} from "@/modules/bookings/booking.service";

interface CheckInDialogProps {
  bookingId: string;
  assignedPhotographerId: string;
  photographers: BookingPhotographerOption[];
  recommendedPhotographer: RecommendedPhotographer;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  errorClassName?: string;
}

export function CheckInDialog({
  bookingId,
  assignedPhotographerId,
  photographers,
  recommendedPhotographer,
  trigger,
  open,
  onOpenChange,
  errorClassName = "text-sm text-danger",
}: CheckInDialogProps) {
  const [state, formAction] = useActionState<
    CheckInBookingActionState,
    FormData
  >(checkInBookingAction, {});
  const [selectedPhotographerId, setSelectedPhotographerId] = useState(
    assignedPhotographerId || recommendedPhotographer?.id || ""
  );
  const [consent, setConsent] = useState(false);
  const [consentTouched, setConsentTouched] = useState(false);

  function handleConsentChange(nextValue: boolean) {
    setConsent(nextValue);
    setConsentTouched(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check In Booking</DialogTitle>
          <DialogDescription>
            Assign the session photographer and record the customer&apos;s
            social media consent before creating the job and order.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-5">
          <input type="hidden" name="bookingId" value={bookingId} />
          <input
            type="hidden"
            name="assignedPhotographerId"
            value={selectedPhotographerId}
          />
          {consentTouched ? (
            <input
              type="hidden"
              name="socialMediaConsent"
              value={consent ? "true" : "false"}
            />
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={`check-in-photographer-${bookingId}`}>
              Photographer
            </Label>
            <Select
              value={selectedPhotographerId}
              onValueChange={setSelectedPhotographerId}
            >
              <SelectTrigger id={`check-in-photographer-${bookingId}`}>
                <SelectValue placeholder="Select a photographer..." />
              </SelectTrigger>
              <SelectContent>
                {photographers.map((photographer) => (
                  <SelectItem key={photographer.id} value={photographer.id}>
                    {photographer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">
              {recommendedPhotographer
                ? `Recommended: ${recommendedPhotographer.name}`
                : "No photographer history found"}
            </p>
            <FieldError messages={state.errors?.assignedPhotographerId} />
          </div>

          <div className="rounded-md border border-border bg-surface-soft p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor={`social-media-consent-${bookingId}`}>
                  Social media consent
                </Label>
                <p className="text-xs text-text-muted">
                  Receptionist must explicitly ask and toggle the switch.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-text-secondary">
                  {consent ? "Yes" : "No"}
                </span>
                <Switch
                  id={`social-media-consent-${bookingId}`}
                  checked={consent}
                  onCheckedChange={handleConsentChange}
                />
              </div>
            </div>
            {!consentTouched ? (
              <p className="mt-2 text-xs text-warning">
                Toggle once to confirm the customer&apos;s answer.
              </p>
            ) : null}
            <FieldError messages={state.errors?.socialMediaConsent} />
          </div>

          {state.errors?._global ? (
            <p className={errorClassName} role="alert" aria-live="assertive">
              {state.errors._global[0]}
            </p>
          ) : null}

          <SubmitButton
            disabled={!selectedPhotographerId || !consentTouched}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={disabled || pending} className="w-full">
      {pending ? "Checking in..." : "Check In"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}
