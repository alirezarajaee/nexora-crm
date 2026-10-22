import { db } from "@/lib/db";
import type { TagInfo } from "@/types/api";

/** Attach workspace-scoped tags to a list of records (mutates copies). */
export async function attachTags<T extends { id: string }>(
  workspaceId: string,
  entityType: string,
  items: T[]
): Promise<(T & { tags: TagInfo[] })[]> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const relations = await db.tagRelation.findMany({
    where: { workspaceId, entityType, entityId: { in: ids } },
    include: { tag: { select: { id: true, name: true, color: true } } },
  });
  const byEntity = new Map<string, TagInfo[]>();
  for (const rel of relations) {
    const list = byEntity.get(rel.entityId) ?? [];
    list.push({ id: rel.tag.id, name: rel.tag.name, color: rel.tag.color });
    byEntity.set(rel.entityId, list);
  }
  return items.map((item) => ({ ...item, tags: byEntity.get(item.id) ?? [] }));
}

/** Attach custom field values for the given definitions to records. */
export async function attachCustomFields<T extends { id: string }>(
  workspaceId: string,
  entityType: string,
  items: T[]
): Promise<(T & { customFields: { fieldId: string; key: string; label: string; type: string; value: string | null }[] })[]> {
  if (items.length === 0) return [];
  const defs = await db.customField.findMany({
    where: { workspaceId, entityType, active: true },
    orderBy: { order: "asc" },
  });
  if (defs.length === 0) return items.map((i) => ({ ...i, customFields: [] }));
  const values = await db.customFieldValue.findMany({
    where: { workspaceId, entityType, entityId: { in: items.map((i) => i.id) } },
  });
  const byEntity = new Map<string, Map<string, string | null>>();
  for (const v of values) {
    const inner = byEntity.get(v.entityId) ?? new Map<string, string | null>();
    inner.set(v.fieldId, v.value);
    byEntity.set(v.entityId, inner);
  }
  return items.map((item) => ({
    ...item,
    customFields: defs.map((d) => ({
      fieldId: d.id,
      key: d.key,
      label: d.label,
      type: d.type,
      value: byEntity.get(item.id)?.get(d.id) ?? null,
    })),
  }));
}

/** Replace the tag set of an entity (creates missing tags by name). */
export async function syncTags(
  workspaceId: string,
  entityType: string,
  entityId: string,
  tagNames: string[],
  tagIds: string[]
): Promise<void> {
  await db.tagRelation.deleteMany({ where: { workspaceId, entityType, entityId } });
  const names = tagNames.map((n) => n.trim()).filter(Boolean);
  for (const name of names) {
    const tag = await db.tag.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name },
      update: {},
    });
    await db.tagRelation.upsert({
      where: { tagId_entityType_entityId: { tagId: tag.id, entityType, entityId } },
      create: { workspaceId, tagId: tag.id, entityType, entityId },
      update: {},
    });
  }
  const existing = tagIds.filter(Boolean);
  for (const tagId of existing) {
    const tag = await db.tag.findFirst({ where: { id: tagId, workspaceId } });
    if (!tag) continue;
    await db.tagRelation.upsert({
      where: { tagId_entityType_entityId: { tagId: tag.id, entityType, entityId } },
      create: { workspaceId, tagId: tag.id, entityType, entityId },
      update: {},
    });
  }
}

export function listTagsParam(sp: URLSearchParams): { tagIds: string[]; tagNames: string[] } {
  const raw = sp.get("tags") ?? "";
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  // Tag ids are cuid-like (starts with c, length 25); names otherwise.
  const tagIds = parts.filter((p) => /^[a-z0-9]{20,32}$/i.test(p));
  const tagNames = parts.filter((p) => !tagIds.includes(p));
  return { tagIds, tagNames };
}
