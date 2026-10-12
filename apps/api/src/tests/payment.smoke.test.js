import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { env } from "../config/env.js";
import { createPaymentIntent } from "../services/paymentService.js";

test("creates a test-mode PaymentIntent against Stripe", {
  skip: process.env.RUN_STRIPE_SMOKE_TEST !== "1"
}, async () => {
  assert.match(env.stripeSecretKey, /^sk_test_\S+$/, "Smoke test requires a Stripe test-mode secret key");
  const stripe = new Stripe(env.stripeSecretKey);
  const result = await createPaymentIntent({ amount: 100, currency: "usd" });
  try {
    assert.match(result.paymentId, /^pi_/);
    assert.ok(result.clientSecret);
    const intent = await stripe.paymentIntents.retrieve(result.paymentId);
    assert.equal(intent.livemode, false);
    assert.equal(intent.amount, 100);
    assert.equal(intent.currency, "usd");
    assert.equal(intent.client_secret, result.clientSecret);
  } finally {
    await stripe.paymentIntents.cancel(result.paymentId);
  }
});
