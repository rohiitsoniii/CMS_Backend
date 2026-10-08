import crypto from 'crypto';
import mongoose, { Schema } from 'mongoose';

/**
 * Cluster-wide job lock backed by MongoDB, so scheduled workers run on only
 * one server instance at a time (no double-sent campaigns or publishes).
 */

interface IJobLock {
  _id: string; // lock name
  owner: string;
  expiresAt: Date;
}

const JobLockSchema = new Schema<IJobLock>(
  {
    _id: { type: String },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, collection: 'joblocks' }
);

const JobLock = mongoose.models.JobLock || mongoose.model<IJobLock>('JobLock', JobLockSchema);

/** Unique per process. */
export const INSTANCE_ID = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

async function acquire(name: string, ttlMs: number): Promise<string | null> {
  // A fresh token per acquisition: the lock is exclusive even within one process
  const token = `${INSTANCE_ID}:${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date();
  try {
    const res = await JobLock.findOneAndUpdate(
      { _id: name, expiresAt: { $lte: now } },
      { $set: { owner: token, expiresAt: new Date(now.getTime() + ttlMs) } },
      { upsert: true, new: true }
    ).lean();
    return (res as any)?.owner === token ? token : null;
  } catch (err: any) {
    // Duplicate key → someone holds an unexpired lock
    if (err?.code === 11000) return null;
    throw err;
  }
}

async function release(name: string, token: string) {
  await JobLock.deleteOne({ _id: name, owner: token }).catch(() => undefined);
}

/**
 * Run fn only if this instance acquires the named lock. Returns false when
 * another instance is already running it. ttlMs bounds a crashed holder.
 */
export async function withJobLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | false> {
  if (mongoose.connection.readyState !== 1) return false;
  const token = await acquire(name, ttlMs);
  if (!token) return false;
  try {
    return await fn();
  } finally {
    await release(name, token);
  }
}
