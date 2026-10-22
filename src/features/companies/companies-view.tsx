"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Building2,
  ExternalLink,
  Handshake,
  Info,
  ListChecks,
  Loader2,
  Mail,
  MapPin,
  NotebookPen,
  PenLine,
  Phone,
  PhoneCall,
  Plus,
  Repeat,
  Trash2,
  User,
  Users,
} from "lucide-react";

import { useAppStore } from "@/store/app-store";
import {
  useApiToast,
  useLocaleTz,
  useMemberOptions,
  useWorkspaceCurrency,
  useWorkspaceId,
} from "@/hooks/use-workspace";
import { api } from "@/lib/client-api";
import { formatDate, formatMoney, formatNumber, formatRelative } from "@/lib/format";
import type { Activity, Company, Contact, Deal, Paginated, Task } from "@/types/api";

import { PageHeader } from "@/components/shared/page-header";
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
import { TablePagination } from "@/components/shared/data-table";
import { ArchivedToggle, FilterBar, MultiSelectFilter, SearchInput } from "@/components/shared/filters";
import { TagBadges } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PAGE_SIZE = 12;
const UNASSIGNED = "__unassigned__";
const NO_SIZE = "__no_size__";
const KNOWN_SIZES = ["1-10", "10-50", "50-200", "200+"];

interface CompanyDetail extends Company {
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  activities: Activity[];
}

interface CompanyFormState {
  name: string;
  website: string;
  industry: string;
  size: string;
  phone: string;
  country: string;
  address: string;
  ownerId: string;
  notes: string;
}

const EMPTY_FORM: CompanyFormState = {
  name: "",
  website: "",
  industry: "",
  size: "",
  phone: "",
  country: "",
  address: "",
  ownerId: "",
  notes: "",
};

function FormField({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={htmlFor} className="flex items-center gap-1">
        <span className="truncate">{label}</span>
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value == null || value === "" ? "—" : value}</dd>
    </div>
  );
}

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CALL: PhoneCall,
  MEETING: Users,
  EMAIL: Mail,
  NOTE: NotebookPen,
  TASK_EVENT: ListChecks,
  STAGE_CHANGE: Handshake,
  CONVERSION: Repeat,
  SYSTEM: Info,
};

function ActivityTimeline({ activities }: { activities: Activity[] }) {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  if (!activities.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground" role="status">
        {t("activities.empty")}
      </p>
    );
  }
  return (
    <ol className="space-y-4" aria-label={t("companies.tabs.timeline")}>
      {activities.map((a) => {
        const Icon = ACTIVITY_ICONS[a.type] ?? Info;
        const internal = /^[A-Z0-9_]+$/.test(a.title);
        const primary = internal ? t(`enums.activityType.${a.type}`, { defaultValue: a.title }) : a.title;
        return (
          <li key={a.id} className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted/40">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{primary}</p>
              {a.content ? (
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {a.content}
                </p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("activities.byUser", { name: a.user?.name ?? "—" })} · {formatRelative(a.createdAt, locale, t)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

export function CompaniesView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const viewParams = useAppStore((s) => s.viewParams);
  const navigate = useAppStore((s) => s.navigate);
  const workspaceId = useWorkspaceId();
  const currency = useWorkspaceCurrency();
  const tz = useLocaleTz();
  const memberOptions = useMemberOptions();
  const apiToast = useApiToast();
  const queryClient = useQueryClient();

  // ---- Filters ----
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);

  // Debounced search: updates q and resets pagination from a timer callback.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(searchText.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const changeOwners = (values: string[]) => {
    setOwnerIds(values);
    setPage(1);
  };
  const changeArchived = (value: boolean) => {
    setArchived(value);
    setPage(1);
  };

  const hasFilters = q.length > 0 || ownerIds.length > 0;

  const sizeLabel = (size: string) =>
    KNOWN_SIZES.includes(size) ? t(`companies.sizeOptions.${size}`) : size;

  // ---- List ----
  const companiesQuery = useQuery({
    queryKey: ["companies", workspaceId, { q, ownerIds, archived, page }],
    queryFn: () =>
      api.get<Paginated<Company>>(
        "/companies",
        {
          q: q || undefined,
          ownerId: ownerIds,
          archived,
          page,
          pageSize: PAGE_SIZE,
        },
        workspaceId
      ),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
  const companies = companiesQuery.data?.items ?? [];
  const total = companiesQuery.data?.total ?? 0;

  // ---- Detail ----
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: ["company", workspaceId, selectedCompanyId],
    queryFn: () => api.get<CompanyDetail>(`/companies/${selectedCompanyId}`, undefined, workspaceId),
    enabled: Boolean(workspaceId && selectedCompanyId),
  });
  const selectedRowCompany = companies.find((c) => c.id === selectedCompanyId) ?? null;
  // Full detail (contacts/deals/activities) only exists in the detail query result;
  // the card is used just to render the sheet header immediately.
  const headerCompany: Company | null = detailQuery.data ?? selectedRowCompany;
  const companyDetail = detailQuery.data;

  const openDetail = (id: string) => setSelectedCompanyId(id);
  const closeDetail = () => setSelectedCompanyId(null);

  const invalidateCompanies = () => {
    queryClient.invalidateQueries({ queryKey: ["companies"] });
    queryClient.invalidateQueries({ queryKey: ["company"] });
  };

  // ---- Deep link (viewParams.companyId) ----
  useEffect(() => {
    const id = viewParams.companyId;
    if (!id) return;
    const timer = window.setTimeout(() => {
      setSelectedCompanyId(id);
      navigate("companies");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [viewParams.companyId, navigate]);

  // ---- Form (create / edit) ----
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFormOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditing(company);
    setForm({
      name: company.name,
      website: company.website ?? "",
      industry: company.industry ?? "",
      size: company.size ?? "",
      phone: company.phone ?? "",
      country: company.country ?? "",
      address: company.address ?? "",
      ownerId: company.ownerId ?? "",
      notes: company.notes ?? "",
    });
    setFormError("");
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>): Promise<Company & { duplicateWarning?: boolean }> =>
      editing
        ? api.patch<Company & { duplicateWarning?: boolean }>(`/companies/${editing.id}`, payload, workspaceId)
        : api.post<Company & { duplicateWarning?: boolean }>("/companies", payload, workspaceId),
    onSuccess: (data) => {
      if (!editing && data?.duplicateWarning) {
        // Backend returns 200 with duplicateWarning instead of creating.
        toast.warning(t("errors.DUPLICATE"));
      } else {
        apiToast.success(t(editing ? "companies.updatedToast" : "companies.createdToast"));
      }
      setFormOpen(false);
      invalidateCompanies();
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError(t("validation.nameRequired"));
      return;
    }
    setFormError("");
    saveMutation.mutate({
      workspaceId,
      name: form.name.trim(),
      website: form.website.trim(),
      industry: form.industry.trim(),
      size: form.size,
      phone: form.phone.trim(),
      country: form.country.trim(),
      address: form.address.trim(),
      ownerId: form.ownerId,
      notes: form.notes,
    });
  };

  // ---- Archive / Restore ----
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string; archived: boolean } | null>(null);

  const archiveMutation = useMutation({
    mutationFn: (vars: { id: string; archived: boolean }) =>
      api.patch<Company>(`/companies/${vars.id}`, { workspaceId, archived: vars.archived }, workspaceId),
    onSuccess: (_data, vars) => {
      apiToast.success(t(vars.archived ? "companies.archivedToast" : "companies.restoredToast"));
      setArchiveTarget(null);
      invalidateCompanies();
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  // ---- Delete ----
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/companies/${id}`, undefined, workspaceId),
    onSuccess: () => {
      apiToast.success(t("companies.deletedToast"));
      setDeleteTarget(null);
      closeDetail();
      invalidateCompanies();
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("companies.title")}
        subtitle={t("companies.subtitle")}
        actions={
          <Button onClick={openCreate} className="h-9">
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="truncate">{t("companies.createTitle")}</span>
          </Button>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder={t("common.search")}
          className="w-full lg:max-w-xs"
        />
        <FilterBar>
          <MultiSelectFilter
            label={t("common.owner")}
            options={memberOptions}
            selected={ownerIds}
            onChange={changeOwners}
          />
          <ArchivedToggle value={archived} onChange={changeArchived} />
        </FilterBar>
      </div>

      {/* Card grid */}
      {companiesQuery.isError ? (
        <ErrorState
          title={t("common.errorStateTitle")}
          description={t("common.errorStateDescription")}
          retryLabel={t("common.retry")}
          onRetry={() => companiesQuery.refetch()}
        />
      ) : companiesQuery.isPending ? (
        <CardGridSkeleton count={8} />
      ) : companies.length === 0 ? (
        <EmptyState
          title={t(hasFilters ? "common.emptyFilteredTitle" : "common.emptyStateTitle")}
          description={t(hasFilters ? "common.emptyFilteredDescription" : "common.emptyStateDescription")}
          icon={Building2}
          action={
            !hasFilters ? (
              <Button variant="outline" onClick={openCreate} className="h-9">
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("companies.createTitle")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {companies.map((c) => (
              <Card
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDetail(c.id);
                  }
                }}
                className="group cursor-pointer gap-3 p-4 transition-shadow hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate text-sm font-semibold group-hover:underline">{c.name}</h3>
                  {c.website ? (
                    <a
                      href={websiteHref(c.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("companies.field.website")}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>

                {c.industry || c.size ? (
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {c.industry ? (
                      <Badge variant="outline" className="max-w-full font-normal">
                        <span className="min-w-0 truncate">{c.industry}</span>
                      </Badge>
                    ) : null}
                    {c.size ? (
                      <Badge variant="secondary" className="max-w-full font-normal">
                        <span className="min-w-0 truncate">{sizeLabel(c.size)}</span>
                      </Badge>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="tabular-nums">{formatNumber(c._count?.contacts ?? 0, locale)}</span>
                    <span className="sr-only">{t("nav.contacts")}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Handshake className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="tabular-nums">{formatNumber(c._count?.deals ?? 0, locale)}</span>
                    <span className="sr-only">{t("nav.deals")}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="tabular-nums">{formatNumber(c._count?.tasks ?? 0, locale)}</span>
                    <span className="sr-only">{t("nav.tasks")}</span>
                  </span>
                </div>

                <div className="flex min-w-0 items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{c.owner?.name ?? "—"}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatDate(c.createdAt, locale, tz)}</span>
                </div>
              </Card>
            ))}
          </div>
          {total > 0 ? (
            <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} locale={locale} />
          ) : null}
        </>
      )}

      {/* ---- Detail sheet ---- */}
      <Sheet open={Boolean(selectedCompanyId)} onOpenChange={(open) => !open && closeDetail()}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg" dir={undefined}>
          <SheetHeader className="border-b px-4 py-4">
            <SheetTitle className="min-w-0 truncate pe-8">
              {headerCompany?.name ?? t("common.loading")}
            </SheetTitle>
            <SheetDescription className="truncate">
              {headerCompany?.industry ?? headerCompany?.website ?? "\u00A0"}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {companyDetail ? (
              <Tabs defaultValue="overview">
                <TabsList className="max-w-full justify-start overflow-x-auto">
                  <TabsTrigger value="overview">{t("companies.tabs.overview")}</TabsTrigger>
                  <TabsTrigger value="contacts">{t("companies.tabs.contacts")}</TabsTrigger>
                  <TabsTrigger value="deals">{t("companies.tabs.deals")}</TabsTrigger>
                  <TabsTrigger value="timeline">{t("companies.tabs.timeline")}</TabsTrigger>
                </TabsList>

                {/* Overview */}
                <TabsContent value="overview" className="mt-4 space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    {companyDetail.industry ? (
                      <Badge variant="outline" className="max-w-44 font-normal">
                        <span className="truncate">{companyDetail.industry}</span>
                      </Badge>
                    ) : null}
                    {companyDetail.size ? (
                      <Badge variant="secondary" className="font-normal">
                        <span className="truncate">{sizeLabel(companyDetail.size)}</span>
                      </Badge>
                    ) : null}
                    {companyDetail.archived ? (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        {t("common.archived")}
                      </Badge>
                    ) : null}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <InfoItem label={t("companies.field.website")} value={companyDetail.website ?? "—"} />
                    <InfoItem
                      label={t("common.phone")}
                      value={companyDetail.phone ? <span dir="ltr">{companyDetail.phone}</span> : "—"}
                    />
                    <InfoItem label={t("companies.field.country")} value={companyDetail.country ?? "—"} />
                    <InfoItem label={t("common.owner")} value={companyDetail.owner?.name ?? "—"} />
                  </dl>

                  {companyDetail.address ? (
                    <p className="flex min-w-0 items-start gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-words">{companyDetail.address}</span>
                    </p>
                  ) : null}

                  {companyDetail.website ? (
                    <a
                      href={websiteHref(companyDetail.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{websiteHref(companyDetail.website).replace(/^https?:\/\//i, "")}</span>
                    </a>
                  ) : null}

                  {companyDetail.tags?.length ? (
                    <div className="min-w-0">
                      <p className="mb-1.5 text-xs text-muted-foreground">{t("common.tags")}</p>
                      <TagBadges tags={companyDetail.tags} max={10} />
                    </div>
                  ) : null}

                  {companyDetail.notes ? (
                    <div className="min-w-0">
                      <p className="mb-1.5 text-xs text-muted-foreground">{t("common.notes")}</p>
                      <p className="whitespace-pre-wrap text-sm">{companyDetail.notes}</p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    <Button variant="outline" size="sm" className="h-9" onClick={() => openEdit(companyDetail)}>
                      <PenLine className="h-4 w-4" aria-hidden="true" />
                      <span className="truncate">{t("common.edit")}</span>
                    </Button>
                    {companyDetail.archived ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={archiveMutation.isPending}
                        onClick={() => archiveMutation.mutate({ id: companyDetail.id, archived: false })}
                      >
                        <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                        <span className="truncate">{t("common.restore")}</span>
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() =>
                          setArchiveTarget({ id: companyDetail.id, name: companyDetail.name, archived: true })
                        }
                      >
                        <Archive className="h-4 w-4" aria-hidden="true" />
                        <span className="truncate">{t("common.archive")}</span>
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget({ id: companyDetail.id, name: companyDetail.name })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="truncate">{t("common.delete")}</span>
                    </Button>
                  </div>
                </TabsContent>

                {/* Contacts */}
                <TabsContent value="contacts" className="mt-4">
                  {companyDetail.contacts.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                      {t("common.noData")}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {companyDetail.contacts.map((p) => (
                        <li key={p.id} className="rounded-lg border p-3">
                          <p className="truncate text-sm font-medium">{p.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.jobTitle ?? p.email ?? "—"}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Deals */}
                <TabsContent value="deals" className="mt-4">
                  {companyDetail.deals.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                      {t("common.noData")}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {companyDetail.deals.map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{d.title}</p>
                            <p className="truncate text-xs text-muted-foreground">{d.stage?.name ?? "—"}</p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {formatMoney(d.value, locale, d.currency || currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Timeline */}
                <TabsContent value="timeline" className="mt-4">
                  <ActivityTimeline activities={companyDetail.activities} />
                </TabsContent>
              </Tabs>
            ) : (
              <div className="flex justify-center py-10" aria-busy="true">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ---- Create / Edit form ---- */}
      <EntityFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) setFormOpen(false);
        }}
        title={editing ? t("companies.editTitle") : t("companies.createTitle")}
        loading={saveMutation.isPending}
        onSubmit={submitForm}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("common.name")} htmlFor="company-name" required>
            <Input
              id="company-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("companies.field.website")} htmlFor="company-website">
            <Input
              id="company-website"
              type="url"
              inputMode="url"
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              placeholder="example.com"
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("companies.field.industry")} htmlFor="company-industry">
            <Input
              id="company-industry"
              value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("companies.field.size")} htmlFor="company-size">
            <Select
              value={form.size || NO_SIZE}
              onValueChange={(v) => setForm((f) => ({ ...f, size: v === NO_SIZE ? "" : v }))}
            >
              <SelectTrigger id="company-size" className="w-full">
                <SelectValue placeholder={t("common.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SIZE}>{t("common.none")}</SelectItem>
                {KNOWN_SIZES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`companies.sizeOptions.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t("common.phone")} htmlFor="company-phone">
            <Input
              id="company-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("companies.field.country")} htmlFor="company-country">
            <Input
              id="company-country"
              value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("common.owner")} htmlFor="company-owner">
            <Select
              value={form.ownerId || UNASSIGNED}
              onValueChange={(v) => setForm((f) => ({ ...f, ownerId: v === UNASSIGNED ? "" : v }))}
            >
              <SelectTrigger id="company-owner" className="w-full">
                <SelectValue placeholder={t("common.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>{t("common.none")}</SelectItem>
                {memberOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField label={t("companies.field.address")} htmlFor="company-address">
              <Input
                id="company-address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                autoComplete="off"
              />
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField label={t("common.notes")} htmlFor="company-notes">
              <Textarea
                id="company-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </FormField>
          </div>
        </div>
        {formError ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {formError}
          </p>
        ) : null}
      </EntityFormDialog>

      {/* ---- Archive confirm ---- */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={t("common.archiveConfirmTitle")}
        description={t("common.archiveConfirmDescription", { name: archiveTarget?.name ?? "" })}
        confirmLabel={t("common.archive")}
        destructive
        loading={archiveMutation.isPending}
        onConfirm={() => archiveTarget && archiveMutation.mutate({ id: archiveTarget.id, archived: true })}
      />

      {/* ---- Delete confirm ---- */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("common.deleteConfirmTitle")}
        description={t("common.deleteConfirmDescription", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("common.delete")}
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}
