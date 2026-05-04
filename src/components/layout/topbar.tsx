import { Bell, Plus, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TopbarProps {
  pageTitle: string;
}

export function Topbar({ pageTitle }: TopbarProps) {
  return (
    <header className="flex h-14 flex-shrink-0 items-center gap-4 border-b border-border bg-surface px-6">
      <h1 className="flex-shrink-0 text-lg font-semibold text-text-primary">
        {pageTitle}
      </h1>

      <div className="flex flex-1 items-center justify-end gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            placeholder="Search bookings..."
            className="h-9 pl-9 text-sm"
          />
        </div>

        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Booking
        </Button>

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-accent-soft hover:text-text-primary"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-accent-soft hover:text-text-primary"
          aria-label="User menu"
        >
          <User className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
