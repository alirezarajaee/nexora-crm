"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { Priority } from "@/types/api";
import { cn } from "@/lib/utils";

// ---- Localized enum badges (stable internal keys → translated labels) ----

const PRIORITY_STYLES: Record<Priority, string> = {
  LOW: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20",
  MEDIUM: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  HIGH: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={cn("font-medium", PRIORITY_STYLES[priority])}>
      {t(`enums.priority.${priority}`)}
    </Badge>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25",
  HIGH: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  MEDIUM: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  LOW: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={cn("font-medium", SEVERITY_STYLES[severity])}>
      {t(`enums.severity.${severity}`)}
    </Badge>
  );
}

const LEAD_STATUS_STYLES: Record<string, string> = {
  NEW: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  CONTACTED: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  QUALIFIED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  DISQUALIFIED: "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20",
  CONVERTED: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
};

export function LeadStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={cn("font-medium", LEAD_STATUS_STYLES[status])}>
      {t(`enums.leadStatus.${status}`)}
    </Badge>
  );
}

export function TagBadges({
  tags,
  max = 3,
}: {
  tags?: { id: string; name: string; color: string }[];
  max?: number;
}) {
  if (!tags || tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
          style={{
            borderColor: `${tag.color}55`,
            backgroundColor: `${tag.color}18`,
            color: tag.color,
          }}
        >
          {tag.name}
        </span>
      ))}
      {rest > 0 ? (
        <span className="text-[11px] text-muted-foreground">+{rest}</span>
      ) : null}
    </span>
  );
}
