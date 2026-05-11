"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Loader2, Search } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  lookupDashboardSalesByCustomerId,
  lookupDashboardSalesByPhone,
  type DashboardPhoneLookupState,
} from "@/app/(dashboard)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InvoiceStatusBadge } from "@/components/orders/invoice-status-badge";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { SectionHeader } from "@/components/dashboard/section-header";
import type { CustomerOrderHistoryItem } from "@/modules/orders/order.types";

type PhoneSuggestion = {
  id: string;
  name: string;
  phone: string;
};

const INITIAL_LOOKUP_STATE = {
  phoneSearch: "",
  customer: null,
  orders: [],
  hasSearched: false,
} satisfies DashboardPhoneLookupState;

export function PhoneSalesSearch() {
  const [state, formAction] = useActionState<
    DashboardPhoneLookupState,
    FormData
  >(lookupDashboardSalesByPhone, INITIAL_LOOKUP_STATE);
  const [selectedLookupState, setSelectedLookupState] =
    useState<DashboardPhoneLookupState | null>(null);
  const [inputValue, setInputValue] = useState(state.phoneSearch);
  const [suggestions, setSuggestions] = useState<PhoneSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [hasSuggestionResponse, setHasSuggestionResponse] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [, startSelectionTransition] = useTransition();
  const containerRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const skipNextSuggestionFetchRef = useRef(false);
  const listboxId = useId();
  const activeState = selectedLookupState ?? state;
  const numericQuery = inputValue.replace(/\D/g, "");
  const canFetchSuggestions = numericQuery.length >= 3;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
        setHighlightedIndex(-1);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (skipNextSuggestionFetchRef.current) {
      skipNextSuggestionFetchRef.current = false;
      return;
    }

    if (!canFetchSuggestions) {
      return;
    }

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsLoadingSuggestions(true);

      fetch(`/api/customers/phone-suggestions?q=${encodeURIComponent(inputValue)}`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            return [] as PhoneSuggestion[];
          }

          return response.json() as Promise<PhoneSuggestion[]>;
        })
        .then((data) => {
          setSuggestions(data);
          setHighlightedIndex(data.length > 0 ? 0 : -1);
          setHasSuggestionResponse(true);
          setShowDropdown(true);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }

          setSuggestions([]);
          setHighlightedIndex(-1);
          setHasSuggestionResponse(true);
        })
        .finally(() => {
          if (abortControllerRef.current === controller) {
            setIsLoadingSuggestions(false);
          }
        });
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [canFetchSuggestions, inputValue]);

  return (
    <section className="rounded-[14px] border border-border bg-surface p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeader
          title="Sales Lookup"
          description="Find a customer by phone and open their POS workspace directly."
        />
        <form
          ref={containerRef}
          action={formAction}
          className="flex w-full gap-2 lg:max-w-md"
          onSubmit={() => {
            setSelectedLookupState(null);
            closeDropdown();
          }}
        >
          <label htmlFor="dashboard-phone-search" className="sr-only">
            Search by phone number
          </label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
            <Input
              id="dashboard-phone-search"
              name="phone"
              type="search"
              inputMode="tel"
              placeholder="Search phone number..."
              value={inputValue}
              role="combobox"
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded={showDropdown}
              aria-activedescendant={
                highlightedIndex >= 0
                  ? `${listboxId}-option-${suggestions[highlightedIndex]?.id}`
                  : undefined
              }
              aria-invalid={activeState.errors?.phone ? true : undefined}
              className="pl-9 pr-9"
              onChange={(event) => {
                const nextValue = event.target.value;
                const nextDigits = nextValue.replace(/\D/g, "");

                setInputValue(nextValue);
                setSelectedLookupState(null);
                setHasSuggestionResponse(false);

                if (nextDigits.length < 3) {
                  setSuggestions([]);
                  setIsLoadingSuggestions(false);
                  setHighlightedIndex(-1);
                  setShowDropdown(false);
                  return;
                }

                setShowDropdown(true);
              }}
              onFocus={() => {
                if (
                  canFetchSuggestions &&
                  (isLoadingSuggestions ||
                    suggestions.length > 0 ||
                    hasSuggestionResponse)
                ) {
                  setShowDropdown(true);
                }
              }}
              onKeyDown={handleInputKeyDown}
            />
            {isLoadingSuggestions ? (
              <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-secondary" />
            ) : null}
            <PhoneSuggestionDropdown
              id={listboxId}
              suggestions={suggestions}
              highlightedIndex={highlightedIndex}
              isOpen={showDropdown && canFetchSuggestions}
              isLoading={isLoadingSuggestions}
              hasResponse={hasSuggestionResponse}
              onSelect={selectSuggestion}
              onHighlight={setHighlightedIndex}
            />
          </div>
          <SearchSubmitButton />
        </form>
      </div>

      <PhoneLookupResult state={activeState} />
    </section>
  );

  function closeDropdown() {
    setShowDropdown(false);
    setHighlightedIndex(-1);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeDropdown();
      return;
    }

    if (event.key === "Tab") {
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

  function selectSuggestion(suggestion: PhoneSuggestion) {
    skipNextSuggestionFetchRef.current = true;
    setInputValue(suggestion.phone);
    closeDropdown();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoadingSuggestions(false);

    startSelectionTransition(async () => {
      const result = await lookupDashboardSalesByCustomerId(suggestion.id);
      setSelectedLookupState(result);
      setInputValue(result.phoneSearch || suggestion.phone);
    });
  }
}

function PhoneSuggestionDropdown({
  id,
  suggestions,
  highlightedIndex,
  isOpen,
  isLoading,
  hasResponse,
  onSelect,
  onHighlight,
}: {
  id: string;
  suggestions: PhoneSuggestion[];
  highlightedIndex: number;
  isOpen: boolean;
  isLoading: boolean;
  hasResponse: boolean;
  onSelect: (suggestion: PhoneSuggestion) => void;
  onHighlight: (index: number) => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      id={id}
      role="listbox"
      className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-[10px] border border-border bg-surface shadow-sm"
    >
      {suggestions.map((suggestion, index) => {
        const isHighlighted = index === highlightedIndex;

        return (
          <button
            key={suggestion.id}
            id={`${id}-option-${suggestion.id}`}
            type="button"
            role="option"
            aria-selected={isHighlighted}
            className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors ${
              isHighlighted ? "bg-accent-soft" : "hover:bg-surface-soft"
            }`}
            onMouseEnter={() => onHighlight(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(suggestion)}
          >
            <span className="text-sm font-medium text-text-primary">
              {suggestion.name}
            </span>
            <span className="text-xs tabular-nums text-text-secondary">
              {suggestion.phone}
            </span>
          </button>
        );
      })}

      {isLoading ? (
        <p className="px-3 py-2 text-sm text-text-secondary">Searching...</p>
      ) : null}

      {!isLoading && hasResponse && suggestions.length === 0 ? (
        <p className="px-3 py-2 text-sm text-text-secondary">No results</p>
      ) : null}
    </div>
  );
}

function SearchSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Searching..." : "Search"}
    </Button>
  );
}

function PhoneLookupResult({ state }: { state: DashboardPhoneLookupState }) {
  if (state.errors?._global) {
    return (
      <LookupMessage>
        We could not complete the phone lookup right now. Please try again.
      </LookupMessage>
    );
  }

  if (state.errors?.phone) {
    return <LookupMessage>{state.errors.phone[0]}</LookupMessage>;
  }

  if (!state.hasSearched) {
    return (
      <LookupMessage>
        Enter a phone number to see recent orders and jump into the sales workspace.
      </LookupMessage>
    );
  }

  if (!state.customer) {
    return <LookupMessage>No customer found for this phone number.</LookupMessage>;
  }

  return (
    <div className="mt-5 space-y-4" role="status" aria-live="polite">
      <div className="flex flex-col gap-1 rounded-[12px] bg-surface-soft p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-text-primary">
            {state.customer.fullName}
          </p>
          <p className="text-sm tabular-nums text-text-secondary">
            {state.customer.phone}
          </p>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">
          {state.orders.length} recent{" "}
          {state.orders.length === 1 ? "order" : "orders"}
        </p>
      </div>

      {state.orders.length > 0 ? (
        <div className="divide-y divide-border overflow-hidden rounded-[12px] border border-border">
          {state.orders.map((order) => (
            <LookupOrderRow key={order.id} order={order} />
          ))}
        </div>
      ) : (
        <LookupMessage>
          Customer found, but no orders are linked to this phone number yet.
        </LookupMessage>
      )}
    </div>
  );
}

function LookupOrderRow({ order }: { order: CustomerOrderHistoryItem }) {
  return (
    <div className="grid gap-3 bg-surface p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <LookupMetric label="Job" value={order.jobNumber} />
        <LookupMetric label="Session" value={order.sessionDate} />
        <LookupMetric label="Package" value={order.packageName} />
        <div>
          <p className="text-xs text-text-secondary">Status</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <OrderStatusBadge status={order.orderStatus} />
            <InvoiceStatusBadge status={order.invoiceStatus} />
            <span className="inline-flex rounded-full bg-surface-soft px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              {order.paymentStatus}
            </span>
          </div>
        </div>
      </div>
      <Button size="sm" asChild>
        <Link href={`/orders/${order.id}/sales`}>
          Open Sales
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}

function LookupMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}

function LookupMessage({ children }: { children: ReactNode }) {
  return (
    <p
      className="mt-5 rounded-[12px] border border-dashed border-border bg-surface-soft p-4 text-sm text-text-secondary"
      role="status"
      aria-live="polite"
    >
      {children}
    </p>
  );
}
