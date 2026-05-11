import { getCurrentAppUser } from "@/lib/auth";
import { getCustomerPhoneSuggestions } from "@/modules/customers/customer.service";

const NO_STORE_RESPONSE = {
  headers: {
    "Cache-Control": "no-store",
  },
};

export async function GET(request: Request) {
  try {
    const appUser = await getCurrentAppUser();

    if (!appUser || !appUser.active) {
      return Response.json([], NO_STORE_RESPONSE);
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const suggestions = await getCustomerPhoneSuggestions(query);

    return Response.json(suggestions, NO_STORE_RESPONSE);
  } catch (error) {
    console.error("Customer phone suggestions failed", error);

    return Response.json([], NO_STORE_RESPONSE);
  }
}
