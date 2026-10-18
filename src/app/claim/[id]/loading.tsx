import { AppShell } from "@/components/AppShell";
import { OrderDetailSkeleton } from "@/components/states";

export default function DetailLoading() {
  return <AppShell><OrderDetailSkeleton /></AppShell>;
}
