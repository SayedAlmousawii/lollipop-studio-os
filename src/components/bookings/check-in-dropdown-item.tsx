"use client";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

interface CheckInDropdownItemProps {
  onOpen: () => void;
}

export function CheckInDropdownItem({ onOpen }: CheckInDropdownItemProps) {
  return (
    <DropdownMenuItem
      onSelect={() => {
        requestAnimationFrame(onOpen);
      }}
    >
      Check In
    </DropdownMenuItem>
  );
}
