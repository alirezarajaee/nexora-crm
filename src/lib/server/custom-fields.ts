import { db } from "@/lib/db";

/** Validate + persist custom field values for an entity. Returns count saved. */
export async function saveCustomFieldValues(
  workspaceId: string,
  entityType: string,
  entityId: string,
  values: Record<string, string | null>
): Promise<number> {
  const defs = await db.customField.findMany({
    where: { workspaceId, entityType, active: true },
  });
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  let saved = 0;
  for (const [key, rawValue] of Object.entries(values)) {
    const def = defByKey.get(key);
    if (!def) continue;
    let value: string | null = rawValue;
    if (value === "" || value === undefined) value = null;
    if (value !== null) {
      switch (def.type) {
        case "NUMBER": {
          const n = Number(value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
          if (!Number.isFinite(n)) continue;
          value = String(n);
          break;
        }
        case "DATE": {
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) continue;
          value = d.toISOString();
          break;
        }
        case "BOOLEAN":
          value = value === "true" || value === "1" ? "true" : "false";
          break;
        case "SELECT": {
          const options: string[] = def.options ? JSON.parse(def.options) : [];
          if (options.length > 0 && !options.includes(value)) continue;
          break;
        }
        case "MULTI_SELECT": {
          const options: string[] = def.options ? JSON.parse(def.options) : [];
          const selected = value.split(",").map((s) => s.trim()).filter(Boolean);
          if (options.length > 0 && !selected.every((s) => options.includes(s))) continue;
          value = JSON.stringify(selected);
          break;
        }
        case "URL":
          if (!/^https?:\/\//i.test(value)) continue;
          break;
        default:
          break;
      }
    }
    if (def.required && value === null) continue;
    await db.customFieldValue.upsert({
      where: { fieldId_entityId: { fieldId: def.id, entityId } },
      create: { workspaceId, fieldId: def.id, entityType, entityId, value },
      update: { value },
    });
    saved += 1;
  }
  return saved;
}
