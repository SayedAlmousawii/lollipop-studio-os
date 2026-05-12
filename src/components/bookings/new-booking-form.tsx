"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowDown, ArrowUp, Loader2, Plus, Search, Trash2 } from "lucide-react";
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

type PhoneSuggestion = {
  id: string;
  name: string;
  phone: string;
};

interface NewBookingFormProps {
  packages: PackagePickerOption[];
  photographers: { id: string; name: string }[];
  departments: { id: string; name: string; code: string }[];
  initialCustomerPhone?: string;
  recommendedPhotographer: RecommendedPhotographer;
}

export type PackagePickerOption = {
  id: string;
  name: string;
  price: string;
  durationMinutes: number;
  departmentId: string;
  departmentName: string;
  sessionTypeId: string;
  sessionTypeName: string;
  packageFamilyId: string;
  packageFamilyName: string;
};

export type SelectedPackageLine = {
  packageId: string;
  quantity: number;
};

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

export function PackageLinesField({
  packages,
  selectedPackages,
  setSelectedPackages,
  errors,
}: {
  packages: PackagePickerOption[];
  selectedPackages: SelectedPackageLine[];
  setSelectedPackages: Dispatch<SetStateAction<SelectedPackageLine[]>>;
  errors?: string[];
}) {
  const [pickerDepartmentId, setPickerDepartmentId] = useState("");
  const [pickerSessionTypeId, setPickerSessionTypeId] = useState("");
  const [pickerFamilyId, setPickerFamilyId] = useState("");
  const [pickerPackageId, setPickerPackageId] = useState("");
  const departments = uniqueOptions(packages, "departmentId", "departmentName");
  const sessionTypes = uniqueOptions(
    packages.filter((pkg) => pkg.departmentId === pickerDepartmentId),
    "sessionTypeId",
    "sessionTypeName"
  );
  const families = uniqueOptions(
    packages.filter((pkg) => pkg.sessionTypeId === pickerSessionTypeId),
    "packageFamilyId",
    "packageFamilyName"
  );
  const packageOptions = packages.filter(
    (pkg) => pkg.packageFamilyId === pickerFamilyId
  );
  const totalMinutes = selectedPackages.reduce((total, line) => {
    const pkg = packages.find((item) => item.id === line.packageId);
    return total + (pkg?.durationMinutes ?? 0) * line.quantity;
  }, 0);

  return (
    <div className="space-y-3">
      <div>
        <Label>Packages</Label>
        <div className="mt-2 space-y-2">
          {selectedPackages.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-text-secondary">
              No packages selected.
            </p>
          ) : (
            selectedPackages.map((line, index) => {
              const pkg = packages.find((item) => item.id === line.packageId);
              if (!pkg) return null;

              return (
                <div
                  key={`${line.packageId}-${index}`}
                  className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_96px_auto]"
                >
                  <input type="hidden" name="packageIds" value={line.packageId} />
                  <input
                    type="hidden"
                    name="packageQuantities"
                    value={line.quantity}
                  />
                  <input type="hidden" name="packageSortOrders" value={index} />
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {pkg.name} · {pkg.price}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {pkg.departmentName} · {pkg.sessionTypeName} ·{" "}
                      {pkg.packageFamilyName} · {pkg.durationMinutes * line.quantity} min
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`package-quantity-${index}`}>Qty</Label>
                    <Input
                      id={`package-quantity-${index}`}
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(event) =>
                        setSelectedPackages((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  quantity: Math.max(1, Number(event.target.value) || 1),
                                }
                              : item
                          )
                        )
                      }
                    />
                  </div>
                  <div className="flex items-end gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => movePackageLine(index, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={index === selectedPackages.length - 1}
                      onClick={() => movePackageLine(index, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setSelectedPackages((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index)
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <FieldError messages={errors} />
        <p className="mt-2 text-sm font-medium text-text-primary">
          Total session duration: {formatDuration(totalMinutes)}
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <select
          value={pickerDepartmentId}
          onChange={(event) => {
            setPickerDepartmentId(event.target.value);
            setPickerSessionTypeId("");
            setPickerFamilyId("");
            setPickerPackageId("");
          }}
          className="flex h-10 rounded-sm border border-border bg-surface px-3 text-sm"
        >
          <option value="">Department...</option>
          {departments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={pickerSessionTypeId}
          onChange={(event) => {
            setPickerSessionTypeId(event.target.value);
            setPickerFamilyId("");
            setPickerPackageId("");
          }}
          disabled={!pickerDepartmentId}
          className="flex h-10 rounded-sm border border-border bg-surface px-3 text-sm"
        >
          <option value="">Session type...</option>
          {sessionTypes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={pickerFamilyId}
          onChange={(event) => {
            setPickerFamilyId(event.target.value);
            setPickerPackageId("");
          }}
          disabled={!pickerSessionTypeId}
          className="flex h-10 rounded-sm border border-border bg-surface px-3 text-sm"
        >
          <option value="">Family...</option>
          {families.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={pickerPackageId}
          onChange={(event) => setPickerPackageId(event.target.value)}
          disabled={!pickerFamilyId}
          className="flex h-10 rounded-sm border border-border bg-surface px-3 text-sm"
        >
          <option value="">Package...</option>
          {packageOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          if (!pickerPackageId) return;
          setSelectedPackages((current) => {
            const existingIndex = current.findIndex(
              (line) => line.packageId === pickerPackageId
            );
            if (existingIndex >= 0) {
              return current.map((line, index) =>
                index === existingIndex
                  ? { ...line, quantity: line.quantity + 1 }
                  : line
              );
            }
            return [...current, { packageId: pickerPackageId, quantity: 1 }];
          });
          setPickerPackageId("");
        }}
        disabled={!pickerPackageId}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add package
      </Button>
    </div>
  );

  function movePackageLine(index: number, direction: -1 | 1) {
    setSelectedPackages((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
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
  const [selectedPackages, setSelectedPackages] = useState<SelectedPackageLine[]>([]);
  const [sessionDate, setSessionDate] = useState("");
  const [sessionTime, setSessionTime] = useState("");
  const [state, formAction] = useActionState<ActionState, FormData>(
    createBooking,
    {}
  );
  const createDisabled = departments.length === 0 || selectedPackages.length === 0;

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

      <PackageLinesField
        packages={packages}
        selectedPackages={selectedPackages}
        setSelectedPackages={setSelectedPackages}
        errors={state.errors?.packages}
      />

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

function uniqueOptions<T>(
  items: T[],
  idKey: keyof T,
  nameKey: keyof T
) {
  const options = new Map<string, string>();
  for (const item of items) {
    options.set(String(item[idKey]), String(item[nameKey]));
  }
  return Array.from(options, ([id, name]) => ({ id, name }));
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours <= 0) return `${minutes} minutes`;
  if (remainingMinutes === 0) return `${minutes} minutes (${hours} hr)`;
  return `${minutes} minutes (${hours} hr ${remainingMinutes} min)`;
}
