"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  archivePackageAction,
  type PackageArchiveActionState,
} from "@/app/packages/actions";
import { Button } from "@/components/ui/button";

interface PackageArchiveButtonProps {
  packageId: string;
  activeReferenceCount: number;
  totalReferenceCount: number;
}

export function PackageArchiveButton({
  packageId,
  activeReferenceCount,
  totalReferenceCount,
}: PackageArchiveButtonProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [state, formAction] = useActionState<
    PackageArchiveActionState,
    FormData
  >(archivePackageAction.bind(null, packageId), {});
  const disabled = activeReferenceCount > 0;

  return (
    <form action={formAction} className="space-y-2">
      {state.errors?._global ? (
        <p className="max-w-64 text-xs text-danger">{state.errors._global[0]}</p>
      ) : null}
      {disabled ? (
        <p className="max-w-64 px-2 py-1.5 text-xs text-text-secondary">
          {activeReferenceCount} active booking/order{" "}
          {activeReferenceCount === 1 ? "reference" : "references"}
        </p>
      ) : null}
      <ArchiveSubmitButton
        confirmed={confirmed}
        disabled={disabled}
        totalReferenceCount={totalReferenceCount}
        onPrime={() => setConfirmed(true)}
      />
    </form>
  );
}

function ArchiveSubmitButton({
  confirmed,
  disabled,
  totalReferenceCount,
  onPrime,
}: {
  confirmed: boolean;
  disabled: boolean;
  totalReferenceCount: number;
  onPrime: () => void;
}) {
  const { pending } = useFormStatus();
  const label = totalReferenceCount > 0 ? "Archive" : "Delete";

  if (!confirmed) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start px-2 py-1.5 text-sm text-danger hover:text-danger"
        onClick={onPrime}
        disabled={disabled || pending}
      >
        {label}
      </Button>
    );
  }

  return (
    <Button
      type="submit"
      variant="ghost"
      className="h-auto w-full justify-start px-2 py-1.5 text-sm text-danger hover:text-danger"
      disabled={disabled || pending}
    >
      {pending ? "Working..." : `Confirm ${label}`}
    </Button>
  );
}
