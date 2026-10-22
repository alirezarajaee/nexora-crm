// Shared chart primitives for dashboard & reports views.
// Recharts + literal hex palette; SVG text colors follow the theme CSS vars.

"use client";

import { formatCompact, formatNumber } from "@/lib/format";
import type { Locale, NamedValue } from "@/types/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

export const CHART_COLORS = {
  violet: "#4F46E5",
  cyan: "#0EA5E9",
  green: "#10B981",
  amber: "#F59E0B",
  red: "#F43F5E",
  emerald: "#10B981",
  slate: "#64748B",
  orange: "#F97316",
  sky: "#0EA5E9",
} as const;

const TICK_FILL = "var(--muted-foreground)";
const GRID_STROKE = "var(--border)";

export const chartAxisProps = {
  tick: { fontSize: 11, fill: TICK_FILL },
  axisLine: false as const,
  tickLine: false as const,
};

export const chartGridProps = {
  strokeDasharray: "3 3",
  stroke: GRID_STROKE,
  strokeOpacity: 0.8,
  vertical: false as const,
};

/** Short localized day+month label for ISO "YYYY-MM-DD" ticks. */
export function shortDateTick(iso: string, locale: Locale): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
    day: "numeric",
    month: "short",
  }).format(d);
}

export interface TooltipEntry {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  locale: Locale;
  valueFormatter?: (v: number) => string;
  labelFormatter?: (v: string) => string;
  /** Optional extra rows derived from the datum (e.g. value sum for stage bars). */
  footerRows?: (payload: Record<string, unknown>) => { label: string; value: string }[];
}

/** Localized tooltip content — pass as <Tooltip content={<ChartTooltip locale={locale} .../>} />. */
export function ChartTooltip({
  active,
  payload,
  label,
  locale,
  valueFormatter,
  labelFormatter,
  footerRows,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const fmt = valueFormatter ?? ((v: number) => formatNumber(v, locale));
  const extras = footerRows && payload[0]?.payload ? footerRows(payload[0].payload) : [];
  return (
    <div
      dir="auto"
      className="min-w-32 rounded-md border border-border/80 bg-popover/95 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-sm"
      role="status"
    >
      {label !== undefined && label !== "" ? (
        <p className="mb-1 font-medium text-foreground">
          {labelFormatter ? labelFormatter(String(label)) : String(label)}
        </p>
      ) : null}
      <div className="space-y-0.5">
        {payload.map((p, i) => {
          const v = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color ?? CHART_COLORS.violet }} aria-hidden="true" />
              <span className="text-muted-foreground">{p.name}</span>
              <span className="ms-auto ps-3 font-semibold tabular-nums text-foreground" dir="ltr">
                {fmt(Number(v))}
              </span>
            </div>
          );
        })}
        {extras.map((row) => (
          <div key={row.label} className="flex items-center gap-2 border-t border-border pt-1">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ms-auto font-semibold tabular-nums text-foreground" dir="ltr">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Card wrapper for a single chart: title + fixed-height body or empty placeholder. */
export function ChartCard({
  title,
  empty,
  className,
  children,
}: {
  title: string;
  empty: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card className={cn("border-border bg-card", className)}>
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-medium text-foreground">{title}</h3>
        {empty ? (
          <div className="h-64">
            <ChartEmpty label={t("reports.empty")} />
          </div>
        ) : (
          <div className="h-64" dir="ltr" role="img" aria-label={title}>
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Placeholder rendered instead of a chart when the series has no data. */
export function ChartEmpty({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

/**
 * Resolve a NamedValue label:
 * - "stage:<key>" → user-editable stage name (returned as-is)
 * - localized keys ("enums.*", "dashboard.charts.*", "reports.*") → t(key, {defaultValue: name})
 * - no key (user content, e.g. loss reasons) → name as-is
 */
export function namedValueLabel(
  nv: NamedValue,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  const key = nv.key ?? "";
  if (!key || key.startsWith("stage:")) return nv.name;
  return t(key, { defaultValue: nv.name });
}

export function sumSeries(points: { value: number }[]): number {
  return points.reduce((acc, p) => acc + (Number(p.value) || 0), 0);
}

/** Compact localized number for Y-axis ticks. */
export function compactTick(value: number, locale: Locale): string {
  return formatCompact(value, locale);
}

/** Simple legend under donut charts. */
export function ChartLegend({
  items,
  className,
}: {
  items: { label: string; color: string; value?: number; locale?: Locale }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: it.color }} aria-hidden="true" />
          <span>{it.label}</span>
          {it.value !== undefined && it.locale ? (
            <span className="font-semibold tabular-nums text-foreground" dir="ltr">
              {formatNumber(it.value, it.locale)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
