import { disconnectDatabase } from '../config/database.js';
import { rollbackLastBatch, runMigrations } from '../migrations/runner.js';

const command = process.argv[2];

function printUsage(): void {
  console.log('Usage: tsx src/scripts/migrate.ts <up|status|down-last>');
  console.log('  up         Apply all pending migrations');
  console.log('  status     Show applied vs pending migrations');
  console.log('  down-last  Roll back the most recently applied batch');
}

async function main(): Promise<void> {
  if (command !== 'up' && command !== 'status' && command !== 'down-last') {
    printUsage();
    process.exit(1);
  }

  let failed = false;
  try {
    if (command === 'down-last') {
      await rollbackLastBatch();
    } else {
      await runMigrations(command);
    }
  } catch (err) {
    console.error(`❌ Migration '${command}' failed: ${(err as Error).message}`);
    failed = true;
  }

  try {
    await disconnectDatabase();
  } catch (err) {
    console.warn(`⚠️  Error while disconnecting: ${(err as Error).message}`);
  }
  process.exit(failed ? 1 : 0);
}

void main();
