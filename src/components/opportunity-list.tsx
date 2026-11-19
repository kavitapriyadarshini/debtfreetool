"use client";

import { useState, type ReactNode } from "react";
import { StaleNotice, useKeptResult } from "@/components/kept-result";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PaymentDot } from "@/components/payment-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SavingsText } from "@/components/savings-text";
import { PAGE_SIZE } from "@/lib/config";
import { formatDate, formatMonths, neverComparableReason, paymentAlertText } from "@/lib/format";
import {
  CASE_STATUS_LABEL,
  FLAG_LABEL,
  filterOpportunities,
  interestSavedLabel,
  listOpportunities,
  monthsSavedLabel,
  nextReadyDate,
  sortOpportunities,
  type OpportunityFilters,
  type OpportunityRow,
  type OpportunitySort,
  type OpportunityTab,
  type ProductFilter,
} from "@/lib/opportunity";
import { selectVisibleHouseholds } from "@/lib/selectors";
import { useDemoStore } from "@/lib/store";
import type { CaseStatus } from "@/lib/types";

const TABS: { id: OpportunityTab; label: string }[] = [
  { id: "ready", label: "Ready to contact" },
  { id: "waiting", label: "Waiting" },
  { id: "progress_check_due", label: "Progress check due" },
];

const PRODUCT_ITEMS = {
  any: "Any product",
  FastApp: "FastApp",
  "HELOAN Yellow": "HELOAN Yellow",
  "HELOAN Pink": "HELOAN Pink",
} as const;

const FLAG_ITEMS = {
  any: "Any",
  yes: "Has flags",
  no: "No flags",
} as const;

const STATUS_ITEMS = {
  any: "Any status",
  none: "No case",
  in_progress: "In progress",
  proposed: "Proposed",
  agreed: "Agreed",
  declined: "Declined",
  undecided: "Undecided",
} as const;

const SORT_ITEMS = {
  months: "Months saved",
  interest: "Interest saved",
  last_contacted: "Last contacted",
  days_until_ready: "Days until ready",
} as const;

function HouseholdLink({ householdId, name }: { householdId: string; name: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Link
      href={`/households/${householdId}`}
      aria-busy={pending}
      data-pending={pending ? "true" : undefined}
      className="font-medium underline-offset-2 hover:underline"
      onPointerDown={(event) => {
        event.currentTarget.dataset.pending = "true";
      }}
      onClick={(event) => {
        event.stopPropagation();
        setPending(true);
      }}
    >
      {pending ? "Opening…" : name}
    </Link>
  );
}

function pageItems(current: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const wanted = [1, count, current - 1, current, current + 1].filter(
    (page) => page >= 1 && page <= count,
  );
  const unique = [...new Set(wanted)].sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  for (const page of unique) {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && page - previous > 1) items.push("gap");
    items.push(page);
  }
  return items;
}

function neverReason(row: OpportunityRow): string {
  return neverComparableReason(row.bestPlanMonths == null ? null : formatMonths(row.bestPlanMonths));
}

function SavedCell({
  value,
  detail,
  mark,
}: {
  value: string;
  detail: string | null;
  mark: boolean;
}) {
  if (mark) {
    return (
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="text-left underline decoration-dotted underline-offset-4"
          aria-label={`${value}. Updated in case. ${detail ?? ""}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {value}
          <span className="ml-1 text-xs text-muted-foreground">Updated in case</span>
        </TooltipTrigger>
        {detail ? <TooltipContent className="max-w-xs">{detail}</TooltipContent> : null}
      </Tooltip>
    );
  }
  return <SavingsText value={value} reason={detail} />;
}

export function OpportunityList() {
  const router = useRouter();
  const user = useDemoStore((state) => state.user);
  const contacts = useDemoStore((state) => state.contacts);
  const cases = useDemoStore((state) => state.cases);
  const overrides = useDemoStore((state) => state.caseOverrides);
  const [tab, setTab] = useState<OpportunityTab>("ready");
  const [product, setProduct] = useState<ProductFilter>("any");
  const [flags, setFlags] = useState<OpportunityFilters["flags"]>("any");
  const [caseStatus, setCaseStatus] = useState<OpportunityFilters["caseStatus"]>("any");
  const [minMonthsText, setMinMonthsText] = useState("");
  const [sort, setSort] = useState<OpportunitySort>("months");
  const [page, setPage] = useState(1);

  const kept = useKeptResult(
    () => listOpportunities(selectVisibleHouseholds(user), contacts, cases, overrides),
    [user, contacts, cases, overrides],
  );
  const book = kept.value ?? [];

  const minMonths = minMonthsText.trim() === "" ? null : Number(minMonthsText);
  const filters: OpportunityFilters = {
    product,
    flags,
    caseStatus,
    minMonths: minMonths != null && Number.isFinite(minMonths) ? minMonths : null,
  };
  const filtersActive =
    product !== "any" || flags !== "any" || caseStatus !== "any" || filters.minMonths != null;

  const filteredBook = filterOpportunities(book, filters);
  const counts = {
    ready: filteredBook.filter((row) => row.outreach === "ready").length,
    waiting: filteredBook.filter((row) => row.outreach === "waiting").length,
    progress_check_due: filteredBook.filter((row) => row.outreach === "progress_check_due").length,
  };
  const rows = sortOpportunities(
    filteredBook.filter((row) => row.outreach === tab),
    sort,
  );
  const unfilteredOnTab = book.filter((row) => row.outreach === tab).length;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);
  const readyDate = nextReadyDate(book);

  function resetPage() {
    setPage(1);
  }

  function clearFilters() {
    setProduct("any");
    setFlags("any");
    setCaseStatus("any");
    setMinMonthsText("");
    resetPage();
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StaleNotice failed={kept.failed} stale={kept.stale} onRetry={kept.retry} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Opportunities</h1>
        <p className="text-sm text-muted-foreground">
          {user.role === "manager" ? "All advisors" : user.name}
          {" · "}
          {book.length} households
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === "ready" || value === "waiting" || value === "progress_check_due") {
            setTab(value);
            resetPage();
          }
        }}
      >
        <TabsList className="h-auto flex-wrap">
          {TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {item.label}
              <span className="text-muted-foreground tabular-nums">{counts[item.id]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        <Filter label="Product">
          <Select
            items={PRODUCT_ITEMS}
            value={product}
            onValueChange={(value) => {
              if (value === "any" || value === "FastApp" || value === "HELOAN Yellow" || value === "HELOAN Pink") {
                setProduct(value);
                resetPage();
              }
            }}
          >
            <SelectTrigger aria-label="Product">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any product</SelectItem>
              <SelectItem value="FastApp">FastApp</SelectItem>
              <SelectItem value="HELOAN Yellow">HELOAN Yellow</SelectItem>
              <SelectItem value="HELOAN Pink">HELOAN Pink</SelectItem>
            </SelectContent>
          </Select>
        </Filter>
        <Filter label="Data flags">
          <Select
            items={FLAG_ITEMS}
            value={flags}
            onValueChange={(value) => {
              if (value === "any" || value === "yes" || value === "no") {
                setFlags(value);
                resetPage();
              }
            }}
          >
            <SelectTrigger aria-label="Data flags">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="yes">Has flags</SelectItem>
              <SelectItem value="no">No flags</SelectItem>
            </SelectContent>
          </Select>
        </Filter>
        <Filter label="Case status">
          <Select
            items={STATUS_ITEMS}
            value={caseStatus}
            onValueChange={(value) => {
              if (
                value === "any" ||
                value === "none" ||
                value === "in_progress" ||
                value === "proposed" ||
                value === "agreed" ||
                value === "declined" ||
                value === "undecided"
              ) {
                setCaseStatus(value);
                resetPage();
              }
            }}
          >
            <SelectTrigger aria-label="Case status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any status</SelectItem>
              <SelectItem value="none">No case</SelectItem>
              {(Object.keys(CASE_STATUS_LABEL) as CaseStatus[]).map((status) => (
                <SelectItem key={status} value={status}>
                  {CASE_STATUS_LABEL[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Filter>
        <Filter label="Minimum months saved">
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={minMonthsText}
            placeholder="Any"
            aria-label="Minimum months saved"
            className="w-28"
            onChange={(event) => {
              setMinMonthsText(event.target.value);
              resetPage();
            }}
          />
        </Filter>
        <Filter label="Sort">
          <Select
            items={SORT_ITEMS}
            value={sort}
            onValueChange={(value) => {
              if (
                value === "months" ||
                value === "interest" ||
                value === "last_contacted" ||
                value === "days_until_ready"
              ) {
                setSort(value);
                resetPage();
              }
            }}
          >
            <SelectTrigger aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="months">Months saved</SelectItem>
              <SelectItem value="interest">Interest saved</SelectItem>
              <SelectItem value="last_contacted">Last contacted</SelectItem>
              <SelectItem value="days_until_ready">Days until ready</SelectItem>
            </SelectContent>
          </Select>
        </Filter>
        {filtersActive ? (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          tab={tab}
          filteredOut={unfilteredOnTab > 0}
          readyDate={readyDate}
          onWaiting={() => {
            setTab("waiting");
            resetPage();
          }}
          onClear={clearFilters}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Household</TableHead>
                <TableHead>Months saved</TableHead>
                <TableHead>Interest saved</TableHead>
                <TableHead>Best plan</TableHead>
                <TableHead>Payment alert</TableHead>
                <TableHead>Eligible products</TableHead>
                <TableHead>Data flags</TableHead>
                <TableHead>Case status</TableHead>
                <TableHead>Last contacted</TableHead>
                {tab === "waiting" ? <TableHead>Ready date</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow
                  key={row.householdId}
                  data-testid={`opportunity-${row.householdId}`}
                  tabIndex={0}
                  className="cursor-pointer"
                  onPointerDown={(event) => {
                    event.currentTarget.dataset.pending = "true";
                  }}
                  onClick={() => router.push(`/households/${row.householdId}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") router.push(`/households/${row.householdId}`);
                  }}
                >
                  <TableCell>
                    <HouseholdLink householdId={row.householdId} name={row.name} />
                    <div className="text-xs text-muted-foreground">{row.householdId}</div>
                  </TableCell>
                  <TableCell className={row.noAction ? "text-muted-foreground" : undefined}>
                    <SavedCell
                      value={monthsSavedLabel(row)}
                      mark={row.updatedInCase}
                      detail={
                        row.updatedInCase
                          ? `Nightly best: ${row.nightlyMonthsLabel}`
                          : row.monthsSaved === "from never"
                            ? neverReason(row)
                            : null
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <SavedCell
                      value={interestSavedLabel(row)}
                      mark={row.updatedInCase}
                      detail={
                        row.updatedInCase
                          ? `Nightly best: ${row.nightlyInterestLabel}`
                          : row.monthsSaved === "from never"
                            ? neverReason(row)
                            : null
                      }
                    />
                  </TableCell>
                  <TableCell>{row.planType}</TableCell>
                  <TableCell>
                    <PaymentDot
                      alert={row.alert}
                      label={paymentAlertText(row.currentMonthly, row.bestMonthly, row.paymentChangePct)}
                    />
                  </TableCell>
                  <TableCell>
                    {row.products.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <span>{row.products.join(", ")}</span>
                    )}
                    {row.noOfferReason ? (
                      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{row.noOfferReason}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.flags.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger
                          type="button"
                          aria-label={row.flags.map((flag) => FLAG_LABEL[flag]).join(". ")}
                          className="inline-flex items-center gap-1 text-payment-amber"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <Flag className="size-4" />
                          <span className="text-xs tabular-nums">{row.flags.length}</span>
                        </TooltipTrigger>
                        <TooltipContent className="block max-w-xs">
                          <ul className="flex list-disc flex-col gap-1 pl-4 text-left">
                            {row.flags.map((flag) => (
                              <li key={flag}>{FLAG_LABEL[flag]}</li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.caseStatus ? (
                      <Badge variant="outline">{CASE_STATUS_LABEL[row.caseStatus]}</Badge>
                    ) : (
                      <span className="text-muted-foreground">No case</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.lastContacted ? formatDate(row.lastContacted) : "Not contacted yet"}
                  </TableCell>
                  {tab === "waiting" ? (
                    <TableCell>{row.readyDate ? formatDate(row.readyDate) : "—"}</TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {start + 1}–{start + visible.length} of {rows.length}
            </p>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#opportunities"
                    aria-disabled={currentPage === 1}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      setPage(Math.max(1, currentPage - 1));
                    }}
                  />
                </PaginationItem>
                {pageItems(currentPage, pageCount).map((item, index) =>
                  item === "gap" ? (
                    <PaginationItem key={`gap-${index}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <PaginationLink
                        href="#opportunities"
                        isActive={item === currentPage}
                        onClick={(event) => {
                          event.preventDefault();
                          setPage(item);
                        }}
                      >
                        {item}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationNext
                    href="#opportunities"
                    aria-disabled={currentPage === pageCount}
                    className={currentPage === pageCount ? "pointer-events-none opacity-50" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      setPage(Math.min(pageCount, currentPage + 1));
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function EmptyState({
  tab,
  filteredOut,
  readyDate,
  onWaiting,
  onClear,
}: {
  tab: OpportunityTab;
  filteredOut: boolean;
  readyDate: string | null;
  onWaiting: () => void;
  onClear: () => void;
}) {
  if (filteredOut) {
    return (
      <Alert>
        <AlertTitle>No households match these filters</AlertTitle>
        <AlertDescription>
          <Button variant="link" className="h-auto px-0" onClick={onClear}>
            Clear filters
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (tab === "ready") {
    return (
      <Alert>
        <AlertTitle>No households are ready for outreach</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-1">
          <span>{readyDate ? `Next ready date: ${formatDate(readyDate)}.` : "No upcoming ready date."}</span>
          <Button variant="link" className="h-auto px-0" onClick={onWaiting}>
            Waiting
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (tab === "waiting") {
    return (
      <Alert>
        <AlertTitle>No households are waiting</AlertTitle>
      </Alert>
    );
  }
  return (
    <Alert>
      <AlertTitle>No progress checks are due</AlertTitle>
    </Alert>
  );
}
