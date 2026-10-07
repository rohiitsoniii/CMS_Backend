import type { Db } from 'mongodb';
import crypto from 'crypto';

/**
 * Backfill HMAC-SHA256 lookup hashes for API keys created before
 * hash-only authentication. Uses the same API_KEY_SECRET the app uses at
 * runtime — run with the production secret or hashes won't match.
 *
 * Safe to re-run: only touches docs missing apiKeyHash.
 */
export async function up(db: Db): Promise<void> {
  const secret = process.env.API_KEY_SECRET;
  if (!secret) {
    throw new Error('API_KEY_SECRET must be set to backfill API key hashes');
  }

  const hmac = (value: string): string =>
    crypto.createHmac('sha256', secret).update(value).digest('hex');

  const cursor = db.collection('apikeys').find({
    $or: [{ apiKeyHash: { $exists: false } }, { apiKeyHash: null }, { apiKeyHash: '' }],
    apiKey: { $exists: true, $ne: null },
  });

  let backfilled = 0;
  for await (const doc of cursor as AsyncIterable<any>) {
    const set: Record<string, string> = { apiKeyHash: hmac(doc.apiKey) };
    if (doc.secretKey && !doc.secretKeyHash) {
      set.secretKeyHash = hmac(doc.secretKey);
    }
    if (!doc.keyPrefix && typeof doc.apiKey === 'string') {
      set.keyPrefix = doc.apiKey.slice(0, 12);
    }
    await db.collection('apikeys').updateOne({ _id: doc._id }, { $set: set });
    backfilled += 1;
  }

  console.log(`[migration 003] backfilled hashes for ${backfilled} API key(s)`);
}

export async function down(_db: Db): Promise<void> {
  console.log('[migration 003] down is a no-op (hashes are harmless to keep)');
}
