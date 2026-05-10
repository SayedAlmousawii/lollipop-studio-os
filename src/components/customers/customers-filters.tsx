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

interface CustomersFiltersProps {
  currentSearch: string;
  currentStatus: "ACTIVE" | "INACTIVE" | "all";
}

export function CustomersFilters({
  currentSearch,
  currentStatus,
}: CustomersFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get("search") ?? currentSearch;
  const status = searchParams.get("status") ?? currentStatus;

  function updateFilter(key: "search" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (!value.trim() || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete("page");

    const query = params.toString();
    router.replace(query ? `/customers?${query}` : "/customers");
  }

  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-48 flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <label htmlFor="customers-search" className="sr-only">Search customers</label>
        <Input
          id="customers-search"
          placeholder="Search by phone or name..."
          className="pl-9"
          value={search}
          onChange={(event) => updateFilter("search", event.target.value)}
        />
      </div>

      <Select
        value={status === "ACTIVE" || status === "INACTIVE" ? status : "all"}
        onValueChange={(value) => updateFilter("status", value)}
      >
        <SelectTrigger className="w-40" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="ACTIVE">Active</SelectItem>
          <SelectItem value="INACTIVE">Inactive</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
