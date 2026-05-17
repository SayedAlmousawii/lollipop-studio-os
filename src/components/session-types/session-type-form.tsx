"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createSessionType,
  updateSessionType,
  type SessionTypeActionState,
  type SessionTypeFormValues,
} from "@/app/session-types/actions";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  SessionTypeDepartmentOption,
  SessionTypeRow,
} from "@/modules/session-types/session-type.types";
import { CALENDAR_COLOR_OPTIONS } from "./session-type-calendar-colors";

interface SessionTypeCreateFormProps {
  mode: "create";
  departments: SessionTypeDepartmentOption[];
  sessionType?: never;
}

interface SessionTypeEditFormProps {
  mode: "edit";
  departments: SessionTypeDepartmentOption[];
  sessionType: SessionTypeRow;
}

type SessionTypeFormProps =
  | SessionTypeCreateFormProps
  | SessionTypeEditFormProps;

export function SessionTypeForm({
  mode,
  departments,
  sessionType,
}: SessionTypeFormProps) {
  const defaultValues =
    mode === "edit" ? valuesFromSessionType(sessionType) : emptyValues();
  const action =
    mode === "edit"
      ? updateSessionType.bind(null, sessionType.id)
      : createSessionType;
  const [state, formAction] = useActionState<SessionTypeActionState, FormData>(
    action,
    { values: defaultValues }
  );

  return (
    <form action={formAction} className="space-y-5">
      {state.errors?._global ? (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.errors._global[0]}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-md bg-success-soft px-4 py-3 text-sm text-success">
          {state.success}
        </p>
      ) : null}

      <SessionTypeFields
        mode={mode}
        state={state}
        departments={departments}
        sessionType={sessionType}
      />

      <div className="flex items-center justify-end gap-3 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Close
          </Button>
        </DialogClose>
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}

function SessionTypeFields({
  mode,
  state,
  departments,
  sessionType,
}: {
  mode: "create" | "edit";
  state: SessionTypeActionState;
  departments: SessionTypeDepartmentOption[];
  sessionType?: SessionTypeRow;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="session-type-department">Department *</Label>
          {mode === "create" ? (
            <select
              id="session-type-department"
              name="departmentId"
              defaultValue={state.values?.departmentId ?? ""}
              disabled={pending}
              aria-invalid={state.errors?.departmentId?.length ? true : undefined}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              required
            >
              <option value="">Select department...</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                type="hidden"
                name="departmentId"
                value={sessionType?.departmentId ?? ""}
              />
              <div className="flex h-10 items-center rounded-md border border-border bg-surface-soft px-3 text-sm text-text-secondary">
                {sessionType?.departmentName}
              </div>
            </>
          )}
          <FieldError messages={state.errors?.departmentId} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="session-type-name">Name *</Label>
          <Input
            id="session-type-name"
            name="name"
            defaultValue={state.values?.name ?? ""}
            disabled={pending}
            aria-invalid={state.errors?.name?.length ? true : undefined}
            placeholder="Birthday Party"
            required
          />
          <FieldError messages={state.errors?.name} />
        </div>
      </div>

      {mode === "edit" ? (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Code</Label>
            <div className="flex h-10 items-center rounded-md border border-border bg-surface-soft px-3 font-mono text-sm text-text-secondary">
              {sessionType?.code}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="session-type-calendar-label">Calendar label *</Label>
          <Input
            id="session-type-calendar-label"
            name="calendarLabel"
            defaultValue={state.values?.calendarLabel ?? ""}
            disabled={pending}
            aria-invalid={state.errors?.calendarLabel?.length ? true : undefined}
            placeholder="Kids"
            required
          />
          <FieldError messages={state.errors?.calendarLabel} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="session-type-calendar-color">Calendar color</Label>
          <select
            id="session-type-calendar-color"
            name="calendarColor"
            defaultValue={state.values?.calendarColor ?? ""}
            disabled={pending}
            aria-invalid={state.errors?.calendarColor?.length ? true : undefined}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {CALENDAR_COLOR_OPTIONS.map((option) => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError messages={state.errors?.calendarColor} />
        </div>
      </div>
    </>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label = mode === "edit" ? "Save Changes" : "Create Session Type";
  const pendingLabel = mode === "edit" ? "Saving..." : "Creating...";

  return (
    <Button type="submit" disabled={pending} className="min-w-[160px]">
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}

function valuesFromSessionType(
  sessionType: SessionTypeRow
): SessionTypeFormValues {
  return {
    departmentId: sessionType.departmentId,
    name: sessionType.name,
    calendarLabel: sessionType.calendarLabel,
    calendarColor: sessionType.calendarColor,
  };
}

function emptyValues(): SessionTypeFormValues {
  return {
    departmentId: "",
    name: "",
    calendarLabel: "",
    calendarColor: "",
  };
}
