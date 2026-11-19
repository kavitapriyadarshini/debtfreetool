"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PaymentAlert } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A small amber or red dot. Nothing when the payment does not rise enough to alert. */
export function PaymentDot({ alert, label }: { alert: PaymentAlert; label: string }) {
  if (alert === "none") return null;
  const colour = alert === "red" ? "Red" : "Amber";
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={`${colour} payment alert. ${label}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          "inline-block size-2.5 rounded-full align-middle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          alert === "red" ? "bg-payment-red" : "bg-payment-amber",
        )}
      />
      <TooltipContent className="max-w-xs">{label}</TooltipContent>
    </Tooltip>
  );
}
