import type { Locale } from "@/types/api";

// ---- Locale-aware formatting helpers ----
// Internal numeric values are never altered; formatting is display-only.
// Persian UI renders the Jalali (Solar Hijri) calendar via Intl "fa-IR"
// (which defaults to the Persian calendar); English uses "en-US" Gregorian.

const TZ_DEFAULT = "Asia/Tehran";

export function formatDate(value: string | Date | null | undefined, locale: Locale, tz?: string): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: tz || TZ_DEFAULT,
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, locale: Locale, tz?: string): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz || TZ_DEFAULT,
  }).format(d);
}

export function formatDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(value);
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  IRR: "IRT", // Toman display
  GBP: "£",
  AED: "AED",
  TRY: "₺",
};

export function formatMoney(value: number, locale: Locale, currency = "USD"): string {
  if (currency === "IRR") {
    // Persian Toman style: localized number + تومان
    return `${formatNumber(value, locale)} ${locale === "fa" ? "تومان" : "Toman"}`;
  }
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${sym}${formatNumber(value, locale)}`;
}

export function formatCompact(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number, locale: Locale): string {
  return `${formatNumber(Math.round(value * 10) / 10, locale)}%`;
}

export function formatRelative(
  value: string | Date | null | undefined,
  locale: Locale,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = d.getTime() - Date.now();
  const absMinutes = Math.abs(Math.floor(diffMs / 60000));
  const future = diffMs > 0;
  if (absMinutes < 1) return t("time.justNow");
  if (absMinutes < 60) {
    return future ? t("time.inMinutes", { count: absMinutes }) : t("time.minutesAgo", { count: absMinutes });
  }
  const absHours = Math.floor(absMinutes / 60);
  if (absHours < 24) {
    return future ? t("time.inHours", { count: absHours }) : t("time.hoursAgo", { count: absHours });
  }
  const absDays = Math.floor(absHours / 24);
  if (absDays < 30) {
    return future ? t("time.inDays", { count: absDays }) : t("time.daysAgo", { count: absDays });
  }
  return formatDate(d, locale);
}

/** Parse a user-entered numeric string independent of display locale (persian digits supported). */
export function parseLocalizedNumber(input: string): number | null {
  if (!input) return null;
  const normalized = input
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[,،٬\s]/g, "")
    .replace(/[٫]/g, ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function isOverdue(dueAt: string | Date | null | undefined): boolean {
  if (!dueAt) return false;
  const d = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

export function isToday(value: string | Date | null | undefined): boolean {
  if (!value) return false;
  const d = typeof value === "string" ? new Date(value) : value;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
