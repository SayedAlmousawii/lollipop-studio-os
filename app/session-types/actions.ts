"use server";

import { revalidatePath } from "next/cache";
import {
  archiveSessionType,
  createSessionType as createSessionTypeRecord,
  SessionTypeDepartmentNotFoundError,
  SessionTypeNameConflictError,
  SessionTypeNotFoundError,
  unarchiveSessionType,
  updateSessionType as updateSessionTypeRecord,
} from "@/modules/session-types/session-type.service";
import {
  createSessionTypeSchema,
  updateSessionTypeSchema,
} from "@/modules/session-types/session-type.schema";

export type SessionTypeActionState = {
  errors?: Partial<Record<string, string[]>>;
  values?: SessionTypeFormValues;
  success?: string;
};

export type SessionTypeFormValues = {
  departmentId: string;
  name: string;
  calendarLabel: string;
  calendarColor: string;
};

export type SessionTypeArchiveActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

const SESSION_TYPE_ACTION_GENERIC_ERROR =
  "An unexpected error occurred while processing the session type.";

export async function createSessionType(
  _prev: SessionTypeActionState,
  formData: FormData
): Promise<SessionTypeActionState> {
  const values = sessionTypeFormValues(formData);
  const parsed = createSessionTypeSchema.safeParse(values);

  if (!parsed.success) {
    return { values, errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createSessionTypeRecord(parsed.data);
  } catch (error) {
    logSessionTypeActionError("createSessionType", error);
    return {
      values,
      errors: errorFieldsForSessionTypeError(error),
    };
  }

  revalidateSessionTypePaths();
  return {
    success: "Session type created.",
    values: emptySessionTypeValues(),
  };
}

export async function updateSessionType(
  sessionTypeId: string,
  _prev: SessionTypeActionState,
  formData: FormData
): Promise<SessionTypeActionState> {
  const values = sessionTypeFormValues(formData);
  const parsed = updateSessionTypeSchema.safeParse({
    name: values.name,
    calendarLabel: values.calendarLabel,
    calendarColor: values.calendarColor,
  });

  if (!parsed.success) {
    return { values, errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateSessionTypeRecord(sessionTypeId, parsed.data);
  } catch (error) {
    logSessionTypeActionError("updateSessionType", error);
    return {
      values,
      errors: errorFieldsForSessionTypeError(error),
    };
  }

  revalidateSessionTypePaths();
  return { success: "Session type updated.", values };
}

export async function archiveSessionTypeAction(
  sessionTypeId: string,
  _prev: SessionTypeArchiveActionState,
  _formData: FormData
): Promise<SessionTypeArchiveActionState> {
  void _prev;
  void _formData;

  try {
    await archiveSessionType(sessionTypeId);
  } catch (error) {
    logSessionTypeActionError("archiveSessionType", error);
    return { errors: { _global: [messageForSessionTypeError(error)] } };
  }

  revalidateSessionTypePaths();
  return { success: "Session type archived." };
}

export async function unarchiveSessionTypeAction(
  sessionTypeId: string,
  _prev: SessionTypeArchiveActionState,
  _formData: FormData
): Promise<SessionTypeArchiveActionState> {
  void _prev;
  void _formData;

  try {
    await unarchiveSessionType(sessionTypeId);
  } catch (error) {
    logSessionTypeActionError("unarchiveSessionType", error);
    return { errors: { _global: [messageForSessionTypeError(error)] } };
  }

  revalidateSessionTypePaths();
  return { success: "Session type unarchived." };
}

function sessionTypeFormValues(formData: FormData): SessionTypeFormValues {
  return {
    departmentId: formValue(formData.get("departmentId")),
    name: formValue(formData.get("name")),
    calendarLabel: formValue(formData.get("calendarLabel")),
    calendarColor: formValue(formData.get("calendarColor")),
  };
}

function emptySessionTypeValues(): SessionTypeFormValues {
  return {
    departmentId: "",
    name: "",
    calendarLabel: "",
    calendarColor: "",
  };
}

function errorFieldsForSessionTypeError(
  error: unknown
): Partial<Record<string, string[]>> {
  if (error instanceof SessionTypeNameConflictError) {
    return { name: [error.message] };
  }
  if (error instanceof SessionTypeDepartmentNotFoundError) {
    return { departmentId: [error.message] };
  }
  return { _global: [messageForSessionTypeError(error)] };
}

function messageForSessionTypeError(error: unknown): string {
  if (
    error instanceof SessionTypeNameConflictError ||
    error instanceof SessionTypeDepartmentNotFoundError ||
    error instanceof SessionTypeNotFoundError
  ) {
    return error.message;
  }
  return SESSION_TYPE_ACTION_GENERIC_ERROR;
}

function revalidateSessionTypePaths(): void {
  revalidatePath("/session-types");
  revalidatePath("/packages");
  revalidatePath("/bookings/new");
  revalidatePath("/bookings/[bookingId]/edit", "page");
  revalidatePath("/calendar");
}

function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function logSessionTypeActionError(action: string, error: unknown): void {
  console.error(`[session-types] ${action} failed`, error);
}
