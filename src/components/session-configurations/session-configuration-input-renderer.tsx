"use client";

import type { SessionConfigurationInputType } from "@prisma/client";
import { Input } from "@/components/ui/input";

type RendererOption = {
  label: string;
  value: string;
};

export function SessionConfigurationInputRenderer({
  inputType,
  options = [],
  mode,
}: {
  inputType: SessionConfigurationInputType;
  options?: RendererOption[];
  mode: "preview";
}) {
  void mode;

  if (inputType === "TOGGLE") {
    return (
      <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" disabled className="h-4 w-4 rounded border-border" />
        Enabled
      </label>
    );
  }

  if (inputType === "SELECT") {
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
    return <Input type="number" disabled placeholder="0" />;
  }

  if (inputType === "COUNTER") {
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

  return <Input disabled placeholder="Text value" />;
}
