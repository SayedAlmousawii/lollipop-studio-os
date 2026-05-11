import { getCurrentAppUser } from "@/lib/auth";
import { getCustomerPhoneSuggestions } from "@/modules/customers/customer.service";

export async function GET(request: Request) {
  try {
    const appUser = await getCurrentAppUser();

    if (!appUser || !appUser.active) {
      return Response.json([]);
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const suggestions = await getCustomerPhoneSuggestions(query);

    return Response.json(suggestions);
  } catch (error) {
    console.error("Customer phone suggestions failed", error);

    return Response.json([]);
  }
}
