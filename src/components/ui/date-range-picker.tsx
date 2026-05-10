"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format, isValid, parse } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DateRangeValue = {
  from?: string;
  to?: string;
};

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  placeholder?: string;
  className?: string;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Pick a date range",
  className,
}: DateRangePickerProps) {
  const selected = React.useMemo<DateRange | undefined>(() => {
    const from = parseIsoDate(value.from);
    const to = parseIsoDate(value.to);

    if (!from && !to) return undefined;
    if (!from) return { from: to, to };
    if (!to) return { from };
    return { from, to };
  }, [value.from, value.to]);

  function handleSelect(range: DateRange | undefined) {
    onChange({
      from: range?.from ? format(range.from, "yyyy-MM-dd") : undefined,
      to: range?.to ? format(range.to, "yyyy-MM-dd") : undefined,
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-[300px] justify-start text-left font-normal",
            !selected?.from && "text-text-muted",
            className
          )}
        >
          <CalendarIcon className="h-4 w-4" aria-hidden="true" />
          <span>
            {selected?.from
              ? selected.to
                ? `${format(selected.from, "PPP")} - ${format(selected.to, "PPP")}`
                : format(selected.from, "PPP")
              : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={selected}
          onSelect={handleSelect}
          defaultMonth={selected?.from ?? selected?.to}
          numberOfMonths={2}
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
