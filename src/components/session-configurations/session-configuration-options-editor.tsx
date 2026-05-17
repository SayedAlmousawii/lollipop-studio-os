"use client";

import { ArrowDown, ArrowUp, Archive, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type SessionConfigurationOptionDraft = {
  id?: string;
  label: string;
  value: string;
  priceDelta: string;
  sortOrder: string;
  isActive: boolean;
};

export function SessionConfigurationOptionsEditor({
  options,
  onChange,
  showPriceDelta,
  disabled,
}: {
  options: SessionConfigurationOptionDraft[];
  onChange: (options: SessionConfigurationOptionDraft[]) => void;
  showPriceDelta: boolean;
  disabled: boolean;
}) {
  function updateOption(
    index: number,
    patch: Partial<SessionConfigurationOptionDraft>
  ) {
    onChange(
      options.map((option, optionIndex) =>
        optionIndex === index ? { ...option, ...patch } : option
      )
    );
  }

  function removeOption(index: number) {
    const option = options[index];
    if (!option) return;

    if (option.id) {
      updateOption(index, { isActive: false });
      return;
    }

    onChange(options.filter((_, optionIndex) => optionIndex !== index));
  }

  function moveOption(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= options.length) return;

    const next = [...options];
    const current = next[index];
    const target = next[targetIndex];
    if (!current || !target) return;

    next[index] = target;
    next[targetIndex] = current;
    onChange(
      next.map((option, optionIndex) => ({
        ...option,
        sortOrder: String((optionIndex + 1) * 10),
      }))
    );
  }

  return (
    <div className="space-y-3 rounded-[10px] border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Options</Label>
          <p className="mt-1 text-xs text-text-secondary">
            Existing options are archived on save when removed.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange([
              ...options,
              {
                label: "",
                value: "",
                priceDelta: "0",
                sortOrder: String((options.length + 1) * 10),
                isActive: true,
              },
            ])
          }
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Option
        </Button>
      </div>

      {options.length === 0 ? (
        <p className="rounded-md bg-surface-soft px-3 py-2 text-sm text-text-secondary">
          No options yet.
        </p>
      ) : (
        <div className="space-y-3">
          {options.map((option, index) => (
            <div
              key={option.id ?? `new-${index}`}
              className="grid gap-3 rounded-md border border-border bg-surface-soft p-3 md:grid-cols-[1.2fr_1fr_0.8fr_0.7fr_auto]"
            >
              <div className="space-y-1">
                <Label htmlFor={`option-label-${index}`}>Label</Label>
                <Input
                  id={`option-label-${index}`}
                  value={option.label}
                  disabled={disabled || !option.isActive}
                  onChange={(event) =>
                    updateOption(index, { label: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`option-value-${index}`}>Value</Label>
                <Input
                  id={`option-value-${index}`}
                  value={option.value}
                  disabled={disabled || !option.isActive}
                  onChange={(event) =>
                    updateOption(index, { value: event.target.value })
                  }
                />
              </div>
              {showPriceDelta ? (
                <div className="space-y-1">
                  <Label htmlFor={`option-price-${index}`}>KD</Label>
                  <Input
                    id={`option-price-${index}`}
                    type="number"
                    step="0.001"
                    value={option.priceDelta}
                    disabled={disabled || !option.isActive}
                    onChange={(event) =>
                      updateOption(index, { priceDelta: event.target.value })
                    }
                  />
                </div>
              ) : null}
              <div className="space-y-1">
                <Label htmlFor={`option-sort-${index}`}>Sort</Label>
                <Input
                  id={`option-sort-${index}`}
                  type="number"
                  value={option.sortOrder}
                  disabled={disabled || !option.isActive}
                  onChange={(event) =>
                    updateOption(index, { sortOrder: event.target.value })
                  }
                />
              </div>
              <div className="flex items-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || index === 0}
                  onClick={() => moveOption(index, -1)}
                  aria-label="Move option up"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || index === options.length - 1}
                  onClick={() => moveOption(index, 1)}
                  aria-label="Move option down"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  onClick={() => removeOption(index)}
                  aria-label={option.id ? "Archive option" : "Remove option"}
                >
                  {option.id ? (
                    <Archive className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
              {!option.isActive ? (
                <div className="md:col-span-5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => updateOption(index, { isActive: true })}
                  >
                    Reactivate option
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
