// ---- CSV utilities: safe parsing, serialization, formula-injection protection ----

/** Parse CSV text into rows of cells. Handles BOM, CRLF, quoted cells with escaped quotes. */
export function parseCsv(text: string): string[][] {
  // Strip BOM
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
  // last cell/row (if any content)
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop fully-empty trailing rows
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function sanitizeCell(value: string): string {
  // Protect against spreadsheet formula injection (CSV injection)
  const first = value.charAt(0);
  if (["=", "+", "-", "@", "\t", "\r"].includes(first)) {
    return `'${value}`;
  }
  return value;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((v) => {
          const s = v === null || v === undefined ? "" : String(v);
          const safe = sanitizeCell(s);
          if (/[",\n\r]/.test(safe)) {
            return `"${safe.replace(/"/g, '""')}"`;
          }
          return safe;
        })
        .join(",")
    )
    .join("\r\n");
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ---- Shared CSV column schemas for import/export ----

export const CSV_SCHEMAS: Record<string, { columns: { key: string; label: string; sample: string }[] }> = {
  contacts: {
    columns: [
      { key: "name", label: "Name", sample: "Sara Ahmadi" },
      { key: "email", label: "Email", sample: "sara@example.com" },
      { key: "phone", label: "Phone", sample: "+98 912 000 0000" },
      { key: "jobTitle", label: "Job Title", sample: "Product Manager" },
      { key: "companyName", label: "Company Name", sample: "Example Co" },
      { key: "notes", label: "Notes", sample: "Met at conference" },
    ],
  },
  leads: {
    columns: [
      { key: "name", label: "Name", sample: "Ali Karimi" },
      { key: "email", label: "Email", sample: "ali@example.com" },
      { key: "phone", label: "Phone", sample: "+98 913 000 0000" },
      { key: "companyName", label: "Company Name", sample: "Startup X" },
      { key: "jobTitle", label: "Job Title", sample: "CTO" },
      { key: "source", label: "Source", sample: "WEBSITE" },
      { key: "status", label: "Status", sample: "NEW" },
      { key: "priority", label: "Priority", sample: "MEDIUM" },
      { key: "estimatedValue", label: "Estimated Value", sample: "5000" },
      { key: "notes", label: "Notes", sample: "Interested in demo" },
    ],
  },
  companies: {
    columns: [
      { key: "name", label: "Name", sample: "Example Co" },
      { key: "website", label: "Website", sample: "https://example.com" },
      { key: "industry", label: "Industry", sample: "Software" },
      { key: "size", label: "Size", sample: "10-50" },
      { key: "phone", label: "Phone", sample: "+98 21 0000 0000" },
      { key: "country", label: "Country", sample: "Iran" },
      { key: "notes", label: "Notes", sample: "" },
    ],
  },
};

export const DATE_HINT = "YYYY-MM-DD";
