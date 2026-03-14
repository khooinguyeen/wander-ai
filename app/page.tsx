"use client";

import dynamic from "next/dynamic";

const PlannerShell = dynamic(
  () => import("@/components/planner-shell").then((mod) => mod.PlannerShell),
  { ssr: false }
);

export default function HomePage() {
  return <PlannerShell />;
}
