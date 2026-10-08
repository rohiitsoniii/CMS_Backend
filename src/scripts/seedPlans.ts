import { Plan } from '../models/Plan';
import { connectDatabase } from '../config/database';
import { assertScriptSafe } from './guards.js';
import { DEFAULT_PLANS as defaultPlans } from '../config/defaultPlans.js';

assertScriptSafe({ scriptName: 'seedPlans', destructive: true });

async function seedPlans() {
  try {
    await connectDatabase();
    
    console.log('🌱 Seeding subscription plans...');
    
    // Clear existing plans
    await Plan.deleteMany({});
    
    // Insert default plans
    await Plan.insertMany(defaultPlans);
    
    console.log('✅ Successfully seeded', defaultPlans.length, 'plans');
    console.log('\n📋 Plans created:');
    defaultPlans.forEach(plan => {
      console.log(`  - ${plan.name}: $${plan.price.monthly}/mo`);
    });
    
    console.log('\n⚠️  IMPORTANT: Update Stripe price IDs in the database!');
    console.log('   Run: db.plans.updateOne({ slug: "free" }, { $set: { "stripePriceId.monthly": "price_xxx" } })');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding plans:', error);
    process.exit(1);
  }
}

seedPlans();
