import type { Db } from 'mongodb';

/**
 * Remove plaintext API key material now that authentication is hash-only
 * (see 003-backfill-apikey-hashes). Run ONLY after 003 and after the
 * hash-lookup code is deployed — legacy plaintext lookup stops working
 * once these fields are gone.
 */
export async function up(db: Db): Promise<void> {
  const unhashed = await db.collection('apikeys').countDocuments({
    $or: [{ apiKeyHash: { $exists: false } }, { apiKeyHash: null }, { apiKeyHash: '' }],
  });
  if (unhashed > 0) {
    throw new Error(
      `Refusing to clear plaintext: ${unhashed} API key(s) still lack apiKeyHash. Run 003 first.`
    );
  }

  const result = await db.collection('apikeys').updateMany(
    {},
    { $unset: { apiKey: '', secretKey: '' } }
  );
  console.log(`[migration 004] cleared plaintext from ${result.modifiedCount} API key(s)`);
}

export const IRREVERSIBLE = true;

export async function down(_db: Db): Promise<void> {
  console.log('[migration 004] down is a no-op (plaintext cannot be recovered by design)');
}
