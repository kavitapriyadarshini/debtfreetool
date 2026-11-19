"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NOT_COMPARABLE, NOT_COMPARABLE_REASON } from "@/lib/format";

/** Months or interest saved. "Not comparable" explains why there is no baseline. */
export function SavingsText({ value, reason }: { value: string; reason?: string | null }) {
  if (value !== NOT_COMPARABLE) return <span>{value}</span>;
  const detail = reason || NOT_COMPARABLE_REASON;
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="underline decoration-dotted underline-offset-4"
        aria-label={`${NOT_COMPARABLE}. ${detail}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {NOT_COMPARABLE}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{detail}</TooltipContent>
    </Tooltip>
  );
}
