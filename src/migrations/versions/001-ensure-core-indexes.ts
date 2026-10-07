import type { Db } from 'mongodb';

interface DesiredIndex {
  collection: string;
  key: { [key: string]: 1 | -1 };
  options: { name: string; unique?: boolean; sparse?: boolean };
}

/**
 * Critical indexes the application expects (mirrors the compound indexes
 * declared in the Mongoose schemas). Names match Mongoose's default
 * `{field}_{direction}` convention so auto-sync and this migration agree.
 */
const DESIRED_INDEXES: DesiredIndex[] = [
  {
    collection: 'users',
    key: { tenantId: 1, email: 1 },
    options: { name: 'tenantId_1_email_1', unique: true },
  },
  {
    collection: 'contents',
    key: { projectId: 1, slug: 1 },
    options: { name: 'projectId_1_slug_1', unique: true, sparse: true },
  },
  {
    collection: 'teammembers',
    key: { projectId: 1, email: 1 },
    options: { name: 'projectId_1_email_1', unique: true },
  },
  {
    collection: 'webhooklogs',
    key: { webhookId: 1, status: 1, createdAt: -1 },
    options: { name: 'webhookId_1_status_1_createdAt_-1' },
  },
  {
    collection: 'apikeys',
    key: { apiKey: 1 },
    options: { name: 'apiKey_1', unique: true },
  },
];

function sameKey(a: unknown, b: { [key: string]: 1 | -1 }): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function existingIndexes(
  db: Db,
  collectionName: string
): Promise<Array<{ name?: string; key: unknown }>> {
  try {
    return (await db.collection(collectionName).listIndexes().toArray()) as Array<{
      name?: string;
      key: unknown;
    }>;
  } catch (err) {
    // Fresh database: the namespace does not exist yet. Treat as "no indexes"
    // so createIndex below creates the (empty) collection with the index.
    const code = (err as { code?: number }).code;
    if (code === 26 || /ns does not exist/i.test((err as Error).message)) return [];
    throw err;
  }
}

/** Idempotent: skips indexes that already exist (by name or key). */
export async function up(db: Db): Promise<void> {
  for (const spec of DESIRED_INDEXES) {
    const collection = db.collection(spec.collection);
    const existing = await existingIndexes(db, spec.collection);
    if (existing.some((ix) => ix.name === spec.options.name || sameKey(ix.key, spec.key))) {
      console.log(`   [001] index ${spec.options.name} on '${spec.collection}' already exists — skipping`);
      continue;
    }
    try {
      await collection.createIndex(spec.key, spec.options);
      console.log(`   [001] created index ${spec.options.name} on '${spec.collection}'`);
    } catch (err) {
      // Best-effort: e.g. a unique index cannot build over pre-existing
      // duplicates. Warn loudly but keep the migration moving so one dirty
      // collection does not block the whole deploy; the operator must
      // clean the data and re-run (the missing index will be retried,
      // because only successfully created indexes are skipped above —
      // note a *failed* create that still registered the name will be
      // skipped, in which case drop it manually and re-run).
      console.warn(
        `   [001] WARNING: could not create index ${spec.options.name} on '${spec.collection}': ${(err as Error).message}`
      );
    }
  }
}

/**
 * Best-effort reversal: drops only the indexes listed above.
 * Never touches `_id_` or any index this migration did not declare.
 */
export async function down(db: Db): Promise<void> {
  for (const spec of [...DESIRED_INDEXES].reverse()) {
    if (spec.options.name === '_id_') continue;
    try {
      await db.collection(spec.collection).dropIndex(spec.options.name);
      console.log(`   [001] dropped index ${spec.options.name} on '${spec.collection}'`);
    } catch (err) {
      console.warn(
        `   [001] WARNING: could not drop index ${spec.options.name} on '${spec.collection}' (may not exist): ${(err as Error).message}`
      );
    }
  }
}
