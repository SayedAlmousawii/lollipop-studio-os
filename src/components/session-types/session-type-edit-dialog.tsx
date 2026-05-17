import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  SessionTypeDepartmentOption,
  SessionTypeRow,
} from "@/modules/session-types/session-type.types";
import { SessionTypeForm } from "./session-type-form";

export function SessionTypeEditDialog({
  sessionType,
  departments,
}: {
  sessionType: SessionTypeRow;
  departments: SessionTypeDepartmentOption[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start px-2 py-1.5 text-sm font-normal"
        >
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Session Type</DialogTitle>
        </DialogHeader>
        <SessionTypeForm
          mode="edit"
          departments={departments}
          sessionType={sessionType}
        />
      </DialogContent>
    </Dialog>
  );
}
