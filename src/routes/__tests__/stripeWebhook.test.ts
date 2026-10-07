import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import { createTestApp } from '../../test/testApp.js';
import { registerOwner, ensureSubscription } from '../../test/helpers.js';
import { Invoice } from '../../models/Invoice.js';

const app = createTestApp();
const WEBHOOK_SECRET = 'whsec_test_secret_1234567890';

const invoicePaidEvent = (id: string): string =>
  JSON.stringify({
    id,
    object: 'event',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_test_1',
        object: 'invoice',
        customer: 'cus_test',
        amount_paid: 2900,
        currency: 'usd',
        number: 'INV-1',
        status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
        hosted_invoice_url: null,
        invoice_pdf: null,
        lines: { data: [] },
      },
    },
  });

// Builds a real Stripe signature header: t=<ts>,v1=<hmac(timestamp.payload)>
const sign = (payload: string): string => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
};

describe('stripe webhook verification', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it('accepts a validly signed event and records the invoice', async () => {
    const { auth } = await registerOwner(app, { email: 'stripe1@example.com' });
    await ensureSubscription(auth!.tenantId);

    const payload = invoicePaidEvent('evt_test_1');
    const res = await request(app)
      .post('/api/v1/billing/webhook')
      .set('stripe-signature', sign(payload))
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(await Invoice.countDocuments({ stripeInvoiceId: 'in_test_1' })).toBe(1);
  });

  it('deduplicates retried deliveries (single invoice)', async () => {
    const { auth } = await registerOwner(app, { email: 'stripe2@example.com' });
    await ensureSubscription(auth!.tenantId);

    const payload = invoicePaidEvent('evt_test_2');
    const headers = { 'stripe-signature': sign(payload), 'Content-Type': 'application/json' };

    const first = await request(app).post('/api/v1/billing/webhook').set(headers).send(payload);
    expect(first.status).toBe(200);

    const replay = await request(app).post('/api/v1/billing/webhook').set(headers).send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(await Invoice.countDocuments({ stripeInvoiceId: 'in_test_1' })).toBe(1);
  });

  it('rejects tampered payload and missing signature', async () => {
    await registerOwner(app, { email: 'stripe3@example.com' });
    const payload = invoicePaidEvent('evt_test_3');

    const tampered = await request(app)
      .post('/api/v1/billing/webhook')
      .set('stripe-signature', sign(payload))
      .set('Content-Type', 'application/json')
      .send(payload.replace('2900', '2901'));
    expect(tampered.status).toBe(400);
    expect(tampered.body.success).toBe(false);

    const missing = await request(app)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(missing.status).toBe(400);
  });
});
