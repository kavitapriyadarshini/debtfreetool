"use client";

import { useState } from "react";
import Link from "next/link";
import { OnePager } from "@/components/one-pager";
import { Profile } from "@/components/profile";
import { Button } from "@/components/ui/button";
import { useDemoStore } from "@/lib/store";

export function SummarySheet({ householdId }: { householdId: string }) {
  const snapshots = useDemoStore((state) => state.snapshots ?? []);
  const snapshot = [...snapshots].reverse().find((row) => row.household_id === householdId) ?? null;

  if (!snapshot) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Summary</h1>
        <p>No agreed plan has been saved for this household.</p>
        <Link href={`/households/${householdId}`} className="text-sm underline-offset-2 hover:underline">
          Back to the household
        </Link>
      </div>
    );
  }

  return (
    <Profile id="summary">
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Download the household&apos;s PDF</h1>
          <Link href={`/households/${householdId}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Back to the household
          </Link>
        </div>
        <DownloadButton />
      </div>
      <OnePager snapshot={snapshot} />
    </div>
    </Profile>
  );
}

function DownloadButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      aria-busy={pending}
      data-pending={pending ? "true" : undefined}
      disabled={pending}
      onPointerDown={(event) => {
        event.currentTarget.dataset.pending = "true";
      }}
      onClick={() => {
        setPending(true);
        window.print();
        window.setTimeout(() => setPending(false), 0);
      }}
    >
      {pending ? "Preparing…" : "Download the household's PDF"}
    </Button>
  );
}
