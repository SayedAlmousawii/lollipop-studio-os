"use client";

import type { SessionConfigurationInputType } from "@prisma/client";
import { SessionConfigurationInputRenderer } from "./session-configuration-input-renderer";

export function SessionConfigurationPreview({
  name,
  inputType,
  options,
}: {
  name: string;
  inputType: SessionConfigurationInputType;
  options: { label: string; value: string; isActive: boolean }[];
}) {
  const activeOptions = options
    .filter((option) => option.isActive)
    .map((option) => ({ label: option.label, value: option.value }));

  return (
    <div className="rounded-[10px] border border-border bg-surface-soft p-4">
      <p className="text-sm font-medium text-text-primary">
        {name.trim() || "Configuration preview"}
      </p>
      <div className="mt-3">
        <SessionConfigurationInputRenderer
          inputType={inputType}
          options={activeOptions}
          mode="preview"
        />
      </div>
    </div>
  );
}
