"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  archiveProductAction,
  type ProductArchiveActionState,
} from "@/app/products/actions";
import { Button } from "@/components/ui/button";

interface ProductArchiveButtonProps {
  productId: string;
  packageItemCount: number;
}

export function ProductArchiveButton({
  productId,
  packageItemCount,
}: ProductArchiveButtonProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [state, formAction] = useActionState<
    ProductArchiveActionState,
    FormData
  >(archiveProductAction.bind(null, productId), {});

  return (
    <form action={formAction} className="space-y-2">
      {state.errors?._global ? (
        <p className="max-w-64 text-xs text-danger">{state.errors._global[0]}</p>
      ) : null}
      <ArchiveSubmitButton
        confirmed={confirmed}
        packageItemCount={packageItemCount}
        onPrime={() => setConfirmed(true)}
      />
    </form>
  );
}

function ArchiveSubmitButton({
  confirmed,
  packageItemCount,
  onPrime,
}: {
  confirmed: boolean;
  packageItemCount: number;
  onPrime: () => void;
}) {
  const { pending } = useFormStatus();
  const label = packageItemCount > 0 ? "Archive" : "Delete";

  if (!confirmed) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start px-2 py-1.5 text-sm text-danger hover:text-danger"
        onClick={onPrime}
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
      disabled={pending}
    >
      {pending ? "Working..." : `Confirm ${label}`}
    </Button>
  );
}
