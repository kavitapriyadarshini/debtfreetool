"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Room under the fixed bar so the last row of a screen stays clickable. */
export const actionBarOffset = "pb-36 print:pb-0";

/**
 * Persistent actions for one household. Fixed to the bottom of the screen,
 * with the name on the left. Arrow keys move between the actions.
 */
export function ActionBar({
  name,
  children,
  edge = "content",
  banner,
}: {
  name: string;
  children: ReactNode;
  /** Present mode has no app sidebar, so the bar spans the screen. */
  edge?: "content" | "screen";
  /** Fixed content sitting directly above the actions, such as the plan rule. */
  banner?: ReactNode;
}) {
  const bar = useRef<HTMLDivElement>(null);

  const raised = banner != null;
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = raised ? "14rem" : "9rem";
    return () => {
      root.style.scrollPaddingBottom = previous;
    };
  }, [raised]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const key = event.key;
    if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "Home" && key !== "End") return;
    const items = [...(bar.current?.querySelectorAll<HTMLElement>("a, button") ?? [])].filter(
      (item) => !item.hasAttribute("disabled") && !item.getAttribute("aria-disabled"),
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const next =
      key === "Home" ? 0 : key === "End" ? items.length - 1 : key === "ArrowRight" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div
      className={cn(
        "fixed bottom-0 right-0 z-40 flex flex-col print:hidden",
        edge === "screen" ? "left-0" : "left-0 md:left-56",
      )}
    >
      {banner}
      <div
        ref={bar}
        role="toolbar"
        aria-label={`Actions for ${name}`}
        data-testid="action-bar"
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-card px-4 py-3"
      >
        <p className="mr-auto min-w-0 truncate text-sm font-medium">{name}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
      </div>
    </div>
  );
}
