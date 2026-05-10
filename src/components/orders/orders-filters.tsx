"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import type { OrderEditorOption, OrderFilters } from "@/modules/orders/order.types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface OrdersFiltersProps {
  currentFilters: OrderFilters;
  editorOptions: OrderEditorOption[];
}

export function OrdersFilters({
  currentFilters,
  editorOptions,
}: OrdersFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get("search") ?? currentFilters.search ?? "";
  const orderStatus = searchParams.get("orderStatus") ?? currentFilters.orderStatus ?? "all";
  const invoiceStatus =
    searchParams.get("invoiceStatus") ?? currentFilters.invoiceStatus ?? "all";
  const sessionDateFrom =
    searchParams.get("sessionDateFrom") ?? currentFilters.sessionDateFrom ?? "";
  const sessionDateTo = searchParams.get("sessionDateTo") ?? currentFilters.sessionDateTo ?? "";
  const editorId = searchParams.get("editorId") ?? currentFilters.editorId ?? "all";
  const hasActiveFilters = Boolean(
    search ||
      sessionDateFrom ||
      sessionDateTo ||
      orderStatus !== "all" ||
      invoiceStatus !== "all" ||
      editorId !== "all"
  );

  function updateFilters(
    updates: Partial<
      Record<
        | "search"
        | "orderStatus"
        | "invoiceStatus"
        | "sessionDateFrom"
        | "sessionDateTo"
        | "editorId",
        string
      >
    >
  ) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (!value?.trim() || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    router.replace(query ? `/orders?${query}` : "/orders");
  }

  function updateFilter(
    key:
      | "search"
      | "orderStatus"
      | "invoiceStatus"
      | "sessionDateFrom"
      | "sessionDateTo"
      | "editorId",
    value: string
  ) {
    updateFilters({ [key]: value });
  }

  function resetFilters() {
    router.replace("/orders");
  }

  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-48 flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <label htmlFor="orders-search" className="sr-only">Search orders</label>
        <Input
          id="orders-search"
          placeholder="Search phone or job number..."
          className="pl-9"
          value={search}
          onChange={(event) => updateFilter("search", event.target.value)}
        />
      </div>

      <Select
        value={orderStatus}
        onValueChange={(value) => updateFilter("orderStatus", value)}
      >
        <SelectTrigger className="w-48" aria-label="Filter by order status">
          <SelectValue placeholder="Order Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="ACTIVE">Active</SelectItem>
          <SelectItem value="WAITING_SELECTION">Waiting Selection</SelectItem>
          <SelectItem value="SELECTION_COMPLETED">Selection Completed</SelectItem>
          <SelectItem value="EDITING">Editing</SelectItem>
          <SelectItem value="PRODUCTION">Production</SelectItem>
          <SelectItem value="READY">Ready</SelectItem>
          <SelectItem value="DELIVERED">Delivered</SelectItem>
          <SelectItem value="CANCELLED">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={invoiceStatus}
        onValueChange={(value) => updateFilter("invoiceStatus", value)}
      >
        <SelectTrigger className="w-44" aria-label="Filter by invoice status">
          <SelectValue placeholder="Invoice Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="DRAFT">Draft</SelectItem>
          <SelectItem value="ISSUED">Issued</SelectItem>
          <SelectItem value="PARTIAL">Partial</SelectItem>
          <SelectItem value="PAID">Paid</SelectItem>
          <SelectItem value="CLOSED">Closed</SelectItem>
        </SelectContent>
      </Select>

      <DateRangePicker
        value={{
          from: sessionDateFrom || undefined,
          to: sessionDateTo || undefined,
        }}
        onChange={({ from, to }) => {
          updateFilters({
            sessionDateFrom: from ?? "",
            sessionDateTo: to ?? "",
          });
        }}
        placeholder="Session date range"
        className="w-[300px]"
      />

      <Select
        value={editorId}
        onValueChange={(value) => updateFilter("editorId", value)}
      >
        <SelectTrigger className="w-48" aria-label="Filter by assigned editor">
          <SelectValue placeholder="Assigned Editor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Editors</SelectItem>
          {editorOptions.map((editor) => (
            <SelectItem key={editor.id} value={editor.id}>
              {editor.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        onClick={resetFilters}
        disabled={!hasActiveFilters}
      >
        Reset filters
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className={
          orderStatus === "READY"
            ? "border-success bg-success-soft text-success hover:bg-success-soft/80 hover:text-success"
            : "border-border bg-surface-soft text-text-secondary hover:border-success hover:bg-success-soft hover:text-success"
        }
        onClick={() =>
          updateFilter("orderStatus", orderStatus === "READY" ? "all" : "READY")
        }
        aria-pressed={orderStatus === "READY"}
      >
        Ready for Pickup
      </Button>
    </div>
  );
}
