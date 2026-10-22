"use client";

import { useTranslation } from "react-i18next";
import { Radar } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { AppShell } from "@/features/shell/app-shell";
import { AuthScreen } from "@/features/auth/auth-screen";
import { useAuthBootstrap } from "@/features/shell/use-auth-bootstrap";
import { LoadingState } from "@/components/shared/states";

import { OverviewView } from "@/features/dashboard/overview-view";
import { RadarView } from "@/features/radar/radar-view";
import { LeadsView } from "@/features/leads/leads-view";
import { ContactsView } from "@/features/contacts/contacts-view";
import { CompaniesView } from "@/features/companies/companies-view";
import { DealsView } from "@/features/deals/deals-view";
import { TasksView } from "@/features/tasks/tasks-view";
import { CalendarView } from "@/features/calendar/calendar-view";
import { ActivitiesView } from "@/features/activities/activities-view";
import { ReportsView } from "@/features/reports/reports-view";
import { AutomationView } from "@/features/automation/automation-view";
import { SettingsView } from "@/features/settings/settings-view";

function ViewRouter() {
  const view = useAppStore((s) => s.view);
  const { t } = useTranslation();
  switch (view) {
    case "overview":
      return <OverviewView />;
    case "radar":
      return <RadarView />;
    case "leads":
      return <LeadsView />;
    case "contacts":
      return <ContactsView />;
    case "companies":
      return <CompaniesView />;
    case "deals":
      return <DealsView />;
    case "tasks":
      return <TasksView />;
    case "calendar":
      return <CalendarView />;
    case "activities":
      return <ActivitiesView />;
    case "reports":
      return <ReportsView />;
    case "automation":
      return <AutomationView />;
    case "settings":
      return <SettingsView />;
    default:
      return <p className="text-muted-foreground">{t("common.noData")}</p>;
  }
}

export default function Home() {
  useAuthBootstrap(); // TEMPORARY verification patch (task 3-c) — REVERTED after testing
  const authLoaded = useAppStore((s) => s.authLoaded);
  const user = useAppStore((s) => s.user);

  if (!authLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-4 p-6">
          <div className="flex items-center justify-center gap-2">
            <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-xl bg-primary">
              <Radar className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <span className="text-lg font-bold tracking-tight">NEXORA CRM</span>
          </div>
          <LoadingState rows={2} />
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <AppShell>
      <ViewRouter />
    </AppShell>
  );
}
