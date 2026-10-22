"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Cog,
  Info,
  ListTodo,
  Mail,
  Phone,
  Plus,
  Repeat,
  StickyNote,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { FilterBar, MultiSelectFilter, type MultiOption } from "@/components/shared/filters";
import { TablePagination } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/client-api";
import { useApiToast, useMemberOptions, useLocaleTz, useWorkspaceId } from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Activity, ActivityType, Contact, Deal, Paginated } from "@/types/api";

const PAGE_SIZE = 20;

const ALL_TYPES: ActivityType[] = [
  "CALL",
  "MEETING",
  "EMAIL",
  "NOTE",
  "TASK_EVENT",
  "STAGE_CHANGE",
  "CONVERSION",
  "SYSTEM",
];
const LOGGABLE_TYPES: ActivityType[] = ["CALL", "MEETING", "EMAIL", "NOTE"];

const TYPE_ICONS: Record<ActivityType, LucideIcon> = {
  CALL: Phone,
  MEETING: Users,
  EMAIL: Mail,
  NOTE: StickyNote,
  TASK_EVENT: ListTodo,
  STAGE_CHANGE: ArrowRightLeft,
  CONVERSION: Repeat,
  SYSTEM: Cog,
};

// Calm minimal: activity types carry no good/bad semantics, so all icon
// surfaces share one neutral treatment instead of decorative multicolor tiles.
const TYPE_ICON_STYLES: Record<ActivityType, string> = {
  CALL: "bg-muted text-muted-foreground",
  MEETING: "bg-muted text-muted-foreground",
  EMAIL: "bg-muted text-muted-foreground",
  NOTE: "bg-muted text-muted-foreground",
  TASK_EVENT: "bg-muted text-muted-foreground",
  STAGE_CHANGE: "bg-muted text-muted-foreground",
  CONVERSION: "bg-muted text-muted-foreground",
  SYSTEM: "bg-muted text-muted-foreground",
};

interface LogFormState {
  type: ActivityType;
  title: string;
  content: string;
  relatedKind: "none" | "contact" | "deal";
  contactId: string;
  dealId: string;
}

const DEFAULT_LOG_FORM: LogFormState = {
  type: "CALL",
  title: "",
  content: "",
  relatedKind: "none",
  contactId: "",
  dealId: "",
};

// ================= Log activity dialog =================

function LogActivityDialog({
  open,
  onOpenChange,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: LogFormState) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const workspaceId = useWorkspaceId();
  const [form, setForm] = useState<LogFormState>(DEFAULT_LOG_FORM);

  // Reset the form each time the dialog opens (state-during-render pattern)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setForm(DEFAULT_LOG_FORM);
  }

  const contactsQuery = useQuery({
    queryKey: ["contacts-options", workspaceId],
    queryFn: () => api.get<Paginated<Contact>>("/contacts", { pageSize: 100 }, workspaceId),
    enabled: open && Boolean(workspaceId),
    staleTime: 30_000,
  });
  const dealsQuery = useQuery({
    queryKey: ["deals-options", workspaceId],
    queryFn: () => api.get<Paginated<Deal>>("/deals", { pageSize: 100 }, workspaceId),
    enabled: open && Boolean(workspaceId),
    staleTime: 30_000,
  });

  const patch = (partial: Partial<LogFormState>) => setForm((f) => ({ ...f, ...partial }));

  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("activities.logActivity")}
      loading={saving}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="activity-type">{t("activities.field.type")}</Label>
          <Select
            value={form.type}
            onValueChange={(v) => patch({ type: v as ActivityType })}
          >
            <SelectTrigger id="activity-type" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOGGABLE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`enums.activityType.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="activity-title">{t("common.title")} *</Label>
          <Input
            id="activity-title"
            className="h-9"
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            maxLength={160}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="activity-content">{t("activities.field.content")}</Label>
          <Textarea
            id="activity-content"
            className="min-h-20"
            value={form.content}
            onChange={(e) => patch({ content: e.target.value })}
            maxLength={5000}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="activity-related-kind">{t("activities.field.relatedTo")}</Label>
            <Select
              value={form.relatedKind}
              onValueChange={(v) =>
                patch({
                  relatedKind: v as LogFormState["relatedKind"],
                  contactId: "",
                  dealId: "",
                })
              }
            >
              <SelectTrigger id="activity-related-kind" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("common.none")}</SelectItem>
                <SelectItem value="contact">{t("nav.contacts")}</SelectItem>
                <SelectItem value="deal">{t("nav.deals")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="activity-related-item">{t("common.selectPlaceholder")}</Label>
            {form.relatedKind === "none" ? (
              <Select disabled value="none">
                <SelectTrigger id="activity-related-item" className="h-9">
                  <SelectValue placeholder={t("common.none")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("common.none")}</SelectItem>
                </SelectContent>
              </Select>
            ) : form.relatedKind === "contact" ? (
              <Select
                value={form.contactId}
                onValueChange={(v) => patch({ contactId: v })}
              >
                <SelectTrigger id="activity-related-item" className="h-9">
                  <SelectValue placeholder={t("common.selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {(contactsQuery.data?.items ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select value={form.dealId} onValueChange={(v) => patch({ dealId: v })}>
                <SelectTrigger id="activity-related-item" className="h-9">
                  <SelectValue placeholder={t("common.selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {(dealsQuery.data?.items ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>
    </EntityFormDialog>
  );
}

// ================= Main view =================

function dayKeyOf(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

export function ActivitiesView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const workspaceId = useWorkspaceId();
  const tz = useLocaleTz();
  const memberOptions = useMemberOptions();
  const queryClient = useQueryClient();
  const { apiError } = useApiToast();

  const [types, setTypes] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const query = useQuery({
    queryKey: ["activities", workspaceId, types, userIds, from, to, page],
    queryFn: () =>
      api.get<Paginated<Activity>>(
        "/activities",
        {
          type: types.length ? types : undefined,
          userId: userIds.length ? userIds : undefined,
          from: from || undefined,
          to: to ? `${to}T23:59:59` : undefined,
          page,
          pageSize: PAGE_SIZE,
        },
        workspaceId
      ),
    enabled: Boolean(workspaceId),
    placeholderData: (prev) => prev,
  });

  const createMutation = useMutation({
    mutationFn: (form: LogFormState) =>
      api.post<Activity | { success: false; error: string }>(
        "/activities",
        {
          workspaceId,
          type: form.type,
          title: form.title.trim(),
          content: form.content.trim() || undefined,
          contactId: form.relatedKind === "contact" && form.contactId ? form.contactId : undefined,
          dealId: form.relatedKind === "deal" && form.dealId ? form.dealId : undefined,
        },
        workspaceId
      ),
    onSuccess: (res) => {
      if (res && typeof res === "object" && "success" in res && res.success === false) {
        toast.error(t("errors.NOT_FOUND"));
        return;
      }
      toast.success(t("activities.createdToast"));
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
    onError: (err) => apiError(err),
  });

  const submitLog = (form: LogFormState) => {
    if (!form.title.trim()) {
      toast.error(t("validation.titleRequired"));
      return;
    }
    createMutation.mutate(form);
  };

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  // Group by calendar day (in the workspace timezone)
  const groups = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of items) {
      const key = dayKeyOf(a.createdAt, tz);
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    return Array.from(map.entries());
  }, [items, tz]);

  const typeOptions: MultiOption[] = ALL_TYPES.map((type) => ({
    value: type,
    label: t(`enums.activityType.${type}`),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("activities.title")}
        subtitle={t("activities.subtitle")}
        actions={
          <Button onClick={() => setDialogOpen(true)} className="h-9">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("activities.logActivity")}
          </Button>
        }
      />

      <FilterBar>
        <MultiSelectFilter
          label={t("activities.field.type")}
          options={typeOptions}
          selected={types}
          onChange={(values) => {
            setTypes(values);
            setPage(1);
          }}
          icon={StickyNote}
        />
        <MultiSelectFilter
          label={t("common.owner")}
          options={memberOptions}
          selected={userIds}
          onChange={(values) => {
            setUserIds(values);
            setPage(1);
          }}
          icon={Users}
        />
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            className="h-9 w-36"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            aria-label={t("common.from")}
          />
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            –
          </span>
          <Input
            type="date"
            className="h-9 w-36"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            aria-label={t("common.to")}
          />
        </div>
      </FilterBar>

      {query.isLoading ? (
        <LoadingState rows={6} />
      ) : query.isError ? (
        <ErrorState
          title={t("common.errorStateTitle")}
          description={t("common.errorStateDescription")}
          retryLabel={t("common.retry")}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title={
            types.length || userIds.length || from || to
              ? t("common.emptyFilteredTitle")
              : t("activities.empty")
          }
          description={
            types.length || userIds.length || from || to
              ? t("common.emptyFilteredDescription")
              : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map(([dayKey, dayItems]) => (
            <section key={dayKey} aria-label={formatDate(dayItems[0].createdAt, locale, tz)}>
              <h2 className="mb-3 flex items-center gap-3">
                <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                  {formatDate(dayItems[0].createdAt, locale, tz)}
                </span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </h2>
              <ol className="space-y-3">
                {dayItems.map((activity) => {
                  const Icon = TYPE_ICONS[activity.type] ?? Cog;
                  const relatedName =
                    activity.contact?.name ?? activity.deal?.title ?? activity.lead?.name ?? activity.company?.name ?? null;
                  return (
                    <li
                      key={activity.id}
                      className="flex gap-3 rounded-xl border border-border bg-card p-4"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          TYPE_ICON_STYLES[activity.type]
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{activity.title}</span>
                          <Badge variant="outline" className="text-[11px] font-normal">
                            {t(`enums.activityType.${activity.type}`)}
                          </Badge>
                          {activity.type === "EMAIL" ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="text-muted-foreground transition-colors hover:text-foreground"
                                  aria-label={t("activities.emailNote")}
                                >
                                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-56">
                                {t("activities.emailNote")}
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                          {relatedName ? (
                            <Badge variant="secondary" className="max-w-52 truncate font-normal">
                              {t("activities.related", { entity: relatedName })}
                            </Badge>
                          ) : null}
                        </div>
                        {activity.content ? (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {activity.content}
                          </p>
                        ) : null}
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {activity.user?.name ? t("activities.byUser", { name: activity.user.name }) : null}
                          {activity.user?.name ? " · " : ""}
                          {formatRelative(activity.createdAt, locale, t)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          <TablePagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            locale={locale}
          />
        </div>
      )}

      <LogActivityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={submitLog}
        saving={createMutation.isPending}
      />
    </div>
  );
}
