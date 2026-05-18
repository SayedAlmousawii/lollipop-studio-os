"use client";

import {
  SessionConfigurationCounterPricingMode,
  SessionConfigurationFinancialBehavior,
  SessionConfigurationInputType,
  SessionConfigurationLinkProductDisplay,
  SessionConfigurationPricingMode,
} from "@prisma/client";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createSessionConfigurationAction,
  updateSessionConfigurationAction,
  type SessionConfigurationActionState,
  type SessionConfigurationFormValues,
} from "@/app/session-configurations/actions";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  SessionConfigurationDetail,
  SessionConfigurationProductOption,
  SessionConfigurationSessionTypeOption,
} from "@/modules/session-configurations/session-configuration.types";
import {
  SessionConfigurationOptionsEditor,
  type SessionConfigurationOptionDraft,
} from "./session-configuration-options-editor";
import { SessionConfigurationPreview } from "./session-configuration-preview";

interface SessionConfigurationCreateFormProps {
  mode: "create";
  sessionTypes: SessionConfigurationSessionTypeOption[];
  products: SessionConfigurationProductOption[];
  configuration?: never;
}

interface SessionConfigurationEditFormProps {
  mode: "edit";
  sessionTypes: SessionConfigurationSessionTypeOption[];
  products: SessionConfigurationProductOption[];
  configuration: SessionConfigurationDetail;
}

type SessionConfigurationFormProps =
  | SessionConfigurationCreateFormProps
  | SessionConfigurationEditFormProps;

const inputTypes = Object.values(SessionConfigurationInputType);
const pricingModes = Object.values(SessionConfigurationPricingMode);
const financialBehaviors = Object.values(SessionConfigurationFinancialBehavior);

export function SessionConfigurationForm({
  mode,
  sessionTypes,
  products,
  configuration,
}: SessionConfigurationFormProps) {
  const defaultValues =
    mode === "edit" ? valuesFromConfiguration(configuration) : emptyValues();
  const action =
    mode === "edit"
      ? updateSessionConfigurationAction.bind(null, configuration.id)
      : createSessionConfigurationAction;
  const [state, formAction] = useActionState<
    SessionConfigurationActionState,
    FormData
  >(action, { values: defaultValues });
  const [values, setValues] = useState(defaultValues);
  const [options, setOptions] = useState<SessionConfigurationOptionDraft[]>(
    optionsFromValues(defaultValues)
  );
  const shouldSubmitOptions =
    values.inputType === SessionConfigurationInputType.SELECT ||
    values.pricingMode === SessionConfigurationPricingMode.TIERED ||
    (values.inputType === SessionConfigurationInputType.COUNTER &&
      values.counterPricingMode ===
        SessionConfigurationCounterPricingMode.TIERED);

  const productOptions = useMemo(() => {
    if (
      mode === "edit" &&
      configuration.linkedProductId &&
      configuration.linkedProductName &&
      !products.some((product) => product.id === configuration.linkedProductId)
    ) {
      return [
        ...products,
        {
          id: configuration.linkedProductId,
          name: `${configuration.linkedProductName} (archived)`,
        },
      ];
    }

    return products;
  }, [configuration, mode, products]);

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

      <SessionConfigurationFields
        mode={mode}
        state={state}
        values={values}
        options={options}
        sessionTypes={sessionTypes}
        products={productOptions}
        configuration={configuration}
        onValueChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        onOptionsChange={setOptions}
      />

      <input
        type="hidden"
        name="options"
        value={JSON.stringify(
          shouldSubmitOptions ? options.map(optionPayload) : []
        )}
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

function SessionConfigurationFields({
  mode,
  state,
  values,
  options,
  sessionTypes,
  products,
  configuration,
  onValueChange,
  onOptionsChange,
}: {
  mode: "create" | "edit";
  state: SessionConfigurationActionState;
  values: SessionConfigurationFormValues;
  options: SessionConfigurationOptionDraft[];
  sessionTypes: SessionConfigurationSessionTypeOption[];
  products: SessionConfigurationProductOption[];
  configuration?: SessionConfigurationDetail;
  onValueChange: (patch: Partial<SessionConfigurationFormValues>) => void;
  onOptionsChange: (options: SessionConfigurationOptionDraft[]) => void;
}) {
  const { pending } = useFormStatus();
  const inputType = values.inputType as SessionConfigurationInputType;
  const pricingMode = values.pricingMode as SessionConfigurationPricingMode;
  const showOptions =
    inputType === SessionConfigurationInputType.SELECT ||
    pricingMode === SessionConfigurationPricingMode.TIERED ||
    (inputType === SessionConfigurationInputType.COUNTER &&
      values.counterPricingMode ===
        SessionConfigurationCounterPricingMode.TIERED);
  const showOptionPrices = pricingMode !== SessionConfigurationPricingMode.NONE;

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="session-configuration-session-type">
            Session type *
          </Label>
          {mode === "create" ? (
            <select
              id="session-configuration-session-type"
              name="sessionTypeId"
              value={values.sessionTypeId}
              disabled={pending}
              onChange={(event) =>
                onValueChange({ sessionTypeId: event.target.value })
              }
              aria-invalid={state.errors?.sessionTypeId?.length ? true : undefined}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              required
            >
              <option value="">Select session type...</option>
              {sessionTypes.map((sessionType) => (
                <option key={sessionType.id} value={sessionType.id}>
                  {sessionType.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                type="hidden"
                name="sessionTypeId"
                value={configuration?.sessionTypeId ?? ""}
              />
              <div className="flex h-10 items-center rounded-md border border-border bg-surface-soft px-3 text-sm text-text-secondary">
                {configuration?.sessionTypeName}
              </div>
            </>
          )}
          <FieldError messages={state.errors?.sessionTypeId} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="session-configuration-name">Name *</Label>
          <Input
            id="session-configuration-name"
            name="name"
            value={values.name}
            disabled={pending}
            aria-invalid={state.errors?.name?.length ? true : undefined}
            placeholder="Twins"
            onChange={(event) => onValueChange({ name: event.target.value })}
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
              {configuration?.code}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <SelectField
          id="session-configuration-input-type"
          name="inputType"
          label="Input type *"
          value={values.inputType}
          options={inputTypes}
          disabled={pending}
          error={state.errors?.inputType}
          onChange={(inputValue) => onValueChange({ inputType: inputValue })}
        />
        <SelectField
          id="session-configuration-pricing-mode"
          name="pricingMode"
          label="Pricing mode *"
          value={values.pricingMode}
          options={pricingModes}
          disabled={pending}
          error={state.errors?.pricingMode}
          onChange={(pricingValue) =>
            onValueChange({ pricingMode: pricingValue })
          }
        />
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <SelectField
          id="session-configuration-financial-behavior"
          name="financialBehavior"
          label="Financial behavior *"
          value={values.financialBehavior}
          options={financialBehaviors}
          disabled={pending}
          error={state.errors?.financialBehavior}
          onChange={(behavior) => onValueChange({ financialBehavior: behavior })}
        />
        <div className="space-y-2">
          <Label htmlFor="session-configuration-sort">Sort order</Label>
          <Input
            id="session-configuration-sort"
            name="sortOrder"
            type="number"
            value={values.sortOrder}
            disabled={pending}
            onChange={(event) => onValueChange({ sortOrder: event.target.value })}
          />
          <FieldError messages={state.errors?.sortOrder} />
        </div>
        <label className="flex items-center gap-2 pt-8 text-sm text-text-secondary">
          <input
            type="checkbox"
            name="required"
            checked={values.required}
            disabled={pending}
            onChange={(event) => onValueChange({ required: event.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          Required
        </label>
      </div>

      {pricingMode === SessionConfigurationPricingMode.FIXED ? (
        <div className="space-y-2">
          <Label htmlFor="session-configuration-fixed-price">
            Fixed price delta (KD) *
          </Label>
          <Input
            id="session-configuration-fixed-price"
            name="fixedPriceDelta"
            type="number"
            step="0.001"
            value={values.fixedPriceDelta}
            disabled={pending}
            onChange={(event) =>
              onValueChange({ fixedPriceDelta: event.target.value })
            }
          />
          <FieldError messages={state.errors?.fixedPriceDelta} />
        </div>
      ) : (
        <input type="hidden" name="fixedPriceDelta" value="" />
      )}

      {pricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT ? (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="session-configuration-product">
              Linked product *
            </Label>
            <select
              id="session-configuration-product"
              name="linkedProductId"
              value={values.linkedProductId}
              disabled={pending}
              onChange={(event) =>
                onValueChange({ linkedProductId: event.target.value })
              }
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select product...</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            <FieldError messages={state.errors?.linkedProductId} />
          </div>
          <div className="space-y-2">
            <Label>Product display</Label>
            <input
              type="hidden"
              name="linkProductDisplay"
              value={SessionConfigurationLinkProductDisplay.LINE_ITEM}
            />
            <div className="flex h-10 items-center rounded-md border border-border bg-surface-soft px-3 text-sm text-text-secondary">
              Line item
            </div>
            <p className="text-xs text-text-secondary">
              Linked products are added to the invoice as line items.
            </p>
            <FieldError messages={state.errors?.linkProductDisplay} />
          </div>
        </div>
      ) : (
        <>
          <input type="hidden" name="linkedProductId" value="" />
          <input type="hidden" name="linkProductDisplay" value="" />
        </>
      )}

      {inputType === SessionConfigurationInputType.COUNTER &&
      pricingMode !== SessionConfigurationPricingMode.NONE ? (
        <div className="grid gap-5 md:grid-cols-2">
          <SelectField
            id="session-configuration-counter-mode"
            name="counterPricingMode"
            label="Counter pricing *"
            value={values.counterPricingMode}
            options={Object.values(SessionConfigurationCounterPricingMode)}
            disabled={pending}
            error={state.errors?.counterPricingMode}
            onChange={(counterMode) =>
              onValueChange({ counterPricingMode: counterMode })
            }
          />
          {values.counterPricingMode ===
          SessionConfigurationCounterPricingMode.PER_UNIT ? (
            <div className="space-y-2">
              <Label htmlFor="session-configuration-counter-price">
                Unit price (KD) *
              </Label>
              <Input
                id="session-configuration-counter-price"
                name="counterUnitPrice"
                type="number"
                step="0.001"
                value={values.counterUnitPrice}
                disabled={pending}
                onChange={(event) =>
                  onValueChange({ counterUnitPrice: event.target.value })
                }
              />
              <FieldError messages={state.errors?.counterUnitPrice} />
            </div>
          ) : (
            <input type="hidden" name="counterUnitPrice" value="" />
          )}
        </div>
      ) : (
        <>
          <input type="hidden" name="counterPricingMode" value="" />
          <input type="hidden" name="counterUnitPrice" value="" />
        </>
      )}

      {showOptions ? (
        <>
          <SessionConfigurationOptionsEditor
            options={options}
            onChange={onOptionsChange}
            showPriceDelta={showOptionPrices}
            disabled={pending}
          />
          <FieldError messages={state.errors?.options} />
        </>
      ) : null}

      <SessionConfigurationPreview
        name={values.name}
        inputType={inputType}
        options={options}
      />
    </>
  );
}

function SelectField({
  id,
  name,
  label,
  value,
  options,
  disabled,
  error,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  error?: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        aria-invalid={error?.length ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labelForEnum(option)}
          </option>
        ))}
      </select>
      <FieldError messages={error} />
    </div>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label = mode === "edit" ? "Save Changes" : "Create Configuration";
  const pendingLabel = mode === "edit" ? "Saving..." : "Creating...";

  return (
    <Button type="submit" disabled={pending} className="min-w-[180px]">
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-danger">{messages[0]}</p>;
}

function valuesFromConfiguration(
  configuration: SessionConfigurationDetail
): SessionConfigurationFormValues {
  return {
    sessionTypeId: configuration.sessionTypeId,
    name: configuration.name,
    inputType: configuration.inputType,
    pricingMode: configuration.pricingMode,
    financialBehavior: configuration.financialBehavior,
    required: configuration.required,
    sortOrder: String(configuration.sortOrder),
    fixedPriceDelta:
      configuration.fixedPriceDelta === null
        ? ""
        : configuration.fixedPriceDelta.toFixed(3),
    linkedProductId: configuration.linkedProductId ?? "",
    linkProductDisplay:
      configuration.pricingMode === SessionConfigurationPricingMode.LINKED_PRODUCT
        ? SessionConfigurationLinkProductDisplay.LINE_ITEM
        : configuration.linkProductDisplay ?? "",
    counterPricingMode: configuration.counterPricingMode ?? "",
    counterUnitPrice:
      configuration.counterUnitPrice === null
        ? ""
        : configuration.counterUnitPrice.toFixed(3),
    options: configuration.options.map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
      priceDelta: option.priceDelta.toFixed(3),
      sortOrder: String(option.sortOrder),
      isActive: option.isActive,
    })),
  };
}

function emptyValues(): SessionConfigurationFormValues {
  return {
    sessionTypeId: "",
    name: "",
    inputType: SessionConfigurationInputType.TOGGLE,
    pricingMode: SessionConfigurationPricingMode.NONE,
    financialBehavior: SessionConfigurationFinancialBehavior.OPERATIONAL,
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

function optionsFromValues(
  values: SessionConfigurationFormValues
): SessionConfigurationOptionDraft[] {
  return values.options.flatMap((rawOption) => {
    if (!isOptionRecord(rawOption)) return [];
    return [
      {
        id:
          typeof rawOption.id === "string" && rawOption.id.trim()
            ? rawOption.id
            : undefined,
        label: typeof rawOption.label === "string" ? rawOption.label : "",
        value: typeof rawOption.value === "string" ? rawOption.value : "",
        priceDelta:
          typeof rawOption.priceDelta === "string"
            ? rawOption.priceDelta
            : String(rawOption.priceDelta ?? "0"),
        sortOrder:
          typeof rawOption.sortOrder === "string"
            ? rawOption.sortOrder
            : String(rawOption.sortOrder ?? "0"),
        isActive:
          typeof rawOption.isActive === "boolean" ? rawOption.isActive : true,
      },
    ];
  });
}

function optionPayload(option: SessionConfigurationOptionDraft) {
  return {
    ...(option.id ? { id: option.id } : {}),
    label: option.label,
    value: option.value,
    priceDelta: option.priceDelta,
    sortOrder: option.sortOrder,
    isActive: option.isActive,
  };
}

function isOptionRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function labelForEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
