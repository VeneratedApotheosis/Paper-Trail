import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getOrderForRequest } from "@/lib/api/server";

// This guard sits outside loading.tsx's Suspense boundary, before a fallback can commit HTTP 200.
export default async function OrderLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!await getOrderForRequest(id)) notFound();
  return children;
}
