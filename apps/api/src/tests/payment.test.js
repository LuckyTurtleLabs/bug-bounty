import test, { beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { env } from "../config/env.js";
import { createPaymentIntent } from "../services/paymentService.js";
import { createPayment } from "../controllers/paymentController.js";

const originalKey = env.stripeSecretKey;
const intent = {
  id: "pi_test_123",
  client_secret: "pi_test_123_secret_test",
  amount: 1500,
  currency: "usd"
};
let create;

beforeEach(() => {
  env.stripeSecretKey = "sk_test_mock_only";
  create = mock.method(Stripe.resources.PaymentIntents.prototype, "create", async () => intent);
});

afterEach(() => {
  mock.restoreAll();
  env.stripeSecretKey = originalKey;
});

test("creates a Stripe intent with default currency and maps its response", async () => {
  const result = await createPaymentIntent({ amount: 1500 });
  assert.deepEqual(create.mock.calls[0].arguments, [{ amount: 1500, currency: "usd" }]);
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(result, {
    paymentId: intent.id,
    clientSecret: intent.client_secret,
    amount: intent.amount,
    currency: intent.currency,
    provider: "stripe"
  });
});

test("normalizes currency, forwards metadata, and excludes arbitrary Stripe options", async () => {
  const metadata = { jobId: "job_123" };
  await createPaymentIntent({ amount: 2300, currency: "EUR", metadata, confirm: true });
  assert.deepEqual(create.mock.calls[0].arguments, [{ amount: 2300, currency: "eur", metadata }]);
});

test("preserves the null currency default", async () => {
  await createPaymentIntent({ amount: 1500, currency: null });
  assert.equal(create.mock.calls[0].arguments[0].currency, "usd");
});

test("rejects missing and malformed payloads before calling Stripe", async () => {
  for (const payload of [undefined, null, [], "payment", {}]) {
    await assert.rejects(createPaymentIntent(payload));
  }
  assert.equal(create.mock.callCount(), 0);
});

test("rejects invalid amounts before calling Stripe", async () => {
  for (const amount of [undefined, null, 0, -1, 1.5, "1500", true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(createPaymentIntent({ amount }), /amount/);
  }
  assert.equal(create.mock.callCount(), 0);
});

test("rejects malformed currencies before calling Stripe", async () => {
  for (const currency of ["", "us", "usdd", "123", " usd", 123, {}, []]) {
    await assert.rejects(createPaymentIntent({ amount: 1500, currency }), /currency/);
  }
  assert.equal(create.mock.callCount(), 0);
});

test("validates metadata types and Stripe size limits before calling Stripe", async () => {
  const tooManyKeys = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`key${i}`, "value"]));
  for (const metadata of [null, [], "bad", { jobId: 123 }, { jobId: {} },
    { "": "value" }, { "job[id]": "value" }, { ["k".repeat(41)]: "value" },
    { jobId: "v".repeat(501) }, tooManyKeys]) {
    await assert.rejects(createPaymentIntent({ amount: 1500, metadata }), /metadata/);
  }
  assert.equal(create.mock.callCount(), 0);
});

test("accepts metadata at Stripe's size limits", async () => {
  const metadata = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [String(i).padStart(40, "k"), "v".repeat(500)]));
  await createPaymentIntent({ amount: 1500, metadata });
  assert.deepEqual(create.mock.calls[0].arguments[0].metadata, metadata);
});

test("reports missing configuration without making a Stripe request", async () => {
  for (const key of ["", "   "]) {
    env.stripeSecretKey = key;
    await assert.rejects(createPaymentIntent({ amount: 1500 }), /STRIPE_SECRET_KEY/);
  }
  assert.equal(create.mock.callCount(), 0);
});

test("preserves Stripe error messages and causes", async () => {
  for (const ErrorType of [Stripe.errors.StripeCardError, Stripe.errors.StripeInvalidRequestError,
    Stripe.errors.StripeAuthenticationError, Stripe.errors.StripeConnectionError]) {
    const original = new ErrorType({ message: "Original Stripe failure" });
    create.mock.mockImplementation(async () => { throw original; });
    await assert.rejects(createPaymentIntent({ amount: 1500 }), (error) => {
      assert.equal(error.message, "Unable to create payment intent: Original Stripe failure");
      assert.equal(error.cause, original);
      return true;
    });
  }
});

test("payment controller returns the client secret with status 201", async () => {
  const res = {
    status: mock.fn(function () { return this; }),
    json: mock.fn()
  };
  const next = mock.fn();
  await createPayment({ body: { amount: 1500 } }, res, next);
  assert.equal(res.status.mock.calls[0].arguments[0], 201);
  assert.equal(res.json.mock.calls[0].arguments[0].data.clientSecret, intent.client_secret);
  assert.equal(next.mock.callCount(), 0);
});

test("payment controller forwards validation and Stripe failures to Express", async () => {
  const next = mock.fn();
  await createPayment({ body: { amount: 0 } }, {}, next);
  assert.match(next.mock.calls[0].arguments[0].message, /amount/);
  const original = new Stripe.errors.StripeInvalidRequestError({ message: "Unsupported currency" });
  create.mock.mockImplementation(async () => { throw original; });
  await createPayment({ body: { amount: 1500 } }, {}, next);
  assert.equal(next.mock.callCount(), 2);
  assert.equal(next.mock.calls[1].arguments[0].cause, original);
});
