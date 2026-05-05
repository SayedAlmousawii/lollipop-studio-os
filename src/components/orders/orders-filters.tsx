"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function OrdersFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const orderStatus = searchParams.get("orderStatus") ?? "all";
  const invoiceStatus = searchParams.get("invoiceStatus") ?? "all";

  function updateFilter(
    key: "search" | "orderStatus" | "invoiceStatus",
    value: string
  ) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const query = params.toString();
    router.replace(query ? `/orders?${query}` : "/orders");
  }

  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-48 flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <label htmlFor="orders-search" className="sr-only">Search orders</label>
        <Input
          id="orders-search"
          placeholder="Search by customer..."
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
    </div>
  );
}
