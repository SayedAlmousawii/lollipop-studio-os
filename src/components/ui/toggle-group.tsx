"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ToggleGroupContextValue = {
  value: string;
  onValueChange: (value: string) => void;
};

const ToggleGroupContext = React.createContext<ToggleGroupContextValue | null>(null);

export interface ToggleGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  type: "single";
  value: string;
  onValueChange: (value: string) => void;
}

export const ToggleGroup = React.forwardRef<HTMLDivElement, ToggleGroupProps>(
  ({ className, value, onValueChange, children, type, ...props }, ref) => (
    <ToggleGroupContext.Provider value={{ value, onValueChange }}>
      <div
        ref={ref}
        role="group"
        data-type={type}
        className={cn("flex items-center gap-2", className)}
        {...props}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  )
);
ToggleGroup.displayName = "ToggleGroup";

export interface ToggleGroupItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const ToggleGroupItem = React.forwardRef<
  HTMLButtonElement,
  ToggleGroupItemProps
>(({ className, value, onClick, children, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext);
  const selected = context?.value === value;

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      data-state={selected ? "on" : "off"}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-text-secondary transition hover:border-accent/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:border-accent data-[state=on]:bg-accent-soft data-[state=on]:text-accent-dark data-[state=on]:ring-2 data-[state=on]:ring-accent/25",
        className
      )}
      onClick={(event) => {
        context?.onValueChange(value);
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  );
});
ToggleGroupItem.displayName = "ToggleGroupItem";
