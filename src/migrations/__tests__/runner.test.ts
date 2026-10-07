import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Migration } from '../../models/Migration.js';
import { rollbackLastBatch, runMigrations } from '../runner.js';

const MARKER_COLLECTION = '__migration_runner_test';

beforeEach(async () => {
  // The global setup only clears Mongoose-registered collections; marker docs
  // are written via the raw driver, so clear them explicitly for isolation.
  const { default: mongoose } = await import('mongoose');
  if (mongoose.connection.db !== undefined) {
    await mongoose.connection.db.collection(MARKER_COLLECTION).deleteMany({});
  }
});

function writeFakeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-test-'));
  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, filename), content);
  }
  return dir;
}

const REVERSIBLE_UP = [
  'export async function up(db: any): Promise<void> {',
  `  await db.collection('${MARKER_COLLECTION}').insertOne({ marker: '001' });`,
  '}',
  'export async function down(db: any): Promise<void> {',
  `  await db.collection('${MARKER_COLLECTION}').deleteOne({ marker: '001' });`,
  '}',
  '',
].join('\n');

const IRREVERSIBLE_UP = [
  'export const IRREVERSIBLE = true;',
  'export async function up(db: any): Promise<void> {',
  `  await db.collection('${MARKER_COLLECTION}').insertOne({ marker: '002' });`,
  '}',
  'export async function down(_db: any): Promise<void> {',
  "  console.warn('no-op');",
  '}',
  '',
].join('\n');

describe('migration runner', () => {
  it('applies pending migrations in order and records them with a batch number', async () => {
    const dir = writeFakeDir({
      '001-fake-a.ts': REVERSIBLE_UP,
      '002-fake-b.ts': IRREVERSIBLE_UP,
    });

    const result = await runMigrations('up', dir);
    if (!('batch' in result)) throw new Error('expected RunMigrationsResult');
    expect(result.applied).toEqual(['001-fake-a', '002-fake-b']);
    expect(result.batch).toBe(1);

    const records = await Migration.find().sort({ name: 1 }).lean();
    expect(records.map((r) => r.name)).toEqual(['001-fake-a', '002-fake-b']);
    expect(records.every((r) => r.batch === 1)).toBe(true);
    for (const record of records) {
      expect(record.appliedAt).toBeInstanceOf(Date);
    }
  });

  it('skips already-applied migrations on re-run (idempotent)', async () => {
    const dir = writeFakeDir({ '001-fake-a.ts': REVERSIBLE_UP });

    const first = await runMigrations('up', dir);
    if (!('batch' in first)) throw new Error('expected RunMigrationsResult');
    expect(first.applied).toEqual(['001-fake-a']);

    const second = await runMigrations('up', dir);
    if (!('batch' in second)) throw new Error('expected RunMigrationsResult');
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['001-fake-a']);
    expect(second.batch).toBeNull();

    // up() must have run exactly once
    const { default: mongoose } = await import('mongoose');
    const count =
      mongoose.connection.db === undefined
        ? 0
        : await mongoose.connection.db.collection(MARKER_COLLECTION).countDocuments({ marker: '001' });
    expect(count).toBe(1);
  });

  it('status lists applied vs pending migrations', async () => {
    const dir = writeFakeDir({ '001-fake-a.ts': REVERSIBLE_UP });
    await runMigrations('up', dir);

    // A new migration file appears after the first run
    fs.writeFileSync(path.join(dir, '002-fake-b.ts'), IRREVERSIBLE_UP);

    const status = await runMigrations('status', dir);
    if (!('applied' in status) || 'batch' in status) throw new Error('expected MigrationStatus');
    expect(status.applied).toEqual(['001-fake-a']);
    expect(status.pending).toEqual(['002-fake-b']);
  });

  it('down-last rolls back the latest batch via down()', async () => {
    const dir = writeFakeDir({ '001-fake-a.ts': REVERSIBLE_UP });
    await runMigrations('up', dir);

    const result = await rollbackLastBatch(dir);
    expect(result.batch).toBe(1);
    expect(result.rolledBack).toEqual(['001-fake-a']);
    expect(await Migration.countDocuments()).toBe(0);
  });

  it('down-last refuses irreversible migrations and keeps their records', async () => {
    const dir = writeFakeDir({ '001-fake-a.ts': IRREVERSIBLE_UP });
    await runMigrations('up', dir);

    await expect(rollbackLastBatch(dir)).rejects.toThrow(/irreversible/i);
    expect(await Migration.countDocuments()).toBe(1);
  });
});
