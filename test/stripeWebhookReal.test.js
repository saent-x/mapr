/**
 * Real (non-grep) test for the Stripe webhook handler.
 *
 * Exercises the actual `handleStripeWebhook` code path. Specifically:
 *   - An invalid Stripe-Signature is rejected with statusCode 400 and
 *     code 'INVALID_SIGNATURE'.
 *
 * That behavior is the load-bearing security guarantee — without it, an
 * unauthenticated caller could craft webhook payloads that grant Pro
 * access. This test imports the real module and proves the rejection
 * happens, instead of the grep-style assertions in the legacy suite.
 *
 * Note: the deeper paths (idempotency dedup, subscription-grant logic)
 * require InstantDB admin and a Postgres connection; they're covered
 * separately in CI integration tests once those mocks are wired up.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('handleStripeWebhook signature verification', () => {
  it('rejects an obviously invalid signature with statusCode 400', async (t) => {
    const prevSecret = process.env.STRIPE_SECRET_KEY;
    const prevWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test_for_signature_verification';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_for_verification';

    try {
      // Dynamic import to ensure the env vars above are picked up by the
      // lazily-initialized Stripe client.
      const { handleStripeWebhook } = await import('../server/stripe.js');
      const rawBody = JSON.stringify({ id: 'evt_fake', type: 'noop' });

      await assert.rejects(
        () => handleStripeWebhook(rawBody, 'definitely-not-a-valid-signature'),
        (err) => {
          assert.equal(err.statusCode, 400, 'must surface 400 statusCode');
          assert.equal(err.code, 'INVALID_SIGNATURE', 'must use INVALID_SIGNATURE error code');
          return true;
        }
      );
    } finally {
      if (prevSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = prevSecret;
      if (prevWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = prevWebhook;
    }
  });

  it('rejects an empty signature', async () => {
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy';
    const { handleStripeWebhook } = await import('../server/stripe.js');
    await assert.rejects(
      () => handleStripeWebhook('{}', ''),
      (err) => err.statusCode === 400 && err.code === 'INVALID_SIGNATURE',
    );
  });
});
