/**
 * Global teardown — runs once after all test files in the worker.
 * Closes the Bull translation queue (connects to Redis at import time)
 * so the worker process can exit cleanly without Redis running.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    const { translationQueue } = await import('../workers/translationWorker.js');
    await translationQueue.close();
  } catch {
    // Queue was never imported — nothing to close
  }
}
