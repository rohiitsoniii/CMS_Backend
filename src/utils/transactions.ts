import mongoose from 'mongoose';

let warnedFallback = false;

/**
 * Run work in a MongoDB transaction when the server supports it
 * (replica set / sharded cluster / Atlas). Self-hosted single-node
 * deployments fall back to sequential execution with a one-time warning —
 * callers must remain correct (if non-atomic) in that mode.
 *
 * Prefer structuring multi-write ops so fallback order is safe
 * (e.g. create parent before child).
 */
export const runInTransaction = async <T>(
  fn: (session: mongoose.ClientSession | undefined) => Promise<T>
): Promise<T> => {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (error: any) {
    if (isNonReplicaSetError(error)) {
      if (!warnedFallback) {
        warnedFallback = true;
        console.warn(
          '[transactions] Standalone MongoDB detected — running without transaction. ' +
            'Use a replica set for atomic multi-write guarantees.'
        );
      }
      return fn(undefined);
    }
    throw error;
  } finally {
    await session.endSession().catch(() => undefined);
  }
};

const isNonReplicaSetError = (error: any): boolean => {
  if (!error) return false;
  if (error.code === 20) return true; // IllegalOperation
  const msg = String(error.message || error);
  return (
    msg.includes('Transaction numbers are only allowed on a replica set') ||
    msg.includes('does not support retryable writes') ||
    msg.includes('This MongoDB deployment does not support retryable writes')
  );
};
