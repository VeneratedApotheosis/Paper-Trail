import { notFound } from "next/navigation";
import { getOrderForRequest } from "@/lib/api/server";
import { API_LABELS } from "@/lib/api/types";
import { OrderDetailWrapper } from "./OrderDetailWrapper";

// Thin server wrapper (#61): reads the order from the request's account store and hands it to the view.
// params.id arrives still percent-encoded (real ids contain ':'); getOrderForRequest decodes it once with safeDecode,
// so it is passed as is to avoid double-decoding.
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getOrderForRequest(id);
  if (!data) notFound();

  return (
    <OrderDetailWrapper
      order={data.order}
      findings={data.findings}
      simulatedLabel={API_LABELS.simulatedPrice}
    />
  );
}
