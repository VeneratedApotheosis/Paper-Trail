import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getFindingForRequest } from "@/lib/api/server";

// Check existence outside the loading boundary; opening a draft remains the page's responsibility.
export default async function ClaimLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!await getFindingForRequest(id)) notFound();
  return children;
}
