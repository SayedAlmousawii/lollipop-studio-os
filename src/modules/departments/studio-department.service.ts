import { db } from "@/lib/db";
import { withRetry } from "@/lib/retry";

export interface StudioDepartmentOption {
  id: string;
  name: string;
  code: string;
}

export async function getActiveStudioDepartments(): Promise<
  StudioDepartmentOption[]
> {
  return withRetry(
    () =>
      db.studioDepartment.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    "Failed to fetch studio departments"
  );
}
