import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handler, ok, parseBody, requireWorkspaceFromBody } from "@/lib/server/api";
import { createActivity, audit } from "@/lib/server/activity";
import { runAutomations } from "@/lib/server/automation";

type Params = { params: Promise<{ id: string }> };

const convertSchema = z.object({
  workspaceId: z.string().min(1),
  createDeal: z.boolean().default(false),
  dealTitle: z.string().max(120).optional().or(z.literal("")),
  dealValue: z.number().min(0).max(1e12).optional(),
});

/**
 * Lead conversion — transactional:
 * lead → contact (carrying over fields), optional deal in the first OPEN stage
 * of the default pipeline. History is preserved via activity records.
 */
export const POST = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, convertSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  const lead = await db.lead.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
  });
  if (!lead) return fail(404, "NOT_FOUND", "Lead not found.");
  if (lead.status === "CONVERTED") {
    return fail(409, "DUPLICATE", "Lead already converted.");
  }

  const result = await db.$transaction(async (tx) => {
    // Resolve target company (match by exact name, else create)
    let companyId: string | null = null;
    if (lead.companyName) {
      const company = await tx.company.findFirst({
        where: { workspaceId: ctx.workspaceId, name: lead.companyName },
      });
      companyId =
        company?.id ??
        (
          await tx.company.create({
            data: { workspaceId: ctx.workspaceId, name: lead.companyName, ownerId: lead.ownerId },
          })
        ).id;
    }

    const contact = await tx.contact.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        jobTitle: lead.jobTitle,
        companyId,
        ownerId: lead.ownerId,
        notes: lead.notes,
        lastContactedAt: lead.lastContactedAt,
        nextFollowUpAt: lead.nextFollowUpAt,
      },
    });

    let dealId: string | null = null;
    if (body.createDeal) {
      const pipeline =
        (await tx.pipeline.findFirst({ where: { workspaceId: ctx.workspaceId, isDefault: true } })) ??
        (await tx.pipeline.findFirst({ where: { workspaceId: ctx.workspaceId } }));
      if (pipeline) {
        const stages = await tx.stage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { order: "asc" } });
        const firstOpen = stages.find((s) => s.type === "OPEN") ?? stages[0];
        if (firstOpen) {
          const deal = await tx.deal.create({
            data: {
              workspaceId: ctx.workspaceId,
              pipelineId: pipeline.id,
              stageId: firstOpen.id,
              title: (body.dealTitle?.trim() || lead.name).slice(0, 120),
              contactId: contact.id,
              companyId,
              value: body.dealValue ?? lead.estimatedValue ?? 0,
              currency: (await tx.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } })).currency,
              probability: firstOpen.probability,
              ownerId: lead.ownerId,
              source: lead.source,
              priority: lead.priority as "LOW" | "MEDIUM" | "HIGH",
              description: lead.notes,
            },
          });
          dealId = deal.id;
        }
      }
    }

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: "CONVERTED",
        convertedContactId: contact.id,
        convertedDealId: dealId,
        convertedAt: new Date(),
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: ctx.user.id,
        type: "CONVERSION",
        title: "LEAD_CONVERTED",
        leadId: lead.id,
        contactId: contact.id,
        dealId,
        metadata: JSON.stringify({ leadName: lead.name, contactName: contact.name }),
      },
    });

    // Mirror creation activity onto the contact timeline
    await tx.activity.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: ctx.user.id,
        type: "SYSTEM",
        title: "CONTACT_CREATED_FROM_LEAD",
        contactId: contact.id,
        metadata: JSON.stringify({ leadId: lead.id, leadName: lead.name }),
      },
    });

    return { contactId: contact.id, dealId };
  });

  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: "CONVERT",
    entityType: "lead",
    entityId: lead.id,
    detail: result,
  });

  if (body.createDeal && result.dealId) {
    const deal = await db.deal.findUniqueOrThrow({ where: { id: result.dealId } });
    await runAutomations({
      workspaceId: ctx.workspaceId,
      trigger: "DEAL_CREATED",
      entityType: "deal",
      entity: { ...deal, title: deal.title },
      actorId: ctx.user.id,
    });
  }

  return ok({ contactId: result.contactId, dealId: result.dealId }, 200);
});

export const dynamic = "force-dynamic";
