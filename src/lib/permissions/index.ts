import "server-only";

import { UserRole } from "@prisma/client";
import { unauthorized } from "next/navigation";

import { requireCurrentAppUser, type CurrentAppUser } from "@/lib/auth";

export const PERMISSIONS = {
  ORDER_READ: "order:read",
  BOOKING_STATUS_UPDATE: "booking:status-update",
  PAYMENT_CREATE: "payment:create",
  INVOICE_CREATE: "invoice:create",
  INVOICE_ISSUE: "invoice:issue",
  INVOICE_CLOSE: "invoice:close",
  INVOICE_ADJUSTMENT_CREATE: "invoice:adjustment-create",
  ORDER_FINANCIAL_UPDATE: "order:financial-update",
  DELIVERY_UPDATE: "delivery:update",
  DELIVERY_COMPLETE: "delivery:complete",
  DELIVERY_PAYMENT_OVERRIDE: "delivery:payment-override",
  WORKFLOW_EDITING_UPDATE: "workflow:editing-update",
  WORKFLOW_PRODUCTION_UPDATE: "workflow:production-update",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  MANAGER: ALL_PERMISSIONS,
  RECEPTIONIST: [
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.BOOKING_STATUS_UPDATE,
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.INVOICE_CREATE,
    PERMISSIONS.DELIVERY_UPDATE,
    PERMISSIONS.DELIVERY_COMPLETE,
    PERMISSIONS.WORKFLOW_PRODUCTION_UPDATE,
  ],
  RESERVATION: [
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.BOOKING_STATUS_UPDATE,
    PERMISSIONS.WORKFLOW_PRODUCTION_UPDATE,
  ],
  PHOTOGRAPHER: [
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.WORKFLOW_PRODUCTION_UPDATE,
  ],
  EDITOR: [
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.WORKFLOW_EDITING_UPDATE,
    PERMISSIONS.WORKFLOW_PRODUCTION_UPDATE,
  ],
  ACCOUNTANT: [
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.INVOICE_CREATE,
    PERMISSIONS.INVOICE_ISSUE,
    PERMISSIONS.INVOICE_CLOSE,
    PERMISSIONS.INVOICE_ADJUSTMENT_CREATE,
  ],
};

export function hasPermission(
  appUser: Pick<CurrentAppUser, "role">,
  permission: Permission
): boolean {
  return ROLE_PERMISSIONS[appUser.role].includes(permission);
}

export function requirePermission(
  appUser: Pick<CurrentAppUser, "role">,
  permission: Permission
): void {
  if (hasPermission(appUser, permission)) {
    return;
  }

  unauthorized();
}

export async function requireCurrentAppUserPermission(
  permission: Permission
): Promise<CurrentAppUser> {
  const appUser = await requireCurrentAppUser();
  requirePermission(appUser, permission);
  return appUser;
}
