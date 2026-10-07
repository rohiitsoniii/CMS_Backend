import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { runInTransaction } from '../transactions.js';

const Scratch = mongoose.models.TxScratch ||
  mongoose.model('TxScratch', new mongoose.Schema({ name: String }));

describe('runInTransaction', () => {
  it('commits writes on success', async () => {
    const id = await runInTransaction(async (session) => {
      const doc = await Scratch.create([{ name: 'committed' }], session ? { session } : {});
      return String(doc[0]._id);
    });
    expect(await Scratch.findById(id)).not.toBeNull();
  });

  it('rolls back writes on failure', async () => {
    await expect(
      runInTransaction(async (session) => {
        await Scratch.create([{ name: 'doomed' }], session ? { session } : {});
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await Scratch.findOne({ name: 'doomed' })).toBeNull();
  });
});
