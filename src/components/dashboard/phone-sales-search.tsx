"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Search } from "lucide-react";
import type { ReactNode } from "react";
import {
  lookupDashboardSalesByPhone,
  type DashboardPhoneLookupState,
} from "@/app/(dashboard)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InvoiceStatusBadge } from "@/components/orders/invoice-status-badge";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { SectionHeader } from "@/components/dashboard/section-header";
import type { CustomerOrderHistoryItem } from "@/modules/orders/order.types";

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

  return (
    <section className="rounded-[14px] border border-border bg-surface p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeader
          title="Sales Lookup"
          description="Find a customer by phone and open their POS workspace directly."
        />
        <form action={formAction} className="flex w-full gap-2 lg:max-w-md">
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
              defaultValue={state.phoneSearch}
              aria-invalid={state.errors?.phone ? true : undefined}
              className="pl-9"
            />
          </div>
          <SearchSubmitButton />
        </form>
      </div>

      <PhoneLookupResult state={state} />
    </section>
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
    <div className="mt-5 space-y-4">
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
    <p className="mt-5 rounded-[12px] border border-dashed border-border bg-surface-soft p-4 text-sm text-text-secondary">
      {children}
    </p>
  );
}
