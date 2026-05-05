import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function EditOrderPlaceholderPage(
  props: PageProps<"/orders/[orderId]/edit">
) {
  const { orderId } = await props.params;

  return (
    <PageContainer>
      <div className="space-y-6">
        <Button variant="ghost" asChild className="px-0">
          <Link href={`/orders/${orderId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to order
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit Order</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-text-secondary">
            Edit order workflow is coming soon.
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
