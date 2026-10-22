"use client";

import { useTranslation } from "react-i18next";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/types/api";
import { formatNumber } from "@/lib/format";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  emptyState,
  rowActions,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyState?: React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => (
                <TableHead key={c.key} className={c.headerClassName}>
                  {c.header}
                </TableHead>
              ))}
              {rowActions ? (
                <TableHead className="w-12 print:hidden">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={(row as { id?: string }).id ?? idx}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.className}>
                    {c.cell(row)}
                  </TableCell>
                ))}
                {rowActions ? <TableCell className="print:hidden">{rowActions(row)}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  locale,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <p className="text-sm text-muted-foreground">{t("common.pagination.rowsCount", { count: formatNumber(total, locale) })}</p>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t("common.pagination.pageOf", {
            page: formatNumber(page, locale),
            total: formatNumber(totalPages, locale),
          })}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("common.pagination.prev")}
        >
          <PrevIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("common.pagination.next")}
        >
          <NextIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
