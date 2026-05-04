import type { EventContentArg } from "@fullcalendar/core";

export function CalendarEventContent(eventInfo: EventContentArg) {
  const { customerName, sessionType } = eventInfo.event.extendedProps;

  return (
    <div className="truncate rounded-md px-2 py-1 text-xs font-medium">
      <span className="font-semibold">{eventInfo.timeText}</span>
      <span className="ml-1">{customerName}</span>
      <span className="ml-1 opacity-80">• {sessionType}</span>
    </div>
  );
}