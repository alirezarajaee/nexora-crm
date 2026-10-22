import type { Metadata, Viewport } from "next";
// Self-hosted Vazirmatn variable font (weights 100–900, Persian + Latin coverage).
// Bundled by Next.js — no remote font requests at runtime.
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AppProviders } from "@/components/providers";

export const metadata: Metadata = {
  title: "NEXORA CRM",
  description:
    "NEXORA CRM — Premium bilingual (Persian/English) CRM for freelancers and small teams. Built by Alireza Rajaee.",
  keywords: ["CRM", "NEXORA", "فارسی", "English", "sales pipeline", "follow-up radar"],
  authors: [{ name: "Alireza Rajaee", url: "https://github.com/alirezarajaee" }],
  icons: { icon: "/logo.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1117" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground min-h-screen flex flex-col">
        <AppProviders>{children}</AppProviders>
        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  );
}
