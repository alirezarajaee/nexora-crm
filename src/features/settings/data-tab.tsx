"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  Check,
  ChevronRight,
  Database,
  Download,
  FlaskConical,
  Info,
  RotateCcw,
  Table2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadFile, api } from "@/lib/client-api";
import { useApiToast, useWorkspaceId } from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CSV_COLUMNS,
  CSV_ENTITIES,
  autoMapColumns,
  localizeRowError,
  parseCsvFile,
  type CsvEntity,
  type ImportPreview,
  type ImportResult,
  type ParsedCsv,
} from "./csv-client";

const SKIP = "__skip__";

function StepIndicator({ step }: { step: number }) {
  const { t } = useTranslation();
  const labels = [
    t("csv.import.step1"),
    t("csv.import.step2"),
    t("csv.import.step3"),
    t("csv.import.step4"),
  ];
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {labels.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border text-muted-foreground"
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : n}
            </span>
            <span className={cn("text-xs", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
            {n < labels.length ? (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ImportCard() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const workspaceId = useWorkspaceId();
  const { apiError } = useApiToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entity, setEntity] = useState<CsvEntity>("contacts");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const step = result ? 4 : preview ? 3 : parsed ? 2 : 1;

  const resetFile = () => {
    setParsed(null);
    setMapping({});
    setPreview(null);
    setResult(null);
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const changeEntity = (next: CsvEntity) => {
    setEntity(next);
    resetFile();
  };

  const onFileChange = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const p = parseCsvFile(text);
      if (p.rows.length === 0 || p.headers.length === 0) {
        toast.error(t("common.noData"));
        return;
      }
      setFileName(file.name);
      setParsed(p);
      setMapping(autoMapColumns(p.headers, entity));
      setPreview(null);
      setResult(null);
    } catch {
      toast.error(t("errors.generic"));
    }
  };

  const previewMutation = useMutation({
    mutationFn: (body: { mapping: Record<number, string>; rows: string[][]; skipDuplicates: boolean }) =>
      api.post<ImportPreview>(
        `/csv/import/preview/${entity}`,
        { workspaceId, ...body },
        workspaceId
      ),
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
    },
    onError: (err) => apiError(err),
  });

  const confirmMutation = useMutation({
    mutationFn: (body: { mapping: Record<number, string>; rows: string[][]; skipDuplicates: boolean }) =>
      api.post<ImportResult>(
        `/csv/import/confirm/${entity}`,
        { workspaceId, ...body },
        workspaceId
      ),
    onSuccess: (data) => {
      setResult(data);
      setPreview(null);
      // Imported records affect lists, dashboard and radar — refresh everything
      void queryClient.invalidateQueries();
    },
    onError: (err) => apiError(err),
  });

  const runPreview = () => {
    if (!parsed) return;
    if (!Object.values(mapping).includes("name")) {
      toast.error(t("csv.import.missingRequired", { field: t("common.name") }));
      return;
    }
    previewMutation.mutate({ mapping, rows: parsed.rows, skipDuplicates });
  };

  const runImport = () => {
    if (!parsed) return;
    confirmMutation.mutate({ mapping, rows: parsed.rows, skipDuplicates });
  };

  // Mapped target columns ordered by file column index
  const mappedCols = parsed
    ? Object.entries(mapping)
        .filter(([, key]) => Boolean(key))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([idx, key]) => ({
          idx: Number(idx),
          key,
          label: CSV_COLUMNS[entity].find((c) => c.key === key)?.label ?? key,
        }))
    : [];

  const requiredMissing = CSV_COLUMNS[entity]
    .filter((c) => c.required)
    .filter((c) => !Object.values(mapping).includes(c.key));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("csv.import.title")}
        </CardTitle>
        <CardDescription>{t("csv.import.templateHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <StepIndicator step={step} />

        {/* Step 1 — entity + file + template */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="csv-entity">{t("settings.data.import")}</Label>
            <Select value={entity} onValueChange={(v) => changeEntity(v as CsvEntity)}>
              <SelectTrigger id="csv-entity" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CSV_ENTITIES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {t(`csv.import.entities.${e}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="csv-file">{t("csv.import.chooseFile")}</Label>
            <Input
              ref={fileInputRef}
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="h-9 file:me-2 file:h-7 file:rounded-md file:border-0 file:bg-muted file:px-2 file:text-xs"
              onChange={(e) => void onFileChange(e.target.files?.[0])}
            />
            {fileName ? (
              <p className="truncate text-xs text-muted-foreground" dir="ltr">
                {fileName}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => {
              window.location.href = `/api/v1/csv/template/${entity}?workspaceId=${encodeURIComponent(workspaceId)}`;
            }}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t("csv.import.downloadTemplate")}
          </Button>
          {parsed ? (
            <Button variant="ghost" size="sm" className="h-8" onClick={resetFile}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("common.reset")}
            </Button>
          ) : null}
        </div>

        {/* Step 2 — mapping */}
        {parsed ? (
          <div className="space-y-3 rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{t("csv.import.step2")}</p>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setMapping(autoMapColumns(parsed.headers, entity))}
              >
                {t("csv.import.autoMap")}
              </Button>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto pe-1">
              {parsed.headers.map((header, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                    {header.trim() || `#${idx + 1}`}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                  <Select
                    value={mapping[idx] || SKIP}
                    onValueChange={(v) =>
                      setMapping((m) => ({ ...m, [idx]: v === SKIP ? "" : v }))
                    }
                  >
                    <SelectTrigger className="h-8 w-52" aria-label={`${t("csv.import.targetField")} — ${header}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP}>{t("csv.import.skipColumn")}</SelectItem>
                      {CSV_COLUMNS[entity].map((col) => (
                        <SelectItem key={col.key} value={col.key}>
                          {col.label}
                          {col.required ? " *" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {requiredMissing.length > 0 ? (
              <p className="text-xs text-destructive">
                {t("csv.import.missingRequired", { field: requiredMissing[0].label })}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="h-9"
                onClick={runPreview}
                disabled={previewMutation.isPending || requiredMissing.length > 0}
              >
                {t("common.apply")}
              </Button>
              {parsed ? (
                <span className="text-xs text-muted-foreground">
                  {t("csv.import.validRows", { count: formatNumber(parsed.rows.length, locale) })}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Step 3 — preview */}
        {preview ? (
          <div className="space-y-3 rounded-xl border p-3">
            <p className="text-sm font-semibold">{t("csv.import.step3")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                {t("csv.import.validRows", { count: formatNumber(preview.validCount, locale) })}
              </Badge>
              {preview.errorCount > 0 ? (
                <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
                  {t("csv.import.errorRows", { count: formatNumber(preview.errorCount, locale) })}
                </Badge>
              ) : null}
              {preview.duplicateCount > 0 ? (
                <Badge variant="secondary">
                  {t("csv.import.duplicateRows", { count: formatNumber(preview.duplicateCount, locale) })}
                </Badge>
              ) : null}
            </div>

            {preview.errors.length > 0 ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-destructive/5 p-2">
                {preview.errors.slice(0, 8).map((e, i) => (
                  <p key={i} className="text-xs text-destructive">
                    {t("csv.import.rowError", {
                      row: formatNumber(e.row + 2, locale),
                      error: localizeRowError(e.error, t),
                    })}
                  </p>
                ))}
                {preview.errors.length > 8 ? (
                  <p className="text-xs text-muted-foreground">
                    +{formatNumber(preview.errors.length - 8, locale)}
                  </p>
                ) : null}
              </div>
            ) : null}

            {preview.valid.length > 0 && mappedCols.length > 0 ? (
              <div className="overflow-hidden rounded-lg border">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {mappedCols.map((col) => (
                          <TableHead key={col.key} className="whitespace-nowrap">
                            {col.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.valid.slice(0, 8).map((row, i) => (
                        <TableRow key={i}>
                          {mappedCols.map((col) => (
                            <TableCell key={col.key} className="max-w-40 truncate whitespace-nowrap text-xs">
                              {row[col.key] ?? "—"}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  {t("csv.import.previewTitle", { count: formatNumber(Math.min(8, preview.valid.length), locale) })}
                </p>
              </div>
            ) : null}

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={skipDuplicates}
                onCheckedChange={(v) => setSkipDuplicates(v === true)}
                aria-label={t("csv.import.skipDuplicates")}
              />
              {t("csv.import.skipDuplicates")}
            </label>

            <Button
              className="h-9"
              onClick={runImport}
              disabled={confirmMutation.isPending || previewMutation.isPending}
            >
              {confirmMutation.isPending ? t("csv.import.importing") : t("csv.import.importButton")}
            </Button>
          </div>
        ) : null}

        {/* Step 4 — result */}
        {result ? (
          <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="font-semibold">{t("csv.import.resultTitle")}</p>
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {t("csv.import.imported", { count: formatNumber(result.imported, locale) })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("csv.import.skipped", { count: formatNumber(result.skipped, locale) })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("csv.import.failed", { count: formatNumber(result.failed, locale) })}
            </p>
            <Button variant="outline" size="sm" className="h-8" onClick={resetFile}>
              {t("csv.import.done")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExportCard() {
  const { t } = useTranslation();
  const workspaceId = useWorkspaceId();

  const buttons: { entity: CsvEntity; label: string }[] = [
    { entity: "contacts", label: t("settings.data.exportContacts") },
    { entity: "leads", label: t("settings.data.exportLeads") },
    { entity: "companies", label: t("settings.data.exportCompanies") },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.data.export")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <Button
            key={b.entity}
            variant="outline"
            className="h-9"
            onClick={() => downloadFile(`/csv/export/${b.entity}`, { workspaceId })}
          >
            <Table2 className="h-4 w-4" aria-hidden="true" />
            {b.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function DemoDataCard() {
  const { t } = useTranslation();
  const { apiError } = useApiToast();

  const seedMutation = useMutation({
    mutationFn: () =>
      api.post<{ created: boolean; message?: string }>("/dev/seed", {}),
    onSuccess: (res) => {
      if (res.created) {
        toast.success(t("settings.data.demoCreated"), {
          description: "demo@nexora.app / nexora-demo",
        });
      } else {
        toast(t("settings.data.demoExists"));
      }
    },
    onError: (err) => apiError(err),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.data.demoData")}
        </CardTitle>
        <CardDescription>{t("settings.data.demoDataHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          className="h-9"
          onClick={() => seedMutation.mutate()}
          disabled={seedMutation.isPending}
        >
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
          {t("settings.data.createDemo")}
        </Button>
      </CardContent>
    </Card>
  );
}

export function DataTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <ExportCard />
      <ImportCard />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <DemoDataCard />
        <div
          className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
          role="note"
        >
          <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("settings.data.archivedHint")}</span>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-muted-foreground" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{t("csv.import.templateHint")}</span>
      </div>
    </div>
  );
}
