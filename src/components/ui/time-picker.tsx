"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface TimePickerProps {
  id?: string;
  value?: string;
  onChange: (value?: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const HOURS = Array.from({ length: 11 }, (_, index) =>
  String(index + 12).padStart(2, "0")
);
const MINUTES = ["00", "15", "30", "45"];

export function TimePicker({
  id,
  value,
  onChange,
  placeholder = "Pick a time",
  className,
  disabled,
}: TimePickerProps) {
  const parsed = parseTime(value);
  const selectedHour = parsed?.hour ?? "12";
  const selectedMinute = parsed?.minute ?? "00";

  function updateTime(nextHour: string, nextMinute: string) {
    onChange(`${nextHour}:${nextMinute}`);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "justify-start text-left font-normal",
            !parsed && "text-text-muted",
            className
          )}
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
          <span>{parsed ? `${parsed.hour}:${parsed.minute}` : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-4" align="start">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase text-text-muted">Hour</p>
            <Select
              value={selectedHour}
              onValueChange={(hour) => updateTime(hour, selectedMinute)}
            >
              <SelectTrigger aria-label="Hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((hour) => (
                  <SelectItem key={hour} value={hour}>
                    {hour}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="pb-2 text-sm font-medium text-text-muted">:</span>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase text-text-muted">Minute</p>
            <Select
              value={selectedMinute}
              onValueChange={(minute) => updateTime(selectedHour, minute)}
            >
              <SelectTrigger aria-label="Minute">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MINUTES.map((minute) => (
                  <SelectItem key={minute} value={minute}>
                    {minute}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function parseTime(value: string | undefined):
  | {
      hour: string;
      minute: string;
    }
  | undefined {
  if (!value) return undefined;

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return undefined;

  return {
    hour: match[1],
    minute: match[2],
  };
}
