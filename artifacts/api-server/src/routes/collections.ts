import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { db, checklistItemsTable, checklistItemsTable as itemsTable, checklistsTable, collectionChecklistsTable, collectionsTable } from "@workspace/db";
import {
  AddChecklistToCollectionParams,
  CreateCollectionBody,
  CreateCollectionChecklistBody,
  CreateCollectionChecklistParams,
  CreateCollectionChecklistResponse,
  CreateCollectionResponse,
  DeleteCollectionParams,
  ListCollectionsResponse,
  RemoveChecklistFromCollectionParams,
  UpdateCollectionBody,
  UpdateCollectionParams,
  UpdateCollectionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const statuses = ["todo", "in_progress", "done", "blocked"] as const;

function getOwnerId(req: Request): string | null {
  const userId = getAuth(req).userId;
  if (userId) return userId;
  const anonymousId = req.get("x-anonymous-id")?.trim();
  return anonymousId && /^[A-Za-z0-9_-]{1,128}$/.test(anonymousId)
    ? `anon:${anonymousId}`
    : null;
}

function collectionOwnerCondition(ownerId: string | null) {
  return ownerId === null
    ? isNull(collectionsTable.ownerId)
    : eq(collectionsTable.ownerId, ownerId);
}

function checklistOwnerCondition(ownerId: string | null) {
  if (ownerId?.startsWith("anon:")) {
    return or(eq(checklistsTable.ownerId, ownerId), isNull(checklistsTable.ownerId));
  }
  return ownerId === null
    ? isNull(checklistsTable.ownerId)
    : eq(checklistsTable.ownerId, ownerId);
}

function parsePastedItems(sourceText: string): string[] {
  const workflowCodes = sourceText.match(/\b\d{3}_[a-z0-9]+(?:_[a-z0-9]+)*\b/gi);
  if (workflowCodes && workflowCodes.length > 1) return workflowCodes;
  return sourceText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•◦▪·]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

async function getCollectionPayload(id: number, ownerId: string | null) {
  const [collection] = await db
    .select()
    .from(collectionsTable)
    .where(and(eq(collectionsTable.id, id), collectionOwnerCondition(ownerId)));
  if (!collection) return undefined;

  const memberships = await db
    .select()
    .from(collectionChecklistsTable)
    .where(eq(collectionChecklistsTable.collectionId, id));
  const checklistIds = memberships.map((membership) => membership.checklistId);
  if (!checklistIds.length) return { ...collection, checklists: [] };

  const allChecklists = await db
    .select()
    .from(checklistsTable)
    .where(checklistOwnerCondition(ownerId))
    .orderBy(desc(checklistsTable.updatedAt));
  const allItems = await db.select().from(itemsTable);
  const checklistById = new Map(allChecklists.map((checklist) => [checklist.id, checklist]));
  const itemBuckets = new Map<number, typeof allItems>();
  for (const item of allItems) {
    const bucket = itemBuckets.get(item.checklistId) ?? [];
    bucket.push(item);
    itemBuckets.set(item.checklistId, bucket);
  }

  const checklists = checklistIds.flatMap((checklistId) => {
    const checklist = checklistById.get(checklistId);
    if (!checklist) return [];
    const checklistItems = itemBuckets.get(checklistId) ?? [];
    const completedItems = checklistItems.filter((item) => item.status === "done").length;
    return [{
      id: checklist.id,
      title: checklist.title,
      createdAt: checklist.createdAt,
      updatedAt: checklist.updatedAt,
      totalItems: checklistItems.length,
      completedItems,
      progress: checklistItems.length
        ? Math.round((completedItems / checklistItems.length) * 100)
        : 0,
    }];
  });
  return { ...collection, checklists };
}

router.get("/collections", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const collections = await db
    .select()
    .from(collectionsTable)
    .where(collectionOwnerCondition(ownerId))
    .orderBy(asc(collectionsTable.name));
  const payloads = await Promise.all(
    collections.map((collection) => getCollectionPayload(collection.id, ownerId)),
  );
  res.json(ListCollectionsResponse.parse(payloads.filter(Boolean)));
});

router.post("/collections", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const parsed = CreateCollectionBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) {
    res.status(400).json({ error: "Enter a collection name." });
    return;
  }
  const [created] = await db
    .insert(collectionsTable)
    .values({ ownerId, name: parsed.data.name.trim() })
    .returning();
  res.status(201).json(
    CreateCollectionResponse.parse({ ...created, checklists: [] }),
  );
});

router.patch("/collections/:id", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = UpdateCollectionParams.safeParse(req.params);
  const parsed = UpdateCollectionBody.safeParse(req.body);
  if (!params.success || !parsed.success || !parsed.data.name.trim()) {
    res.status(400).json({ error: "Enter a collection name." });
    return;
  }
  const [updated] = await db
    .update(collectionsTable)
    .set({ name: parsed.data.name.trim(), updatedAt: new Date() })
    .where(and(eq(collectionsTable.id, params.data.id), collectionOwnerCondition(ownerId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Collection not found." });
    return;
  }
  const payload = await getCollectionPayload(updated.id, ownerId);
  res.json(UpdateCollectionResponse.parse(payload));
});

router.delete("/collections/:id", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = DeleteCollectionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid collection." });
    return;
  }
  const [deleted] = await db
    .delete(collectionsTable)
    .where(and(eq(collectionsTable.id, params.data.id), collectionOwnerCondition(ownerId)))
    .returning({ id: collectionsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Collection not found." });
    return;
  }
  res.sendStatus(204);
});

router.post("/collections/:id/checklists", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = CreateCollectionChecklistParams.safeParse(req.params);
  const parsed = CreateCollectionChecklistBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid checklist input." });
    return;
  }
  const [collection] = await db
    .select()
    .from(collectionsTable)
    .where(and(eq(collectionsTable.id, params.data.id), collectionOwnerCondition(ownerId)));
  if (!collection) {
    res.status(404).json({ error: "Collection not found." });
    return;
  }
  const itemTitles = parsePastedItems(parsed.data.sourceText);
  if (!itemTitles.length) {
    res.status(400).json({ error: "Paste at least one checklist item." });
    return;
  }
  const title = parsed.data.title?.trim() || `Checklist · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const created = await db.transaction(async (tx) => {
    const [checklist] = await tx
      .insert(checklistsTable)
      .values({ ownerId, title, sourceText: parsed.data.sourceText })
      .returning();
    await tx.insert(checklistItemsTable).values(
      itemTitles.map((itemTitle, position) => ({
        checklistId: checklist.id,
        position,
        title: itemTitle,
        status: "todo",
      })),
    );
    await tx.insert(collectionChecklistsTable).values({
      collectionId: collection.id,
      checklistId: checklist.id,
    });
    return checklist;
  });
  const items = await db
    .select()
    .from(checklistItemsTable)
    .where(eq(checklistItemsTable.checklistId, created.id))
    .orderBy(asc(checklistItemsTable.position));
  res.status(201).json(CreateCollectionChecklistResponse.parse({
    ...created,
    items: items.map((item) => ({ ...item, status: item.status as (typeof statuses)[number] })),
    totalItems: items.length,
    completedItems: 0,
    progress: 0,
  }));
});

router.put("/collections/:id/checklists/:checklistId", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = AddChecklistToCollectionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid collection checklist." });
    return;
  }
  const [collection] = await db
    .select({ id: collectionsTable.id })
    .from(collectionsTable)
    .where(and(eq(collectionsTable.id, params.data.id), collectionOwnerCondition(ownerId)));
  const [checklist] = await db
    .select({ id: checklistsTable.id })
    .from(checklistsTable)
    .where(and(eq(checklistsTable.id, params.data.checklistId), checklistOwnerCondition(ownerId)));
  if (!collection || !checklist) {
    res.status(404).json({ error: "Collection or checklist not found." });
    return;
  }
  await db.insert(collectionChecklistsTable)
    .values({ collectionId: collection.id, checklistId: checklist.id })
    .onConflictDoNothing();
  res.sendStatus(204);
});

router.delete("/collections/:id/checklists/:checklistId", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = RemoveChecklistFromCollectionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid collection checklist." });
    return;
  }
  const [collection] = await db
    .select({ id: collectionsTable.id })
    .from(collectionsTable)
    .where(and(eq(collectionsTable.id, params.data.id), collectionOwnerCondition(ownerId)));
  if (!collection) {
    res.status(404).json({ error: "Collection not found." });
    return;
  }
  const [checklist] = await db
    .select({ id: checklistsTable.id })
    .from(checklistsTable)
    .where(and(eq(checklistsTable.id, params.data.checklistId), checklistOwnerCondition(ownerId)));
  if (!checklist) {
    res.status(404).json({ error: "Checklist not found." });
    return;
  }
  await db.delete(collectionChecklistsTable).where(and(
    eq(collectionChecklistsTable.collectionId, collection.id),
    eq(collectionChecklistsTable.checklistId, checklist.id),
  ));
  res.sendStatus(204);
});

export default router;