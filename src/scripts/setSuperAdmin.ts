import { connectDatabase } from '../config/database';
import { User } from '../models/User';

async function main() {
  await connectDatabase();
  const u = await User.findOneAndUpdate({ email: 'demo@example.com' }, { isSuperAdmin: true }, { new: true });
  console.log('✅ Demo user isSuperAdmin status:', u?.isSuperAdmin);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
