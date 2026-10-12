import Stripe from "stripe";
import { env } from "../config/env.js";
import { createPaymentSchema } from "../validators/payment.js";

export async function createPaymentIntent(payload) {
  const params = createPaymentSchema.parse(payload);
  if (!env.stripeSecretKey.trim()) {
    throw new Error("STRIPE_SECRET_KEY must be configured to create payments");
  }

  // Initialize on demand so unrelated API routes can run without Stripe credentials.
  const stripe = new Stripe(env.stripeSecretKey);
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(params);
  } catch (error) {
    throw new Error(`Unable to create payment intent: ${error.message}`, { cause: error });
  }

  return {
    paymentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    provider: "stripe"
  };
}
