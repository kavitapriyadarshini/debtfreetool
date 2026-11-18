"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FirmView } from "@/components/firm-view";
import { useDemoStore } from "@/lib/store";

export default function FirmPage() {
  const role = useDemoStore((state) => state.user.role);
  const router = useRouter();

  useEffect(() => {
    if (role !== "manager") router.replace("/opportunities");
  }, [role, router]);

  if (role !== "manager") return null;

  return <FirmView />;
}
