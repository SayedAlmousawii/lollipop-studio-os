import { UserButton } from "@clerk/nextjs";
import { Bell } from "lucide-react";
import { DevResetWorkflowButton } from "./dev-reset-workflow-button";

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
        {process.env.NODE_ENV === "development" ? (
          <DevResetWorkflowButton />
        ) : null}

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-accent-soft hover:text-text-primary"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>

        <div className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent-soft">
          <UserButton />
        </div>
      </div>
    </header>
  );
}
