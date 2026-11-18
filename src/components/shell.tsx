"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChevronDown, List } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AS_OF } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { useDemoStore } from "@/lib/store";
import { MANAGER, listAdvisors, userKey, type DemoUser } from "@/lib/users";
import { cn } from "@/lib/utils";

function userFromKey(value: string): DemoUser {
  if (value === "manager") return MANAGER;
  const advisor = listAdvisors().find((person) => person.name === value) ?? listAdvisors()[0];
  if (!advisor) return MANAGER;
  return { role: "advisor", name: advisor.name, branch: advisor.branch };
}

function NavLinks() {
  const pathname = usePathname();
  const role = useDemoStore((state) => state.user.role);
  const links = [
    { href: "/opportunities", label: "Opportunities", icon: List },
    ...(role === "manager" ? [{ href: "/firm", label: "Firm view", icon: Building2 }] : []),
  ];

  return (
    <>
      {links.map((link) => {
        const active = pathname === link.href;
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
              active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
            )}
          >
            <Icon />
            {link.label}
          </Link>
        );
      })}
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const presenting = pathname.split("/").includes("present");
  const user = useDemoStore((state) => state.user);
  const setUser = useDemoStore((state) => state.setUser);
  const resetDemo = useDemoStore((state) => state.resetDemo);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const finish = () => setReady(true);
    const unsubscribe = useDemoStore.persist.onFinishHydration(finish);
    void useDemoStore.persist.rehydrate();
    if (useDemoStore.persist.hasHydrated()) finish();
    return unsubscribe;
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col gap-4 bg-background p-6 text-foreground" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-14 w-full max-w-3xl" />
        <Skeleton className="h-14 w-full max-w-3xl" />
        <Skeleton className="h-14 w-full max-w-3xl" />
      </div>
    );
  }

  if (presenting) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

    return (
    <div className="flex min-h-screen flex-col bg-background text-foreground print:block print:min-h-0">
      <header className="flex h-14 items-center gap-3 border-b bg-card px-4 print:hidden">
        <Link href="/opportunities" className="text-base font-semibold tracking-tight">
          Debt Free
        </Link>
        <Separator orientation="vertical" className="h-6" />
        <p className="hidden text-sm text-muted-foreground sm:block">Demo date: {formatDate(AS_OF)}</p>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className={buttonVariants({ variant: "outline" })}>
              <span data-testid="current-user">{user.name}</span>
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuRadioGroup
                value={userKey(user)}
                onValueChange={(value) => setUser(userFromKey(value))}
              >
                {listAdvisors().map((advisor) => (
                  <DropdownMenuRadioItem key={advisor.name} value={advisor.name}>
                    <span className="flex flex-col">
                      <span>{advisor.name}</span>
                      <span className="text-xs text-muted-foreground">{advisor.branch}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuRadioItem value="manager">Manager</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            onClick={() => {
              resetDemo();
              toast.success("Demo data restored");
            }}
          >
            Reset demo data
          </Button>
        </div>
      </header>
      <p className="border-b px-4 py-2 text-sm text-muted-foreground sm:hidden print:hidden">Demo date: {formatDate(AS_OF)}</p>
      <div className="flex min-h-0 flex-1 print:block">
        <aside className="hidden w-56 shrink-0 border-r bg-sidebar p-3 md:block print:hidden">
          <nav className="flex flex-col gap-1">
            <NavLinks />
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex gap-1 border-b px-3 py-2 md:hidden print:hidden">
            <NavLinks />
          </nav>
          <main className="min-w-0 flex-1 p-4 sm:p-6 print:p-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
