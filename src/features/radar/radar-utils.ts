// Shared radar helpers (view link parsing + bilingual explanation params).
// Backend emits structured RadarItems; explanations are interpolated client-side
// so numbers/dates/money are localized BEFORE i18next injects them.

import type { Locale, RadarItem, RadarSeverity } from "@/types/api";
import type { AppView } from "@/store/app-store";
import { formatMoney, formatNumber } from "@/lib/format";

export const RADAR_RULE_KEYS = [
  "OVERDUE_TASK",
  "TASK_DUE_TODAY",
  "LEAD_INACTIVE",
  "DEAL_INACTIVE",
  "DEAL_STAGE_STAGNANT",
  "CONTACT_FOLLOWUP_DUE",
  "HIGH_VALUE_CLOSING",
  "MISSING_INFO",
] as const;

export const RADAR_SEVERITIES: RadarSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** Literal hex colors used for severity accents (chips + card borders). */
export const RADAR_SEVERITY_COLORS: Record<RadarSeverity, string> = {
  CRITICAL: "#F43F5E",
  HIGH: "#F97316",
  MEDIUM: "#F59E0B",
  LOW: "#0EA5E9",
};

const VALID_VIEWS: AppView[] = [
  "overview",
  "radar",
  "leads",
  "contacts",
  "companies",
  "deals",
  "tasks",
  "calendar",
  "activities",
  "reports",
  "automation",
  "settings",
];

/** Parse a backend actionLink like "leads?leadId=xxx" into a view + params. */
export function parseActionLink(link: string): { view: AppView; params: Record<string, string> } | null {
  if (!link) return null;
  const [rawView, qs] = link.split("?");
  const view = rawView.trim() as AppView;
  if (!VALID_VIEWS.includes(view)) return null;
  const params: Record<string, string> = {};
  if (qs) {
    try {
      new URLSearchParams(qs).forEach((v, k) => {
        params[k] = v;
      });
    } catch {
      // malformed query — ignore, still navigate to the view
    }
  }
  return { view, params };
}

/**
 * Build display-ready interpolation params for `radar.rules.<key>.explanation`.
 * i18next injects raw values, so transform first:
 * - numbers → localized digits (formatNumber)
 * - money ("value") → formatMoney
 * - "missing" (MISSING_INFO rule) → localized via radar.missing.*
 */
export function buildRadarExplanationParams(
  item: RadarItem,
  locale: Locale,
  currency: string,
  t: (key: string, params?: Record<string, unknown>) => string
): Record<string, string | number> {
  const out: Record<string, string | number> = { title: item.entity.title };
  for (const [k, raw] of Object.entries(item.params)) {
    if (k === "missing" && typeof raw === "string") {
      out[k] = t(`radar.missing.${raw}`);
    } else if (k === "value" && typeof raw === "number") {
      out[k] = formatMoney(raw, locale, currency);
    } else if (typeof raw === "number") {
      out[k] = formatNumber(raw, locale);
    } else {
      out[k] = raw;
    }
  }
  return out;
}

/** Localized one-line explanation for a radar item. */
export function radarExplanation(
  item: RadarItem,
  locale: Locale,
  currency: string,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  return t(`radar.rules.${item.ruleKey}.explanation`, buildRadarExplanationParams(item, locale, currency, t));
}
