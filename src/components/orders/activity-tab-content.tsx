"use client";

import { useState } from "react";
import type { OrderActivityType } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { OrderActivityTimelineItem } from "@/modules/orders/order-activity.types";

const ACTIVITY_TYPE_LABELS: Record<OrderActivityType, string> = {
  ORDER_CREATED: "Order Created",
  PACKAGE_CHANGED: "Package Changed",
  ADD_ON_CHANGED: "Add-on Changed",
  PAYMENT_RECEIVED: "Payment Received",
  INVOICE_ADJUSTED: "Invoice Adjusted",
  SELECTION_UPDATED: "Selection Updated",
  SELECTION_COMPLETED: "Selection Completed",
  EDITOR_ASSIGNED: "Editor Assigned",
  EDITING_STATUS_CHANGED: "Editing Status Changed",
  PRODUCTION_STATUS_CHANGED: "Production Status Changed",
  DELIVERY_STATUS_CHANGED: "Delivery Status Changed",
  ORDER_COMPLETED: "Order Completed",
  NOTE_ADDED: "Note Added",
};

type FilterGroup = "all" | "financial" | "workflow" | "package";

const FILTER_GROUPS: { value: FilterGroup; label: string; types?: OrderActivityType[] }[] = [
  { value: "all", label: "All" },
  {
    value: "financial",
    label: "Financial",
    types: ["PAYMENT_RECEIVED", "INVOICE_ADJUSTED"],
  },
  {
    value: "workflow",
    label: "Workflow",
    types: [
      "SELECTION_UPDATED",
      "SELECTION_COMPLETED",
      "EDITOR_ASSIGNED",
      "EDITING_STATUS_CHANGED",
      "PRODUCTION_STATUS_CHANGED",
      "DELIVERY_STATUS_CHANGED",
    ],
  },
  {
    value: "package",
    label: "Package / Add-ons",
    types: ["PACKAGE_CHANGED", "ADD_ON_CHANGED"],
  },
];

function formatRelativeDate(dateStr: string): string {
  return dateStr;
}

function groupByDate(
  items: OrderActivityTimelineItem[]
): Array<{ date: string; items: OrderActivityTimelineItem[] }> {
  const map = new Map<string, OrderActivityTimelineItem[]>();

  for (const item of items) {
    const dateOnly = item.createdAt.split(",")[0] ?? item.createdAt;
    const existing = map.get(dateOnly);
    if (existing) {
      existing.push(item);
    } else {
      map.set(dateOnly, [item]);
    }
  }

  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

function activityToneClass(type: OrderActivityType): string {
  switch (type) {
    case "PAYMENT_RECEIVED":
      return "border-l-success";
    case "INVOICE_ADJUSTED":
      return "border-l-info";
    case "ORDER_COMPLETED":
      return "border-l-success";
    case "PACKAGE_CHANGED":
    case "ADD_ON_CHANGED":
      return "border-l-warning";
    default:
      return "border-l-border";
  }
}

export function ActivityTabContent({
  items,
}: {
  items: OrderActivityTimelineItem[];
}) {
  const [activeFilter, setActiveFilter] = useState<FilterGroup>("all");

  const filtered =
    activeFilter === "all"
      ? items
      : (items.filter((item) => {
          const group = FILTER_GROUPS.find((g) => g.value === activeFilter);
          return group?.types?.includes(item.type) ?? false;
        }));

  const groups = groupByDate(filtered);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Activity Timeline</CardTitle>
          <div className="flex flex-wrap gap-1">
            {FILTER_GROUPS.map((group) => (
              <Button
                key={group.value}
                variant={activeFilter === group.value ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveFilter(group.value)}
                className="h-7 text-xs"
              >
                {group.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No activity events match the selected filter.
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map(({ date, items: dayItems }) => (
              <div key={date}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {date}
                </p>
                <div className="space-y-3">
                  {dayItems.map((item) => (
                    <div
                      key={item.id}
                      className={`border-l-2 pl-4 ${activityToneClass(item.type)}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-1">
                        <p className="text-sm font-medium text-text-primary">
                          {item.title}
                        </p>
                        <span className="rounded bg-surface-soft px-1.5 py-0.5 text-[11px] text-text-muted">
                          {ACTIVITY_TYPE_LABELS[item.type]}
                        </span>
                      </div>
                      {item.description ? (
                        <p className="mt-1 text-sm text-text-secondary">
                          {item.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-text-muted">
                        {formatRelativeDate(item.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
