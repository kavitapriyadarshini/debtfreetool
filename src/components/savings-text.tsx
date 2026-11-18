"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NOT_COMPARABLE, NOT_COMPARABLE_REASON } from "@/lib/format";

/** Months or interest saved. "Not comparable" explains why there is no baseline. */
export function SavingsText({ value }: { value: string }) {
  if (value !== NOT_COMPARABLE) return <span>{value}</span>;
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="underline decoration-dotted underline-offset-4"
        aria-label={`${NOT_COMPARABLE}. ${NOT_COMPARABLE_REASON}`}
      >
        {NOT_COMPARABLE}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{NOT_COMPARABLE_REASON}</TooltipContent>
    </Tooltip>
  );
}
