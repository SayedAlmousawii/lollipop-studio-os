import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay";

type CalendarHeaderProps = {
  currentPeriod: string;
  activeView: CalendarView;
  onViewChange: (view: CalendarView) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
};

export function CalendarHeader({
  currentPeriod,
  activeView,
  onViewChange,
  onPrevious,
  onNext,
  onToday,
}: CalendarHeaderProps) {
return (
  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
    <div>
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
        Calendar
      </h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        View studio bookings across month, week, and day schedules.
      </p>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        <Button
          type="button"
          size="sm"
          variant={activeView === "dayGridMonth" ? "default" : "ghost"}
          onClick={() => onViewChange("dayGridMonth")}
        >
          Month
        </Button>

        <Button
          type="button"
          size="sm"
          variant={activeView === "timeGridWeek" ? "default" : "ghost"}
          onClick={() => onViewChange("timeGridWeek")}
        >
          Week
        </Button>

        <Button
          type="button"
          size="sm"
          variant={activeView === "timeGridDay" ? "default" : "ghost"}
          onClick={() => onViewChange("timeGridDay")}
        >
          Day
        </Button>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        <Button type="button" size="icon" variant="ghost" aria-label="Previous month" onClick={onPrevious}>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Button type="button" size="sm" variant="ghost" onClick={onToday}>
          Today
        </Button>

        <Button type="button" size="icon" variant="ghost" aria-label="Next month" onClick={onNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-w-32 text-sm font-medium text-[var(--color-text-primary)]">
        {currentPeriod}
      </div>

      <Button type="button" size="sm">
        <Plus className="mr-2 h-4 w-4" />
        New Booking
      </Button>
    </div>
  </div>
);
}