"use client";

import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type MultiSelectOption = {
  value: string;
  label: string;
};

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
  className?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select options",
  searchable = true,
  className,
}: MultiSelectProps) {
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const selectedOptions = options.filter((option) => selectedSet.has(option.value));

  function toggleValue(value: string) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }

    onChange([...selected, value]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className={cn("w-56 justify-between", className)}
        >
          <span className={cn("truncate", selectedOptions.length === 0 && "text-text-muted")}>
            {formatSummary(selectedOptions, placeholder)}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 border-border bg-surface p-0" align="start">
        <Command>
          {searchable ? <CommandInput placeholder="Search types..." /> : null}
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedSet.has(option.value);

                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => toggleValue(option.value)}
                  >
                    <Checkbox
                      checked={isSelected}
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                    <span>{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function formatSummary(
  selectedOptions: MultiSelectOption[],
  placeholder: string
): string {
  if (selectedOptions.length === 0) {
    return placeholder;
  }

  if (selectedOptions.length === 1) {
    return selectedOptions[0].label;
  }

  const visible = selectedOptions.slice(0, 2).map((option) => option.label);
  const remaining = selectedOptions.length - visible.length;

  return remaining > 0 ? `${visible.join(", ")} +${remaining}` : visible.join(", ");
}
