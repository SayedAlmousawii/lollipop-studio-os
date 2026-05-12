"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  createBooking,
  getBookingCustomerPhoneSuggestions,
  type ActionState,
} from "@/app/bookings/new/actions";
import type { RecommendedPhotographer } from "@/modules/bookings/booking.service";

const SESSION_TYPES = [
  { value: "NEWBORN", label: "Newborn" },
  { value: "KIDS", label: "Kids" },
  { value: "FAMILY", label: "Family" },
  { value: "MATERNITY", label: "Maternity" },
  { value: "OTHER", label: "Other" },
] as const;

type PhoneSuggestion = {
  id: string;
  name: string;
  phone: string;
};

interface NewBookingFormProps {
  packages: { id: string; name: string; price: string }[];
  photographers: { id: string; name: string }[];
  departments: { id: string; name: string; code: string }[];
  initialCustomerPhone?: string;
  recommendedPhotographer: RecommendedPhotographer;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} className="min-w-[140px]">
      {pending ? "Creating..." : "Create Booking"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p className="mt-1 text-xs text-(--color-destructive)">{messages[0]}</p>
  );
}

interface CustomerPhoneInputProps {
  error?: string[];
  nameError?: string[];
  initialCustomerPhone?: string;
}

function CustomerPhoneInput({
  error,
  nameError,
  initialCustomerPhone,
}: CustomerPhoneInputProps) {
  const [inputValue, setInputValue] = useState(initialCustomerPhone ?? "");
  const [selected, setSelected] = useState<PhoneSuggestion | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [suggestions, setSuggestions] = useState<PhoneSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [hasSuggestionResponse, setHasSuggestionResponse] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [, startSuggestionTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestTokenRef = useRef(0);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const numericQuery = inputValue.replace(/\D/g, "");
  const canFetchSuggestions = numericQuery.length >= 3;
  const isExistingCustomer = selected?.phone === inputValue;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        closeDropdown();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearPendingSuggestionRequest();
    };
  }, []);

  return (
    <div ref={containerRef} className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
        <Input
          id="phone"
          name="phone"
          ref={inputRef}
          type="search"
          inputMode="tel"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showDropdown}
          aria-activedescendant={
            highlightedIndex >= 0
              ? `${listboxId}-option-${suggestions[highlightedIndex]?.id}`
              : undefined
          }
          aria-invalid={error ? true : undefined}
          value={inputValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            const nextDigits = nextValue.replace(/\D/g, "");

            setInputValue(nextValue);
            setHasSuggestionResponse(false);

            if (selected && nextValue !== selected.phone) {
              setSelected(null);
              setCustomerName("");
            }

            if (!nextValue.trim()) {
              setSelected(null);
              setCustomerName("");
            }

            if (nextDigits.length < 3) {
              clearPendingSuggestionRequest();
              setSuggestions([]);
              setIsLoadingSuggestions(false);
              setHighlightedIndex(-1);
              setShowDropdown(false);
              return;
            }

            setShowDropdown(true);
            queueSuggestionFetch(nextValue);
          }}
          onFocus={() => {
            if (!canFetchSuggestions) {
              return;
            }

            if (
              isLoadingSuggestions ||
              suggestions.length > 0 ||
              hasSuggestionResponse
            ) {
              setShowDropdown(true);
              return;
            }

            queueSuggestionFetch(inputValue);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Search phone number..."
          autoComplete="off"
          required
          className="pl-9 pr-9"
        />
        {isLoadingSuggestions ? (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-secondary" />
        ) : null}
      </div>

      {showDropdown && canFetchSuggestions ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Customer phone suggestions"
          className="relative z-20 overflow-hidden rounded-[10px] border border-border bg-surface shadow-sm"
        >
          {suggestions.map((suggestion, index) => {
            const isHighlighted = index === highlightedIndex;

            return (
              <button
                key={suggestion.id}
                id={`${listboxId}-option-${suggestion.id}`}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors",
                  isHighlighted ? "bg-accent-soft" : "hover:bg-surface-soft"
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
              >
                <span className="text-sm font-medium tabular-nums text-text-primary">
                  {suggestion.phone}
                </span>
                <span className="text-xs text-text-secondary">
                  {suggestion.name}
                </span>
              </button>
            );
          })}

          {isLoadingSuggestions ? (
            <p className="px-3 py-2 text-sm text-text-secondary">Searching...</p>
          ) : null}

          {!isLoadingSuggestions &&
          hasSuggestionResponse &&
          suggestions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-secondary">No results</p>
          ) : null}
        </div>
      ) : null}

      <FieldError messages={error} />

      {isExistingCustomer ? (
        <div className="space-y-1.5">
          <Label htmlFor="existingCustomerName">Customer Name</Label>
          <Input
            id="existingCustomerName"
            value={selected.name}
            readOnly
            className="bg-surface-soft"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="customerName">Customer Name</Label>
          <Input
            id="customerName"
            name="customerName"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="Optional customer name"
            autoComplete="name"
          />
          <FieldError messages={nameError} />
        </div>
      )}
    </div>
  );

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      closeDropdown();
      return;
    }

    if (!showDropdown || suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        current >= suggestions.length - 1 ? 0 : current + 1
      );
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1
      );
    }

    if (event.key === "Enter" && highlightedIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[highlightedIndex]);
    }
  }

  function closeDropdown() {
    setShowDropdown(false);
    setHighlightedIndex(-1);
  }

  function selectSuggestion(suggestion: PhoneSuggestion) {
    clearPendingSuggestionRequest();
    setSelected(suggestion);
    setInputValue(suggestion.phone);
    setCustomerName(suggestion.name);
    setSuggestions([]);
    setIsLoadingSuggestions(false);
    setHasSuggestionResponse(false);
    closeDropdown();
    inputRef.current?.focus();
  }

  function clearPendingSuggestionRequest() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    requestTokenRef.current += 1;
  }

  function queueSuggestionFetch(query: string) {
    clearPendingSuggestionRequest();
    const requestToken = requestTokenRef.current;
    setIsLoadingSuggestions(true);

    debounceRef.current = setTimeout(() => {
      startSuggestionTransition(async () => {
        const data = await getBookingCustomerPhoneSuggestions(query);

        if (requestTokenRef.current !== requestToken) {
          return;
        }

        setSuggestions(data);
        setHighlightedIndex(data.length > 0 ? 0 : -1);
        setHasSuggestionResponse(true);
        setIsLoadingSuggestions(false);
        setShowDropdown(true);
      });
    }, 300);
  }
}

export function NewBookingForm({
  packages,
  photographers,
  departments,
  initialCustomerPhone,
  recommendedPhotographer,
}: NewBookingFormProps) {
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedSessionType, setSelectedSessionType] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [sessionTime, setSessionTime] = useState("");
  const [state, formAction] = useActionState<ActionState, FormData>(
    createBooking,
    {}
  );
  const createDisabled = departments.length === 0;

  return (
    <form action={formAction} className="space-y-6">
      {state.errors?._global && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-(--color-destructive)">
          {state.errors._global[0]}
        </p>
      )}

      {departments.length === 0 ? (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          An active department is required before this booking can be saved.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="phone">Customer Phone</Label>
        <CustomerPhoneInput
          error={state.errors?.phone}
          nameError={state.errors?.customerName}
          initialCustomerPhone={initialCustomerPhone}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="packageId">Package</Label>
        <select
          id="packageId"
          name="packageId"
          defaultValue=""
          className="flex h-10 w-full rounded-sm border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-0 disabled:opacity-50"
        >
          <option value="" disabled>
            Select a package...
          </option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} - {p.price}
            </option>
          ))}
        </select>
        <FieldError messages={state.errors?.packageId} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sessionDate">Session Date</Label>
        <input type="hidden" name="sessionDate" value={sessionDate} />
        <DatePicker
          value={sessionDate}
          onChange={(value) => setSessionDate(value ?? "")}
          placeholder="Select date"
          className="w-full"
        />
        <FieldError messages={state.errors?.sessionDate} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sessionTime">Session Time</Label>
        <input type="hidden" name="sessionTime" value={sessionTime} />
        <TimePicker
          id="sessionTime"
          value={sessionTime}
          onChange={(value) => setSessionTime(value ?? "")}
          placeholder="Select time"
          className="w-full"
        />
        <FieldError messages={state.errors?.sessionTime} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="departmentId">Department</Label>
        <input type="hidden" name="departmentId" value={selectedDepartmentId} />
        <Select
          value={selectedDepartmentId}
          onValueChange={setSelectedDepartmentId}
          disabled={departments.length === 0}
        >
          <SelectTrigger id="departmentId" className="w-full">
            <SelectValue placeholder="Select department..." />
          </SelectTrigger>
          <SelectContent>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={state.errors?.departmentId} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assignedPhotographerId">Assigned Photographer</Label>
        <select
          id="assignedPhotographerId"
          name="assignedPhotographerId"
          defaultValue={recommendedPhotographer?.id ?? ""}
          className="flex h-10 w-full rounded-sm border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-0 disabled:opacity-50"
        >
          <option value="">Unassigned</option>
          {photographers.map((photographer) => (
            <option key={photographer.id} value={photographer.id}>
              {photographer.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted">
          {initialCustomerPhone
            ? recommendedPhotographer
              ? `Recommended from session history: ${recommendedPhotographer.name}`
              : "No photographer history found"
            : "Select a customer from history to show a recommendation."}
        </p>
        <FieldError messages={state.errors?.assignedPhotographerId} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sessionType">Session Type</Label>
        <input type="hidden" name="sessionType" value={selectedSessionType} />
        <Select
          value={selectedSessionType}
          onValueChange={setSelectedSessionType}
        >
          <SelectTrigger id="sessionType" className="w-full">
            <SelectValue placeholder="Select session type..." />
          </SelectTrigger>
          <SelectContent>
            {SESSION_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={state.errors?.sessionType} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="themes">Themes</Label>
        <Textarea
          id="themes"
          name="themes"
          rows={3}
          placeholder="One theme per line or comma separated"
          className="resize-none"
        />
        <FieldError messages={state.errors?.themes} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          placeholder="Optional notes..."
          rows={3}
          className="w-full resize-none"
        />
        <FieldError messages={state.errors?.notes} />
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="outline" asChild>
          <Link href="/bookings">Cancel</Link>
        </Button>
        <SubmitButton disabled={createDisabled} />
      </div>
    </form>
  );
}
