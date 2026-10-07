import { connectDatabase } from '../config/database';
import { User } from '../models/User';
import { assertScriptSafe } from './guards';

assertScriptSafe({ scriptName: 'setSuperAdmin', destructive: false });

async function main() {
  const email = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'demo@example.com';
  await connectDatabase();
  const u = await User.findOneAndUpdate({ email }, { isSuperAdmin: true }, { new: true });
  if (!u) {
    console.error(`❌ No user found with email ${email}`);
    process.exit(1);
  }
  console.log(`✅ ${email} isSuperAdmin status:`, u?.isSuperAdmin);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
