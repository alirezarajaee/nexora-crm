"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/types/api";

const TONE_CLASSES: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
};

/** Back-compat alias: legacy "violet" tone now maps to the calm primary accent. */
TONE_CLASSES.violet = TONE_CLASSES.primary;
TONE_CLASSES.cyan = TONE_CLASSES.sky;

/**
 * Adaptive value size via container queries: the metric scales with the card's
 * own width (not the viewport), and character-count caps prevent long formatted
 * money values from overflowing. The value is never truncated — if a size still
 * cannot fit (very narrow cards), the text wraps at the currency word instead.
 */
function valueSizeClasses(display: string): string {
  const len = display.length;
  if (len > 18) return "text-base";
  if (len > 14) return "text-base @min-[210px]:text-lg @min-[280px]:text-xl";
  if (len > 9) return "text-base @min-[158px]:text-lg @min-[172px]:text-xl";
  return "text-lg @min-[150px]:text-xl @min-[220px]:text-2xl";
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
  loading,
  locale,
  onClick,
  valueIsRaw,
}: {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof TONE_CLASSES;
  hint?: string;
  loading?: boolean;
  locale: Locale;
  onClick?: () => void;
  valueIsRaw?: boolean;
}) {
  const display: string = valueIsRaw ? String(value) : formatNumber(Number(value), locale);
  return (
    <Card
      className={cn(
        "@container border-border bg-card transition-colors",
        onClick && "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={`${label}: ${display}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          {Icon ? (
            <span
              className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", TONE_CLASSES[tone])}
              aria-hidden="true"
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>
        {loading ? (
          <Skeleton className="mt-2.5 h-7 w-20" />
        ) : (
          <p
            className={cn(
              "mt-2 font-semibold leading-snug tabular-nums",
              valueSizeClasses(display)
            )}
            dir="ltr"
            style={{ textAlign: "start" }}
          >
            {display}
          </p>
        )}
        {hint && !loading ? <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
