import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import fa from "./locales/fa.json";
import en from "./locales/en.json";
import type { Locale } from "@/types/api";

export const LOCALES: Locale[] = ["fa", "en"];
export const DEFAULT_LOCALE: Locale = "fa";
export const LANG_STORAGE_KEY = "nexora-lang";

export function readInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === "fa" || stored === "en") return stored;
  } catch {
    // storage unavailable — fall back to default
  }
  return DEFAULT_LOCALE;
}

function directionOf(locale: Locale): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}

export function applyDocumentDirection(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = directionOf(locale);
}

let initialized = false;

export function getI18n(): I18nInstance {
  if (!initialized) {
    void i18next.use(initReactI18next).init({
      resources: {
        fa: { translation: fa },
        en: { translation: en },
      },
      lng: readInitialLocale(),
      fallbackLng: DEFAULT_LOCALE,
      interpolation: { escapeValue: false },
      returnObjects: true,
      react: { useSuspense: false },
    });
    initialized = true;
  }
  return i18next;
}

export function changeLocale(locale: Locale) {
  const i18n = getI18n();
  if (i18n.language !== locale) {
    void i18n.changeLanguage(locale);
  }
  applyDocumentDirection(locale);
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, locale);
  } catch {
    // ignore storage failures
  }
}

export function directionOfLocale(locale: Locale): "rtl" | "ltr" {
  return directionOf(locale);
}
