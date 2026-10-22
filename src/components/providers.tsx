"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { getI18n, applyDocumentDirection } from "@/i18n";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { Locale } from "@/types/api";
import { TooltipProvider } from "@/components/ui/tooltip";

function DirectionSync() {
  const { i18n } = useTranslation();
  useEffect(() => {
    const sync = (lng: string) => {
      const locale: Locale = lng === "en" ? "en" : "fa";
      applyDocumentDirection(locale);
      document.title = locale === "fa" ? "نکسورا CRM" : "NEXORA CRM";
    };
    sync(i18n.language);
    i18n.on("languageChanged", sync);
    return () => i18n.off("languageChanged", sync);
  }, [i18n]);
  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  const [i18n] = useState(() => getI18n());

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={200}>
            <DirectionSync />
            {children}
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
