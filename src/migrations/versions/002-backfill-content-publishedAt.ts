import type { Db } from 'mongodb';

const BATCH_SIZE = 500;

/**
 * Idempotent backfill: for `contents` documents with `status === 'published'`
 * but no `meta.publishedAt`, set `meta.publishedAt = updatedAt || createdAt`.
 * Processes in batches of 500; re-running only touches still-missing docs.
 */
export async function up(db: Db): Promise<void> {
  const collection = db.collection('contents');
  const filter = {
    status: 'published',
    $or: [{ 'meta.publishedAt': { $exists: false } }, { 'meta.publishedAt': null }],
  };

  let total = 0;
  let iteration = 0;
  for (;;) {
    const docs = await collection
      .find(filter, { projection: { updatedAt: 1, createdAt: 1 } })
      .limit(BATCH_SIZE)
      .toArray();
    if (docs.length === 0) break;

    iteration += 1;
    const ops = docs.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { 'meta.publishedAt': doc.updatedAt ?? doc.createdAt ?? new Date() } },
      },
    }));
    const result = await collection.bulkWrite(ops);
    total += result.modifiedCount;
    console.log(`   [002] iteration ${iteration}: updated ${result.modifiedCount} doc(s) (total ${total})`);
  }
  console.log(`   [002] backfill complete — ${total} Content doc(s) updated over ${iteration} iteration(s)`);
}

/** Irreversible by design: original "missing value" state cannot be reconstructed. */
export const IRREVERSIBLE = true;

/**
 * Documented no-op. This is a data backfill and cannot be safely reversed
 * (we cannot know which docs originally lacked `meta.publishedAt`).
 * The runner refuses `down-last` for this migration; restore from backup if needed.
 */
export async function down(_db: Db): Promise<void> {
  console.warn(
    '   [002] WARNING: down is a no-op — backfilling meta.publishedAt is irreversible by design. Restore from backup if the values must be reverted.'
  );
}
