"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  LayoutDashboard, Radar, Users, Contact, Building2, KanbanSquare,
  ListTodo, CalendarDays, Activity, BarChart3, Zap, Settings,
  Search, Bell, Sun, Moon, Languages, LogOut, Menu, Plus,
  ChevronsUpDown, Check, UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, clearStoredToken } from "@/lib/client-api";
import { useAppStore, type AppView } from "@/store/app-store";
import { useAuthBootstrap } from "./use-auth-bootstrap";
import { formatRelative } from "@/lib/format";
import type { NotificationItem, SearchResults } from "@/types/api";

const NAV_ITEMS: { view: AppView; icon: React.ComponentType<{ className?: string }>; labelKey: string }[] = [
  { view: "overview", icon: LayoutDashboard, labelKey: "nav.overview" },
  { view: "radar", icon: Radar, labelKey: "nav.radar" },
  { view: "leads", icon: Users, labelKey: "nav.leads" },
  { view: "contacts", icon: Contact, labelKey: "nav.contacts" },
  { view: "companies", icon: Building2, labelKey: "nav.companies" },
  { view: "deals", icon: KanbanSquare, labelKey: "nav.deals" },
  { view: "tasks", icon: ListTodo, labelKey: "nav.tasks" },
  { view: "calendar", icon: CalendarDays, labelKey: "nav.calendar" },
  { view: "activities", icon: Activity, labelKey: "nav.activities" },
  { view: "reports", icon: BarChart3, labelKey: "nav.reports" },
  { view: "automation", icon: Zap, labelKey: "nav.automation" },
  { view: "settings", icon: Settings, labelKey: "nav.settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { authLoaded } = useAuthBootstrap();
  const view = useAppStore((s) => s.view);
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const memberships = useAppStore((s) => s.memberships);
  const currentWorkspaceId = useAppStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useAppStore((s) => s.setCurrentWorkspaceId);
  const locale = useAppStore((s) => s.locale);
  const switchLocale = useAppStore((s) => s.switchLocale);
  const setAuthState = useAppStore((s) => s.setAuthState);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => setMounted(true), []);

  // Ctrl+K global search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Notifications polling
  useEffect(() => {
    if (!user || !currentWorkspaceId) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get<{ items: NotificationItem[]; unreadCount: number }>(
          "/notifications",
          undefined,
          currentWorkspaceId
        );
        if (alive) {
          setNotifications(res.items);
          setUnreadCount(res.unreadCount);
        }
      } catch {
        // silent
      }
    };
    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [user, currentWorkspaceId]);

  // Debounced search
  useEffect(() => {
    if (!searchOpen) return;
    if (searchQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<SearchResults>("/search", { q: searchQuery.trim() }, currentWorkspaceId ?? undefined);
        setSearchResults(res);
      } catch {
        setSearchResults(null);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQuery, searchOpen, currentWorkspaceId]);

  const currentMembership = useMemo(
    () => memberships.find((m) => m.workspaceId === currentWorkspaceId) ?? memberships[0] ?? null,
    [memberships, currentWorkspaceId]
  );

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore
    }
    clearStoredToken();
    setAuthState(null, []);
    toast.success(t("auth.logoutSuccess"));
  }

  async function createWorkspace() {
    const name = window.prompt(t("shell.workspaceNameLabel"));
    if (!name || !name.trim()) return;
    try {
      const res = await api.post<{ workspaceId: string; memberships: typeof memberships }>("/workspaces", {
        name: name.trim(),
        locale,
      });
      setAuthState(user, res.memberships);
      setCurrentWorkspaceId(res.workspaceId);
      toast.success(t("shell.createdWorkspace"));
    } catch {
      toast.error(t("errors.generic"));
    }
  }

  async function markAllRead() {
    try {
      await api.post("/notifications", { all: true }, currentWorkspaceId ?? undefined);
      setNotifications((ns) => ns.map((n) => ({ ...n, readAt: new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
      // silent
    }
  }

  function goToResult(group: string, id: string) {
    setSearchOpen(false);
    setSearchQuery("");
    switch (group) {
      case "leads":
        navigate("leads", { params: { leadId: id } });
        break;
      case "contacts":
        navigate("contacts", { params: { contactId: id } });
        break;
      case "companies":
        navigate("companies", { params: { companyId: id } });
        break;
      case "deals":
        navigate("deals", { params: { dealId: id } });
        break;
      case "tasks":
        navigate("tasks", { params: { taskId: id } });
        break;
    }
  }

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
          <Radar className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className="text-sm font-bold tracking-tight">NEXORA</span>
      </div>

      {/* Workspace switcher */}
      <div className="px-3 pb-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 w-full justify-between gap-2 font-normal text-muted-foreground hover:text-foreground" aria-label={t("shell.workspaceSelector")}>
              <span className="min-w-0 truncate">
                {currentMembership?.workspace.name ?? t("common.workspace")}
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>{t("shell.workspaceSelector")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {memberships.map((m) => (
              <DropdownMenuItem
                key={m.workspaceId}
                onClick={() => {
                  setCurrentWorkspaceId(m.workspaceId);
                  toast.success(t("shell.switchedWorkspace"));
                }}
              >
                <Check
                  className={cn("me-1 h-4 w-4", m.workspaceId === currentWorkspaceId ? "opacity-100" : "opacity-0")}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{m.workspace.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={createWorkspace}>
              <Plus className="me-1 h-4 w-4" aria-hidden="true" />
              {t("shell.createWorkspace")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label={t("a11y.sidebar")}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = view === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => {
                navigate(item.view);
                setMobileOpen(false);
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "")} aria-hidden="true" />
              <span className="truncate">{t(item.labelKey)}</span>
              {item.view === "radar" && unreadCount > 0 ? (
                <Badge className="ms-auto h-5 bg-primary/10 px-1.5 text-[10px] font-medium text-primary" variant="secondary">
                  {unreadCount}
                </Badge>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
            {(user?.name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{currentMembership ? t(`enums.role.${currentMembership.role}`) : ""}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleLogout} aria-label={t("common.logout")}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-e border-border bg-sidebar lg:block">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="fixed bottom-4 start-4 z-40 h-11 w-11 rounded-full bg-card shadow-md lg:hidden" aria-label={t("a11y.openMenu")}>
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent side={locale === "fa" ? "right" : "left"} className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">{t("shell.mobileMenu")}</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-border bg-card">
          <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/30 sm:max-w-md"
              aria-label={t("a11y.openSearch")}
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("shell.globalSearchPlaceholder")}</span>
              <kbd className="ms-auto hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
                Ctrl K
              </kbd>
            </button>

            <div className="ms-auto flex items-center gap-1">
              {/* Language switcher */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 gap-1.5" aria-label={t("a11y.switchLanguage")}>
                    <Languages className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{locale === "fa" ? "فارسی" : "English"}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => switchLocale("fa")}
                    aria-current={locale === "fa"}
                  >
                    <Check className={cn("me-1 h-4 w-4", locale === "fa" ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    فارسی
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => switchLocale("en")}
                    aria-current={locale === "en"}
                  >
                    <Check className={cn("me-1 h-4 w-4", locale === "en" ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    English
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Theme toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={t("a11y.toggleTheme")}
              >
                {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

              {/* Notifications */}
              <Popover open={notifOpen} onOpenChange={setNotifOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label={t("a11y.openNotifications")}>
                    <Bell className="h-4 w-4" aria-hidden="true" />
                    {unreadCount > 0 ? (
                      <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                        {unreadCount}
                      </span>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0">
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <p className="text-sm font-semibold">{t("shell.notifications")}</p>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
                      {t("shell.markAllRead")}
                    </Button>
                  </div>
                  <Separator />
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("shell.noNotifications")}</p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            if (n.link) {
                              const [viewName, param] = n.link.split("?");
                              const valid: AppView[] = ["overview","radar","leads","contacts","companies","deals","tasks","calendar","activities","reports","automation","settings"];
                              if (valid.includes(viewName as AppView)) {
                                const params: Record<string, string> = {};
                                if (param) {
                                  const [k, v] = param.split("=");
                                  if (k && v) params[k] = v;
                                }
                                navigate(viewName as AppView, { params });
                              }
                            }
                          }}
                          className={cn(
                            "block w-full border-b border-border/50 px-3 py-2.5 text-start transition-colors last:border-0 hover:bg-accent",
                            !n.readAt && "bg-primary/5"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {!n.readAt ? <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
                            <p className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</p>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {formatRelative(n.createdAt, locale, t)}
                            </span>
                          </div>
                          {n.body ? <p className="mt-0.5 truncate ps-4 text-xs text-muted-foreground">{n.body}</p> : null}
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("a11y.userMenu")}>
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>
                    <p className="truncate">{user?.name}</p>
                    <p className="truncate text-xs font-normal text-muted-foreground">{user?.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("settings", { params: { tab: "account" } })}>
                    <Settings className="me-1 h-4 w-4" aria-hidden="true" />
                    {t("shell.accountSettings")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="me-1 h-4 w-4" aria-hidden="true" />
                    {t("common.logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 pb-24 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      {/* Global search dialog */}
      {searchOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
          onClick={() => setSearchOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={t("shell.globalSearchPlaceholder")}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("shell.globalSearchPlaceholder")}
                className="h-12 border-0 bg-transparent focus-visible:ring-0"
                aria-label={t("shell.globalSearchPlaceholder")}
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {searchQuery.trim().length < 2 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("shell.minChars")}</p>
              ) : searching ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("shell.searching")}</p>
              ) : !searchResults || searchResults.total === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t("search.noResults", { query: searchQuery })}
                </p>
              ) : (
                <>
                  {([
                    ["leads", searchResults.leads, t("shell.groupLeads")],
                    ["contacts", searchResults.contacts, t("shell.groupContacts")],
                    ["companies", searchResults.companies, t("shell.groupCompanies")],
                    ["deals", searchResults.deals, t("shell.groupDeals")],
                    ["tasks", searchResults.tasks, t("shell.groupTasks")],
                  ] as const).map(([group, items, label]) =>
                    items.length > 0 ? (
                      <div key={group} className="mb-1">
                        <p className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{label}</p>
                        {items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => goToResult(group, item.id)}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-accent"
                          >
                            <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                            {item.subtitle ? (
                              <span className="max-w-40 truncate text-xs text-muted-foreground">{item.subtitle}</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
