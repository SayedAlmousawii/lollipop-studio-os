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
  hourOptions?: string[];
  minuteOptions?: string[];
  hourFormat?: "24" | "12";
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
  hourOptions = HOURS,
  minuteOptions = MINUTES,
  hourFormat = "24",
}: TimePickerProps) {
  const parsed = parseTime(value);
  const selectedHour = parsed?.hour ?? hourOptions[0] ?? "00";
  const selectedMinute = parsed?.minute ?? minuteOptions[0] ?? "00";
  const selectedPeriod = Number(selectedHour) >= 12 ? "PM" : "AM";
  const selectedDisplayHour =
    hourFormat === "12" ? toDisplayHour(selectedHour) : selectedHour;
  const displayHourOptions =
    hourFormat === "12"
      ? Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"))
      : hourOptions;

  function updateTime(nextHour: string, nextMinute: string) {
    onChange(`${nextHour}:${nextMinute}`);
  }

  function updateDisplayHour(nextDisplayHour: string) {
    if (hourFormat === "12") {
      updateTime(convertDisplayHour(nextDisplayHour, selectedPeriod), selectedMinute);
      return;
    }

    updateTime(nextDisplayHour, selectedMinute);
  }

  function updatePeriod(nextPeriod: string) {
    onChange(`${convertDisplayHour(selectedDisplayHour, nextPeriod)}:${selectedMinute}`);
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
          <span>{parsed ? formatDisplayTime(parsed.hour, parsed.minute, hourFormat) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-4" align="start">
        <div
          className={cn(
            "grid items-end gap-3",
            hourFormat === "12"
              ? "grid-cols-[1fr_auto_1fr_1fr]"
              : "grid-cols-[1fr_auto_1fr]"
          )}
        >
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase text-text-muted">Hour</p>
            <Select
              value={selectedDisplayHour}
              onValueChange={updateDisplayHour}
            >
              <SelectTrigger aria-label="Hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {displayHourOptions.map((hour) => (
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
              <SelectContent className="max-h-64">
                {minuteOptions.map((minute) => (
                  <SelectItem key={minute} value={minute}>
                    {minute}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hourFormat === "12" ? (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase text-text-muted">Period</p>
              <Select value={selectedPeriod} onValueChange={updatePeriod}>
                <SelectTrigger aria-label="Period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="AM">AM</SelectItem>
                  <SelectItem value="PM">PM</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
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

function formatDisplayTime(
  hour: string,
  minute: string,
  hourFormat: TimePickerProps["hourFormat"]
): string {
  if (hourFormat !== "12") return `${hour}:${minute}`;

  return `${formatHourOption(hour, "12")}:${minute} ${Number(hour) >= 12 ? "PM" : "AM"}`;
}

function formatHourOption(
  hour: string,
  hourFormat: TimePickerProps["hourFormat"]
): string {
  if (hourFormat !== "12") return hour;

  const numericHour = Number(hour);
  const displayHour = numericHour % 12 || 12;
  return String(displayHour).padStart(2, "0");
}

function toDisplayHour(hour: string): string {
  const numericHour = Number(hour);
  const displayHour = numericHour % 12 || 12;
  return String(displayHour).padStart(2, "0");
}

function convertDisplayHour(displayHour: string, period: string): string {
  const numericHour = Number(displayHour);
  const normalizedHour =
    period === "PM" ? (numericHour % 12) + 12 : numericHour % 12;

  return String(normalizedHour).padStart(2, "0");
}
