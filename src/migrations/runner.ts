import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { Migration } from '../models/Migration.js';

export type MigrationDirection = 'up' | 'status';
export type MigrationDb = mongoose.mongo.Db;

export interface MigrationModule {
  up: (db: MigrationDb) => Promise<void>;
  down?: (db: MigrationDb) => Promise<void>;
  IRREVERSIBLE?: boolean;
}

export interface MigrationFileEntry {
  /** Migration name (file basename without extension), e.g. `001-ensure-core-indexes`. */
  name: string;
  /** Absolute path to the migration file. */
  file: string;
}

export interface RunMigrationsResult {
  applied: string[];
  skipped: string[];
  pending: string[];
  /** Batch number used for this run, or null when nothing was applied. */
  batch: number | null;
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

export interface RollbackResult {
  rolledBack: string[];
  batch: number;
}

/**
 * Resolve the directory holding versioned migration files.
 * Defaults to `versions/` next to this file, which resolves correctly under
 * both `tsx` (src/migrations/versions) and compiled output (dist/migrations/versions).
 * An explicit `dirOverride` is accepted for testability.
 */
export function resolveVersionsDir(dirOverride?: string): string {
  if (dirOverride) return dirOverride;
  // `versions/` sits next to this file both under `tsx` (src/migrations)
  // and compiled output (dist/migrations). The repo builds to CommonJS
  // (see src/config/index.ts), so plain `__dirname` is correct here.
  return path.join(__dirname, 'versions');
}

/** List migration files (`*.ts` / `*.js`) in a directory, sorted by name. */
export function listMigrationFiles(dir: string): MigrationFileEntry[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.includes('.test.') && !f.endsWith('.d.ts') && !f.endsWith('.d.mts'))
    .sort()
    .map((f) => ({ name: f.replace(/\.(ts|js)$/, ''), file: path.join(dir, f) }));
}

async function loadMigration(file: string): Promise<MigrationModule> {
  const mod = (await import(pathToFileURL(file).href)) as unknown as MigrationModule & { default?: MigrationModule };
  const candidate = mod.default ?? mod;
  if (typeof candidate.up !== 'function') {
    throw new Error(`Migration ${path.basename(file)} must export an async 'up(db)' function`);
  }
  return candidate;
}

async function ensureConnection(): Promise<MigrationDb> {
  if (mongoose.connection.readyState !== 1) {
    await connectDatabase();
  }
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('No active MongoDB connection (mongoose.connection.db is undefined)');
  }
  return db;
}

async function nextBatchNumber(): Promise<number> {
  const last = await Migration.findOne().sort({ batch: -1 }).lean();
  return (last?.batch ?? 0) + 1;
}

/**
 * Run pending migrations (`up`) or report migration status (`status`).
 * Already-applied migrations (recorded in the `migrations` collection) are skipped.
 */
export async function runMigrations(
  direction: MigrationDirection,
  versionsDirOverride?: string
): Promise<RunMigrationsResult | MigrationStatus> {
  const dir = resolveVersionsDir(versionsDirOverride);
  const entries = listMigrationFiles(dir);
  const db = await ensureConnection();
  const appliedDocs = await Migration.find().sort({ name: 1 }).lean();
  const appliedSet = new Set(appliedDocs.map((d) => d.name));
  const pending = entries.filter((e) => !appliedSet.has(e.name));

  if (direction === 'status') {
    const status: MigrationStatus = {
      applied: entries.filter((e) => appliedSet.has(e.name)).map((e) => e.name),
      pending: pending.map((e) => e.name),
    };
    console.log('📊 Migration status');
    console.log(`   Applied (${status.applied.length}):`);
    for (const name of status.applied) console.log(`     ✅ ${name}`);
    console.log(`   Pending (${status.pending.length}):`);
    for (const name of status.pending) console.log(`     ⏳ ${name}`);
    return status;
  }

  if (pending.length === 0) {
    console.log('✅ Database is up to date — no pending migrations.');
    return { applied: [], skipped: entries.map((e) => e.name), pending: [], batch: null };
  }

  const batch = await nextBatchNumber();
  const applied: string[] = [];
  console.log(`🚀 Applying ${pending.length} migration(s) in batch #${batch}...`);
  for (const entry of pending) {
    const mod = await loadMigration(entry.file);
    console.log(`   → ${entry.name} ...`);
    try {
      await mod.up(db);
    } catch (err) {
      console.error(`   ❌ ${entry.name} failed: ${(err as Error).message}`);
      throw err;
    }
    await Migration.create({ name: entry.name, appliedAt: new Date(), batch });
    applied.push(entry.name);
    console.log(`   ✅ ${entry.name} applied (batch #${batch})`);
  }
  console.log(`🎉 All migrations applied (batch #${batch}).`);
  return { applied, skipped: entries.filter((e) => appliedSet.has(e.name)).map((e) => e.name), pending: [], batch };
}

/**
 * Roll back the latest applied batch via each migration's `down()`.
 * Refuses when a migration in the batch is irreversible
 * (`IRREVERSIBLE === true` or no `down` export).
 */
export async function rollbackLastBatch(versionsDirOverride?: string): Promise<RollbackResult> {
  const dir = resolveVersionsDir(versionsDirOverride);
  const byName = new Map(listMigrationFiles(dir).map((e) => [e.name, e]));
  const db = await ensureConnection();
  const last = await Migration.findOne().sort({ batch: -1 }).lean();
  if (!last) {
    console.log('ℹ️  No applied migrations — nothing to roll back.');
    return { rolledBack: [], batch: 0 };
  }
  const batchDocs = await Migration.find({ batch: last.batch }).sort({ name: -1 }).lean();

  // Pre-flight: refuse the whole batch if any member cannot be rolled back.
  for (const doc of batchDocs) {
    const entry = byName.get(doc.name);
    if (!entry) {
      throw new Error(
        `Refusing rollback: migration file for '${doc.name}' not found in ${dir}. ` +
        'Restore the file before rolling back.'
      );
    }
    const mod = await loadMigration(entry.file);
    if (mod.IRREVERSIBLE === true || typeof mod.down !== 'function') {
      throw new Error(
        `Refusing rollback: '${doc.name}' is irreversible (data migration with no safe 'down'). ` +
        'Restore from backup instead.'
      );
    }
  }

  const rolledBack: string[] = [];
  console.log(`↩️  Rolling back batch #${last.batch} (${batchDocs.length} migration(s))...`);
  for (const doc of batchDocs) {
    const entry = byName.get(doc.name);
    if (!entry) continue;
    const mod = await loadMigration(entry.file);
    console.log(`   → ${doc.name} (down) ...`);
    try {
      await mod.down?.(db);
    } catch (err) {
      console.error(`   ❌ ${doc.name} rollback failed: ${(err as Error).message}`);
      throw err;
    }
    await Migration.deleteOne({ name: doc.name });
    rolledBack.push(doc.name);
    console.log(`   ✅ ${doc.name} rolled back`);
  }
  console.log(`🎉 Batch #${last.batch} rolled back.`);
  return { rolledBack, batch: last.batch };
}
