export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ orderId: string }>;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6">
        {children}
      </div>
    </div>
  );
}
