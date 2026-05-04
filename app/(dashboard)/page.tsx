import { PageContainer } from "@/components/layout/page-container";

export default function DashboardPage() {
  return (
    <PageContainer>
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">Dashboard</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Welcome to Studio OS.
        </p>
      </div>
    </PageContainer>
  );
}
