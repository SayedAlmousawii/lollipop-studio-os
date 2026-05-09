import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <h1 className="text-2xl font-semibold tracking-tight">Access Denied</h1>
      <p className="text-sm text-muted-foreground">
        You are signed in but do not have permission to access this page.
      </p>
      <Link
        href="/"
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Return to Dashboard
      </Link>
    </div>
  );
}
