"use client";

import { useRef, useState } from "react";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg } from "@fullcalendar/core";

import { CalendarHeader } from "./calendar-header";
import { CalendarFilters } from "./calendar-filters";
import { CalendarEventContent } from "./calendar-event-content";
import { mockBookings, type CalendarBooking } from "./calendar-mock-data";
import { CalendarEventPopover } from "./calendar-event-popover";


type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay";

export function CalendarGrid() {
  const calendarRef = useRef<FullCalendar | null>(null);

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const [activeView, setActiveView] = useState<CalendarView>("dayGridMonth");
  const [currentPeriod, setCurrentPeriod] = useState("May 2026");
  const [selectedBooking, setSelectedBooking] =
    useState<CalendarBooking | null>(null);
    

  const calendarApi = calendarRef.current?.getApi();

    function updateCurrentPeriod() {
    const api = calendarRef.current?.getApi();

    if (!api) return;

    setCurrentPeriod(api.view.title);
  }

  function handlePrevious() {
    calendarApi?.prev();
    updateCurrentPeriod();
  }

  function handleNext() {
    calendarApi?.next();
    updateCurrentPeriod();
  }

  function handleToday() {
    calendarApi?.today();
    updateCurrentPeriod();
  }

  function handleViewChange(view: CalendarView) {
    calendarApi?.changeView(view);
    setActiveView(view);
    updateCurrentPeriod();
  }

  function handleEventClick(eventInfo: EventClickArg) {
    const booking = mockBookings.find(
      (item) => item.id === eventInfo.event.id,
    );

    setSelectedBooking(booking ?? null);
    setIsDetailsOpen(Boolean(booking));
  }

    return (
    <div className="space-y-4">
      <CalendarHeader
        currentPeriod={currentPeriod}
        activeView={activeView}
        onViewChange={handleViewChange}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
      />

      <CalendarFilters />

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="min-w-[900px]">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={false}
            events={mockBookings}
            height="auto"
            slotMinTime="08:00:00"
            slotMaxTime="20:00:00"
            nowIndicator
            eventContent={CalendarEventContent}
            eventClick={handleEventClick}
            datesSet={updateCurrentPeriod}
          />
        </div>
      </div>
<CalendarEventPopover
  booking={selectedBooking}
  open={isDetailsOpen}
  onOpenChange={setIsDetailsOpen}
/>
    </div>
  );
}

