"use client";

import type { SessionConfigurationInputType } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SelectionInput } from "@/modules/session-configurations/session-configuration-selection.schema";

type RendererOption = {
  label: string;
  value: string;
};

type PreviewProps = {
  inputType: SessionConfigurationInputType;
  options?: RendererOption[];
  mode: "preview";
};

type EditProps = {
  inputType: SessionConfigurationInputType;
  options?: RendererOption[];
  mode: "edit";
  value: SelectionInput | null;
  onChange: (next: SelectionInput | null) => void;
  configurationId: string;
};

type Props = PreviewProps | EditProps;

export function SessionConfigurationInputRenderer(props: Props) {
  const { inputType, options = [], mode } = props;

  if (inputType === "TOGGLE") {
    if (mode === "edit") {
      return (
        <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={props.value?.kind === "toggle"}
            onChange={(event) =>
              props.onChange(
                event.currentTarget.checked
                  ? { configurationId: props.configurationId, kind: "toggle" }
                  : null
              )
            }
            className="h-4 w-4 rounded border-border"
          />
          Enabled
        </label>
      );
    }

    return (
      <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" disabled className="h-4 w-4 rounded border-border" />
        Enabled
      </label>
    );
  }

  if (inputType === "SELECT") {
    if (mode === "edit") {
      const selectedValue = props.value?.kind === "select" ? props.value.optionId : "";
      return (
        <select
          value={selectedValue}
          onChange={(event) =>
            props.onChange(
              event.currentTarget.value
                ? {
                    configurationId: props.configurationId,
                    kind: "select",
                    optionId: event.currentTarget.value,
                  }
                : null
            )
          }
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary"
        >
          <option value="">Select option</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <select
        disabled
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        <option>{options[0]?.label ?? "Select option"}</option>
      </select>
    );
  }

  if (inputType === "NUMBER") {
    if (mode === "edit") {
      return (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={props.value?.kind === "number" ? props.value.numericValue : ""}
          onChange={(event) => {
            const value = event.currentTarget.value;
            props.onChange(
              value === ""
                ? null
                : {
                    configurationId: props.configurationId,
                    kind: "number",
                    numericValue: Number(value),
                  }
            );
          }}
          placeholder="0"
        />
      );
    }

    return <Input type="number" disabled placeholder="0" />;
  }

  if (inputType === "COUNTER") {
    if (mode === "edit") {
      const currentValue =
        props.value?.kind === "counter" ? props.value.numericValue : 0;
      const currentOptionId =
        props.value?.kind === "counter" && "optionId" in props.value
          ? props.value.optionId ?? ""
          : "";
      const commitValue = (nextValue: number, optionId = currentOptionId) => {
        if (nextValue <= 0) {
          props.onChange(null);
          return;
        }
        props.onChange({
          configurationId: props.configurationId,
          kind: "counter",
          numericValue: nextValue,
          ...(optionId ? { optionId } : {}),
        });
      };

      return (
        <div className="space-y-2">
          <div className="inline-flex h-10 items-center rounded-md border border-border bg-background">
            <button
              type="button"
              onClick={() => commitValue(Math.max(currentValue - 1, 0))}
              className="h-10 w-10 text-text-secondary hover:bg-surface-soft"
            >
              -
            </button>
            <Input
              type="number"
              min="0"
              step="1"
              value={currentValue || ""}
              onChange={(event) =>
                commitValue(Number(event.currentTarget.value || 0))
              }
              className="h-10 w-16 rounded-none border-y-0 text-center"
            />
            <button
              type="button"
              onClick={() => commitValue(currentValue + 1)}
              className="h-10 w-10 text-text-secondary hover:bg-surface-soft"
            >
              +
            </button>
          </div>
          {options.length > 0 ? (
            <select
              value={currentOptionId}
              onChange={(event) => commitValue(currentValue, event.currentTarget.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text-primary"
            >
              <option value="">Select tier</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      );
    }

    return (
      <div className="inline-flex h-10 items-center rounded-md border border-border bg-background">
        <button type="button" disabled className="h-10 w-10 text-text-muted">
          -
        </button>
        <span className="w-10 text-center text-sm text-text-secondary">0</span>
        <button type="button" disabled className="h-10 w-10 text-text-muted">
          +
        </button>
      </div>
    );
  }

  if (mode === "edit") {
    return (
      <Textarea
        value={props.value?.kind === "text" ? props.value.textValue : ""}
        onChange={(event) => {
          const value = event.currentTarget.value;
          props.onChange(
            value.trim()
              ? {
                  configurationId: props.configurationId,
                  kind: "text",
                  textValue: value,
                }
              : null
          );
        }}
        maxLength={500}
        placeholder="Text value"
      />
    );
  }

  return <Input disabled placeholder="Text value" />;
}
