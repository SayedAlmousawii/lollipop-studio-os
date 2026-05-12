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

interface BookingsFiltersProps {
  packageOptions: Array<{
    id: string;
    name: string;
  }>;
}

export function BookingsFilters({ packageOptions }: BookingsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "all";
  const date = searchParams.get("date") ?? "all";
  const packageId = searchParams.get("packageId") ?? "all";

  function updateFilter(
    key: "search" | "status" | "date" | "packageId",
    value: string
  ) {
    const params = new URLSearchParams(searchParams.toString());

    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    const query = params.toString();
    router.replace(query ? `/bookings?${query}` : "/bookings");
  }

  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-48 flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <label htmlFor="bookings-search" className="sr-only">Search bookings</label>
        <Input
          id="bookings-search"
          placeholder="Search phone, booking ID, job number..."
          className="pl-9"
          value={search}
          onChange={(event) => updateFilter("search", event.target.value)}
        />
      </div>

      <Select value={status} onValueChange={(value) => updateFilter("status", value)}>
        <SelectTrigger className="w-40" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="PENDING">Pending</SelectItem>
          <SelectItem value="CONFIRMED">Confirmed</SelectItem>
          <SelectItem value="CHECKED_IN">Checked In</SelectItem>
          <SelectItem value="CANCELLED">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      <Select value={date} onValueChange={(value) => updateFilter("date", value)}>
        <SelectTrigger className="w-40" aria-label="Filter by date">
          <SelectValue placeholder="Date" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Dates</SelectItem>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="week">This Week</SelectItem>
          <SelectItem value="month">This Month</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={packageId}
        onValueChange={(value) => updateFilter("packageId", value)}
      >
        <SelectTrigger className="w-40" aria-label="Filter by package">
          <SelectValue placeholder="Package" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Packages</SelectItem>
          {packageOptions.map((pkg) => (
            <SelectItem key={pkg.id} value={pkg.id}>
              {pkg.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
