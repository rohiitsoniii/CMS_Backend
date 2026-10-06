import { MongoMemoryServer } from 'mongodb-memory-server';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(process.cwd(), '.mongo-data');
if (!fs.existsSync(dbPath)) {
  fs.mkdirSync(dbPath, { recursive: true });
}

async function start() {
  console.log('🚀 Starting MongoDB Server on port 27017...');
  try {
    const mongod = await MongoMemoryServer.create({
      instance: {
        port: 27017,
        dbPath: dbPath,
        dbName: 'headless_cms',
        storageEngine: 'wiredTiger',
      },
    });

    const uri = mongod.getUri();
    console.log(`✅ MongoDB running at: ${uri}`);
    console.log(`📦 Data directory: ${dbPath}`);

    process.on('SIGINT', async () => {
      console.log('Stopping MongoDB...');
      await mongod.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Stopping MongoDB...');
      await mongod.stop();
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Failed to start embedded MongoDB:', err);
    process.exit(1);
  }
}

start();
