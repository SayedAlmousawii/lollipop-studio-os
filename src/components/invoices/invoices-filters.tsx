"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function InvoicesFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get("search") ?? "";

  function updateSearch(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) {
      params.set("search", value);
    } else {
      params.delete("search");
    }

    const query = params.toString();
    router.replace(query ? `/invoices?${query}` : "/invoices");
  }

  return (
    <div className="relative min-w-48 max-w-xl">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
      <label htmlFor="invoices-search" className="sr-only">Search invoices</label>
      <Input
        id="invoices-search"
        placeholder="Search invoice, job number, or customer..."
        className="pl-9"
        value={search}
        onChange={(event) => updateSearch(event.target.value)}
      />
    </div>
  );
}
