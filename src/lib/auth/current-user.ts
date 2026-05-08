import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";

const appUserSelect = {
  id: true,
  clerkId: true,
  name: true,
  email: true,
  role: true,
} satisfies Prisma.UserSelect;

export type CurrentAppUser = Prisma.UserGetPayload<{
  select: typeof appUserSelect;
}>;

export const getCurrentClerkSession = cache(async () => {
  const session = await auth();

  if (!session.isAuthenticated) {
    return null;
  }

  return {
    userId: session.userId,
    sessionId: session.sessionId,
  };
});

export const getCurrentClerkUser = cache(async () => {
  const session = await getCurrentClerkSession();

  if (!session) {
    return null;
  }

  return currentUser();
});

export const getCurrentAppUser = cache(async (): Promise<CurrentAppUser | null> => {
  const clerkUser = await getCurrentClerkUser();

  if (!clerkUser) {
    return null;
  }

  const linkedUser = await db.user.findUnique({
    where: { clerkId: clerkUser.id },
    select: appUserSelect,
  });

  if (linkedUser) {
    return linkedUser;
  }

  const primaryEmail = clerkUser.primaryEmailAddress?.emailAddress;

  if (!primaryEmail) {
    return null;
  }

  const appUser = await db.user.findUnique({
    where: { email: primaryEmail },
    select: appUserSelect,
  });

  if (!appUser || appUser.clerkId) {
    return null;
  }

  try {
    return await db.user.update({
      where: { id: appUser.id },
      data: { clerkId: clerkUser.id },
      select: appUserSelect,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return db.user.findUnique({
        where: { clerkId: clerkUser.id },
        select: appUserSelect,
      });
    }

    throw error;
  }
});

export const requireCurrentAppUser = cache(async () => {
  const session = await getCurrentClerkSession();

  if (!session) {
    redirect("/sign-in");
  }

  const appUser = await getCurrentAppUser();

  if (!appUser) {
    throw new Error(
      "Signed-in Clerk user is not linked to a Studio OS staff user.",
    );
  }

  return appUser;
});
