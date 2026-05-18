"use server";

import { revalidatePath } from "next/cache";
import {
  archiveSessionConfiguration,
  createSessionConfiguration,
  SessionConfigurationCodeConflictError,
  SessionConfigurationLinkedProductNotFoundError,
  SessionConfigurationNotFoundError,
  SessionConfigurationSessionTypeNotFoundError,
  SessionConfigurationValidationError,
  unarchiveSessionConfiguration,
  updateSessionConfiguration,
} from "@/modules/session-configurations/session-configuration.service";
import { resetSessionConfigurationTestData } from "@/modules/session-configurations/session-configuration-reset.service";
import { PERMISSIONS, requireCurrentAppUserPermission } from "@/lib/permissions";
import {
  createSessionConfigurationSchema,
  updateSessionConfigurationSchema,
} from "@/modules/session-configurations/session-configuration.schema";

export type SessionConfigurationActionState = {
  errors?: Partial<Record<string, string[]>>;
  values?: SessionConfigurationFormValues;
  success?: string;
};

export type SessionConfigurationArchiveActionState = {
  errors?: Partial<Record<string, string[]>>;
  success?: string;
};

export type ResetSessionConfigurationsActionState = {
  message?: string;
  error?: string;
  token?: number;
};

export type SessionConfigurationFormValues = {
  sessionTypeId: string;
  name: string;
  inputType: string;
  pricingMode: string;
  financialBehavior: string;
  required: boolean;
  sortOrder: string;
  fixedPriceDelta: string;
  linkedProductId: string;
  linkProductDisplay: string;
  counterPricingMode: string;
  counterUnitPrice: string;
  options: unknown[];
};

const SESSION_CONFIGURATION_ACTION_GENERIC_ERROR =
  "An unexpected error occurred while processing the session configuration.";

export async function createSessionConfigurationAction(
  _prev: SessionConfigurationActionState,
  formData: FormData
): Promise<SessionConfigurationActionState> {
  const valuesResult = safeSessionConfigurationFormValues(formData);
  if (!valuesResult.success) {
    return { errors: { options: [valuesResult.message] } };
  }
  const values = valuesResult.values;
  const parsed = createSessionConfigurationSchema.safeParse({
    sessionTypeId: values.sessionTypeId,
    ...sessionConfigurationPayload(values),
  });

  if (!parsed.success) {
    return { values, errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createSessionConfiguration(parsed.data);
  } catch (error) {
    logSessionConfigurationActionError("createSessionConfiguration", error);
    return { values, errors: errorFieldsForSessionConfigurationError(error) };
  }

  revalidateSessionConfigurationPaths();
  return {
    success: "Session configuration created.",
    values: emptySessionConfigurationValues(),
  };
}

export async function updateSessionConfigurationAction(
  configurationId: string,
  _prev: SessionConfigurationActionState,
  formData: FormData
): Promise<SessionConfigurationActionState> {
  const valuesResult = safeSessionConfigurationFormValues(formData);
  if (!valuesResult.success) {
    return { errors: { options: [valuesResult.message] } };
  }
  const values = valuesResult.values;
  const parsed = updateSessionConfigurationSchema.safeParse({
    ...sessionConfigurationPayload(values),
  });

  if (!parsed.success) {
    return { values, errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateSessionConfiguration(configurationId, parsed.data);
  } catch (error) {
    logSessionConfigurationActionError("updateSessionConfiguration", error);
    return { values, errors: errorFieldsForSessionConfigurationError(error) };
  }

  revalidateSessionConfigurationPaths();
  return { success: "Session configuration updated.", values };
}

export async function archiveSessionConfigurationAction(
  configurationId: string,
  _prev: SessionConfigurationArchiveActionState,
  _formData: FormData
): Promise<SessionConfigurationArchiveActionState> {
  void _prev;
  void _formData;

  try {
    await archiveSessionConfiguration(configurationId);
  } catch (error) {
    logSessionConfigurationActionError("archiveSessionConfiguration", error);
    return {
      errors: { _global: [messageForSessionConfigurationError(error)] },
    };
  }

  revalidateSessionConfigurationPaths();
  return { success: "Session configuration archived." };
}

export async function unarchiveSessionConfigurationAction(
  configurationId: string,
  _prev: SessionConfigurationArchiveActionState,
  _formData: FormData
): Promise<SessionConfigurationArchiveActionState> {
  void _prev;
  void _formData;

  try {
    await unarchiveSessionConfiguration(configurationId);
  } catch (error) {
    logSessionConfigurationActionError("unarchiveSessionConfiguration", error);
    return {
      errors: { _global: [messageForSessionConfigurationError(error)] },
    };
  }

  revalidateSessionConfigurationPaths();
  return { success: "Session configuration unarchived." };
}

export async function resetSessionConfigurationsAction(
  _prev: ResetSessionConfigurationsActionState,
  _formData: FormData
): Promise<ResetSessionConfigurationsActionState> {
  void _prev;
  void _formData;

  try {
    await requireCurrentAppUserPermission(PERMISSIONS.PACKAGE_CATALOG_MANAGE);
    await resetSessionConfigurationTestData();
  } catch (error) {
    logSessionConfigurationActionError("resetSessionConfigurations", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to reset session configuration test data.",
      token: Date.now(),
    };
  }

  revalidateSessionConfigurationPaths();
  revalidatePath("/orders");

  return {
    message: "Session configurations reset.",
    token: Date.now(),
  };
}

function sessionConfigurationFormValues(
  formData: FormData
): SessionConfigurationFormValues {
  return {
    sessionTypeId: formValue(formData.get("sessionTypeId")),
    name: formValue(formData.get("name")),
    inputType: formValue(formData.get("inputType")),
    pricingMode: formValue(formData.get("pricingMode")),
    financialBehavior: formValue(formData.get("financialBehavior")),
    required: formData.get("required") === "on",
    sortOrder: formValue(formData.get("sortOrder")),
    fixedPriceDelta: formValue(formData.get("fixedPriceDelta")),
    linkedProductId: formValue(formData.get("linkedProductId")),
    linkProductDisplay: formValue(formData.get("linkProductDisplay")),
    counterPricingMode: formValue(formData.get("counterPricingMode")),
    counterUnitPrice: formValue(formData.get("counterUnitPrice")),
    options: parseOptions(formValue(formData.get("options"))),
  };
}

function parseOptions(value: string): unknown[] {
  if (!value.trim()) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Invalid options JSON: ${value}`);
    }
    throw error;
  }
}

function safeSessionConfigurationFormValues(
  formData: FormData
):
  | { success: true; values: SessionConfigurationFormValues }
  | { success: false; message: string } {
  try {
    return { success: true, values: sessionConfigurationFormValues(formData) };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Invalid options JSON.",
    };
  }
}

function emptySessionConfigurationValues(): SessionConfigurationFormValues {
  return {
    sessionTypeId: "",
    name: "",
    inputType: "TOGGLE",
    pricingMode: "NONE",
    financialBehavior: "OPERATIONAL",
    required: false,
    sortOrder: "0",
    fixedPriceDelta: "",
    linkedProductId: "",
    linkProductDisplay: "",
    counterPricingMode: "",
    counterUnitPrice: "",
    options: [],
  };
}

function sessionConfigurationPayload(values: SessionConfigurationFormValues) {
  return {
    name: values.name,
    inputType: values.inputType,
    pricingMode: values.pricingMode,
    financialBehavior: values.financialBehavior,
    required: values.required,
    sortOrder: values.sortOrder,
    fixedPriceDelta: values.fixedPriceDelta,
    linkedProductId: values.linkedProductId,
    linkProductDisplay: values.linkProductDisplay || undefined,
    counterPricingMode: values.counterPricingMode || undefined,
    counterUnitPrice: values.counterUnitPrice,
    options: values.options,
  };
}

function errorFieldsForSessionConfigurationError(
  error: unknown
): Partial<Record<string, string[]>> {
  if (error instanceof SessionConfigurationCodeConflictError) {
    return { name: [error.message] };
  }
  if (error instanceof SessionConfigurationSessionTypeNotFoundError) {
    return { sessionTypeId: [error.message] };
  }
  if (error instanceof SessionConfigurationLinkedProductNotFoundError) {
    return { linkedProductId: [error.message] };
  }
  if (error instanceof SessionConfigurationValidationError) {
    return { _global: [error.message] };
  }
  return { _global: [messageForSessionConfigurationError(error)] };
}

function messageForSessionConfigurationError(error: unknown): string {
  if (
    error instanceof SessionConfigurationCodeConflictError ||
    error instanceof SessionConfigurationSessionTypeNotFoundError ||
    error instanceof SessionConfigurationLinkedProductNotFoundError ||
    error instanceof SessionConfigurationNotFoundError ||
    error instanceof SessionConfigurationValidationError
  ) {
    return error.message;
  }
  return SESSION_CONFIGURATION_ACTION_GENERIC_ERROR;
}

function revalidateSessionConfigurationPaths(): void {
  revalidatePath("/session-configurations");
}

function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function logSessionConfigurationActionError(action: string, error: unknown): void {
  console.error(`[session-configurations] ${action} failed`, error);
}
