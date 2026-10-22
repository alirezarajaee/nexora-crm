import { CSV_SCHEMAS, csvResponse } from "@/lib/server/csv";
import { handler, requireWorkspace } from "@/lib/server/api";

type Params = { params: Promise<{ entity: string }> };

/** GET /api/v1/csv/template/[entity] — download an import template with sample row. */
export const GET = handler(async (req: Request, { params }: Params) => {
  const { entity } = await params;
  const schema = CSV_SCHEMAS[entity];
  if (!schema) {
    return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Unknown entity." } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  void (await requireWorkspace(req));
  const csv = [
    schema.columns.map((c) => c.label).join(","),
    schema.columns.map((c) => c.sample).join(","),
  ].join("\r\n");
  return csvResponse(`nexora-${entity}-template.csv`, csv);
});

export const dynamic = "force-dynamic";
