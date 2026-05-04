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

export function BookingsFilters() {
  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-48 flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <Input placeholder="Search bookings..." className="pl-9" />
      </div>

      <Select>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="confirmed">Confirmed</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      <Select>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Date" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Dates</SelectItem>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="week">This Week</SelectItem>
          <SelectItem value="month">This Month</SelectItem>
        </SelectContent>
      </Select>

      <Select>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Package" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Packages</SelectItem>
          <SelectItem value="basic">Basic</SelectItem>
          <SelectItem value="standard">Standard</SelectItem>
          <SelectItem value="premium">Premium</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
