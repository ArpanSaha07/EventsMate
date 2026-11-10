import "server-only";
import { Client, Environment, OrdersController } from "@paypal/paypal-server-sdk";

let orders: OrdersController | undefined;

function credentials() {
  // Sandbox only: live mode is intentionally not implemented for this MVP.
  if (process.env.PAYPAL_ENV !== "sandbox") {
    throw new Error('PayPal is sandbox-only in this project: set PAYPAL_ENV=sandbox.');
  }
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  }
  return { id, secret };
}

/** PayPal Orders v2 controller bound to the sandbox environment. Server-only. */
export function paypalOrders(): OrdersController {
  if (orders) return orders;
  const { id, secret } = credentials();
  const client = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId: id, oAuthClientSecret: secret },
    environment: Environment.Sandbox,
    timeout: 20_000,
  });
  orders = new OrdersController(client);
  return orders;
}

/** Verifies the sandbox credentials by requesting an OAuth token. Used by /api/health. */
export async function verifyPayPalCredentials(): Promise<void> {
  const { id, secret } = credentials();
  const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`PayPal sandbox rejected the credentials (HTTP ${res.status}).`);
  }
}
