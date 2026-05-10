"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format, isValid, parse } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  value?: string;
  onChange: (value?: string) => void;
  placeholder?: string;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
}: DatePickerProps) {
  const selected = React.useMemo(() => parseIsoDate(value), [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "justify-start text-left font-normal",
            !selected && "text-text-muted",
            className
          )}
        >
          <CalendarIcon className="h-4 w-4" aria-hidden="true" />
          <span>{selected ? format(selected, "PPP") : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => onChange(date ? format(date, "yyyy-MM-dd") : undefined)}
          defaultMonth={selected}
        />
      </PopoverContent>
    </Popover>
  );
}

function parseIsoDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;

  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? parsed : undefined;
}
