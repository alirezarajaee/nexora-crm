// Client-side CSV utilities for the Settings → Data tab.
// The column schemas replicate src/lib/server/csv.ts CSV_SCHEMAS (read-only contract).

export type CsvEntity = "contacts" | "leads" | "companies";

export interface CsvColumn {
  key: string;
  label: string;
  required?: boolean;
}

/** Column definitions per entity (must match backend CSV_SCHEMAS). */
export const CSV_COLUMNS: Record<CsvEntity, CsvColumn[]> = {
  contacts: [
    { key: "name", label: "Name", required: true },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "jobTitle", label: "Job Title" },
    { key: "companyName", label: "Company Name" },
    { key: "notes", label: "Notes" },
  ],
  leads: [
    { key: "name", label: "Name", required: true },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "companyName", label: "Company Name" },
    { key: "jobTitle", label: "Job Title" },
    { key: "source", label: "Source" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    { key: "estimatedValue", label: "Estimated Value" },
    { key: "notes", label: "Notes" },
  ],
  companies: [
    { key: "name", label: "Name", required: true },
    { key: "website", label: "Website" },
    { key: "industry", label: "Industry" },
    { key: "size", label: "Size" },
    { key: "phone", label: "Phone" },
    { key: "country", label: "Country" },
    { key: "notes", label: "Notes" },
  ],
};

export const CSV_ENTITIES: CsvEntity[] = ["contacts", "leads", "companies"];

/** Parse CSV text into rows of cells. Handles BOM, CRLF, quoted cells with escaped quotes. */
export function parseCsvClient(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** Parse raw CSV text into headers + data rows. */
export function parseCsvFile(text: string): ParsedCsv {
  const all = parseCsvClient(text);
  if (all.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = all;
  return { headers, rows };
}

/** Auto-map file column index → target field key by header match (case-insensitive on key/label). */
export function autoMapColumns(headers: string[], entity: CsvEntity): Record<number, string> {
  const columns = CSV_COLUMNS[entity];
  const byKey = new Map<string, string>();
  for (const c of columns) {
    byKey.set(c.key.toLowerCase(), c.key);
    byKey.set(c.label.toLowerCase(), c.key);
  }
  const mapping: Record<number, string> = {};
  headers.forEach((h, idx) => {
    const normalized = h.trim().toLowerCase().replace(/\s+/g, "");
    const exact = byKey.get(h.trim().toLowerCase()) ?? byKey.get(normalized);
    if (exact) mapping[idx] = exact;
  });
  return mapping;
}

export interface ImportPreview {
  valid: Record<string, string | null>[];
  errors: { row: number; error: string; field?: string }[];
  duplicates: number[];
  totalRows: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
}

/** Localize a backend validation error code (MISSING:name / INVALID:email / INVALID:estimatedValue). */
export function localizeRowError(
  error: string,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  const [kind, field] = error.split(":");
  if (kind === "MISSING") {
    return t("csv.import.missingRequired", { field: t(`common.${field}`) });
  }
  if (kind === "INVALID") {
    if (field === "email") return t("validation.email");
    return t("csv.import.invalidNumber");
  }
  return error;
}
