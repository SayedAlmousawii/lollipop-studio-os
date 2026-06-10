"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import type { InvoiceFilters } from "@/modules/invoices/invoice.types";

const TYPE_OPTIONS = [
  { value: "DEPOSIT", label: "Deposit" },
  { value: "FINAL", label: "Final" },
  { value: "ADJUSTMENT", label: "Adjustment" },
  { value: "CREDIT_NOTE", label: "Credit note" },
  { value: "REFUND", label: "Refund" },
];

interface InvoicesFiltersProps {
  currentFilters: InvoiceFilters;
}

export function InvoicesFilters({ currentFilters }: InvoicesFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get("search") ?? currentFilters.search ?? "";
  const types =
    searchParams.getAll("type").length > 0
      ? searchParams.getAll("type")
      : currentFilters.types ?? [];
  const from = searchParams.get("from") ?? currentFilters.createdFrom ?? "";
  const to = searchParams.get("to") ?? currentFilters.createdTo ?? "";
  const outstandingOnly =
    searchParams.get("outstandingOnly") ??
    (currentFilters.outstandingOnly ? "true" : "all");
  const hasActiveFilters = Boolean(
    search || types.length > 0 || from || to || outstandingOnly === "true"
  );

  function updateFilters(
    updates: Partial<
      Record<"search" | "from" | "to" | "outstandingOnly", string>
    > & { type?: string[] }
  ) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (key === "type") {
        params.delete("type");
        for (const type of value as string[]) {
          if (type.trim()) {
            params.append("type", type);
          }
        }
        continue;
      }

      const stringValue = value as string | undefined;
      if (!stringValue?.trim() || stringValue === "all") {
        params.delete(key);
      } else {
        params.set(key, stringValue);
      }
    }

    const query = params.toString();
    router.replace(query ? `/invoices?${query}` : "/invoices");
  }

  function updateFilter(
    key: "search" | "from" | "to" | "outstandingOnly",
    value: string
  ) {
    updateFilters({ [key]: value });
  }

  function resetFilters() {
    router.replace("/invoices");
  }

  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-48 flex-1">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <label htmlFor="invoices-search" className="sr-only">
          Search financial documents
        </label>
        <Input
          id="invoices-search"
          placeholder="Search invoice, job number, or phone..."
          className="pl-9"
          value={search}
          onChange={(event) => updateFilter("search", event.target.value)}
        />
      </div>

      <MultiSelect
        options={TYPE_OPTIONS}
        selected={types}
        onChange={(next) => updateFilters({ type: next })}
        placeholder="Document type"
        className="w-56"
      />

      <DateRangePicker
        value={{
          from: from || undefined,
          to: to || undefined,
        }}
        onChange={({ from: nextFrom, to: nextTo }) => {
          updateFilters({
            from: nextFrom ?? "",
            to: nextTo ?? "",
          });
        }}
        placeholder="Created date range"
        className="w-[300px]"
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className={
          outstandingOnly === "true"
            ? "border-warning bg-warning-soft text-warning hover:bg-warning-soft/80 hover:text-warning"
            : "border-border bg-surface-soft text-text-secondary hover:border-warning hover:bg-warning-soft hover:text-warning"
        }
        onClick={() =>
          updateFilter(
            "outstandingOnly",
            outstandingOnly === "true" ? "all" : "true"
          )
        }
        aria-pressed={outstandingOnly === "true"}
      >
        Outstanding only
      </Button>

      <Button
        type="button"
        variant="outline"
        onClick={resetFilters}
        disabled={!hasActiveFilters}
      >
        Reset filters
      </Button>
    </div>
  );
}
