"use client";

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
  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-48 flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <label htmlFor="orders-search" className="sr-only">Search orders</label>
        <Input id="orders-search" placeholder="Search by customer or package…" className="pl-9" />
      </div>

      <Select>
        <SelectTrigger className="w-48" aria-label="Filter by order status">
          <SelectValue placeholder="Order Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="awaiting-selection">Awaiting Selection</SelectItem>
          <SelectItem value="editing">Editing</SelectItem>
          <SelectItem value="in-production">In Production</SelectItem>
          <SelectItem value="ready">Ready</SelectItem>
          <SelectItem value="delivered">Delivered</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      <Select>
        <SelectTrigger className="w-44" aria-label="Filter by invoice status">
          <SelectValue placeholder="Invoice Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="unpaid">Unpaid</SelectItem>
          <SelectItem value="partial">Partial</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
          <SelectItem value="refunded">Refunded</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
