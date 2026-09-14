// Direct integration against Iyzico's Checkout Form API (Launch Path p4) —
// a small hand-rolled client using Node's built-in `crypto` + `fetch`
// rather than the official `iyzipay` npm package, to avoid pulling in its
// callback-style API and an extra dependency for something this small.
//
// Deliberately env-var gated end to end: every function here no-ops or
// throws a clear "not configured" error if IYZICO_API_KEY/IYZICO_SECRET_KEY
// aren't set, and nothing in the booking flow calls into this file unless
// isIyzicoConfigured() is true first. That's what lets this ship without
// touching the live pay-at-studio flow — see book/[slug]/actions.ts.
//
// Signing scheme (IYZWSv2, confirmed against Iyzico's own docs Sep 2026 —
// https://docs.iyzico.com/en/getting-started/preliminaries/authentication/hmacsha256-auth):
//   1. randomKey = `${Date.now()}${random 8-9 digits}`
//   2. payload = randomKey + uriPath + JSON body
//   3. signature = HMAC-SHA256(payload, secretKey) as a hex digest
//   4. authString = `apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`
//   5. Authorization: `IYZWSv2 ${base64(authString)}`
//
// Sandbox vs live is the same distinction already documented in the build
// log for the merchant dashboard itself: sandbox keys are prefixed
// `sandbox-`, and point at a different host.

import { createHmac, randomInt } from "crypto";

export function isIyzicoConfigured() {
  return Boolean(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY);
}

function baseUrl() {
  // Let a real live key ("no sandbox- prefix") default to the live host,
  // and a sandbox key default to the sandbox host, without needing a
  // separate env var most of the time — but IYZICO_BASE_URL always wins
  // if set, for the rare case that's wrong.
  if (process.env.IYZICO_BASE_URL) return process.env.IYZICO_BASE_URL;
  const key = process.env.IYZICO_API_KEY ?? "";
  return key.startsWith("sandbox-") ? "https://sandbox-api.iyzipay.com" : "https://api.iyzipay.com";
}

function randomKey() {
  return `${Date.now()}${randomInt(100_000_000, 999_999_999)}`;
}

function authHeader(uriPath: string, bodyJson: string) {
  const apiKey = process.env.IYZICO_API_KEY;
  const secretKey = process.env.IYZICO_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error("Iyzico is not configured (IYZICO_API_KEY/IYZICO_SECRET_KEY missing)");
  }
  const rnd = randomKey();
  const payload = rnd + uriPath + bodyJson;
  const signature = createHmac("sha256", secretKey).update(payload).digest("hex");
  const authString = `apiKey:${apiKey}&randomKey:${rnd}&signature:${signature}`;
  const encoded = Buffer.from(authString, "utf8").toString("base64");
  return { Authorization: `IYZWSv2 ${encoded}`, "x-iyzi-rnd": rnd };
}

async function iyzicoPost<T>(uriPath: string, body: Record<string, unknown>): Promise<T> {
  const bodyJson = JSON.stringify(body);
  const headers = authHeader(uriPath, bodyJson);
  const res = await fetch(`${baseUrl()}${uriPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: bodyJson,
  });
  const json = (await res.json()) as T;
  return json;
}

export type CheckoutFormBasketItem = {
  id: string;
  name: string;
  category: string;
  price: string; // decimal string, e.g. "1500.00"
};

export type CheckoutFormBuyer = {
  id: string;
  name: string;
  surname: string;
  email: string;
  phone: string;
  identityNumber: string; // Iyzico requires a TC/identity number; "11111111111" is their documented placeholder for buyers who don't have one on file
  city: string;
  country: string;
  address: string;
};

export type InitializeCheckoutFormParams = {
  conversationId: string;
  price: string; // decimal string
  currency: "TRY" | "USD" | "EUR" | "GBP" | "NOK" | "CHF";
  basketId: string;
  callbackUrl: string;
  buyer: CheckoutFormBuyer;
  basketItems: CheckoutFormBasketItem[];
};

export type InitializeCheckoutFormResult = {
  status: "success" | "failure";
  token?: string;
  paymentPageUrl?: string;
  checkoutFormContent?: string;
  errorMessage?: string;
  errorCode?: string;
  conversationId?: string;
};

export async function initializeCheckoutForm(
  params: InitializeCheckoutFormParams
): Promise<InitializeCheckoutFormResult> {
  const address = {
    contactName: `${params.buyer.name} ${params.buyer.surname}`,
    city: params.buyer.city,
    country: params.buyer.country,
    address: params.buyer.address,
  };

  return iyzicoPost<InitializeCheckoutFormResult>(
    "/payment/iyzipos/checkoutform/initialize/auth/ecom",
    {
      locale: "en",
      conversationId: params.conversationId,
      price: params.price,
      paidPrice: params.price,
      currency: params.currency,
      basketId: params.basketId,
      paymentGroup: "PRODUCT",
      callbackUrl: params.callbackUrl,
      enabledInstallments: [1],
      buyer: {
        id: params.buyer.id,
        name: params.buyer.name,
        surname: params.buyer.surname,
        gsmNumber: params.buyer.phone,
        email: params.buyer.email,
        identityNumber: params.buyer.identityNumber,
        registrationAddress: params.buyer.address,
        city: params.buyer.city,
        country: params.buyer.country,
        ip: "85.34.78.112",
      },
      shippingAddress: address,
      billingAddress: address,
      basketItems: params.basketItems.map((item) => ({
        id: item.id,
        name: item.name,
        category1: item.category,
        itemType: "VIRTUAL",
        price: item.price,
      })),
    }
  );
}

export type RetrieveCheckoutFormResult = {
  status: "success" | "failure";
  paymentStatus?: "SUCCESS" | "FAILURE" | "INIT_THREEDS" | "CALLBACK_THREEDS" | "BKM_POS_SELECTED";
  paymentId?: string;
  fraudStatus?: number;
  price?: string;
  paidPrice?: string;
  basketId?: string;
  errorMessage?: string;
  conversationId?: string;
  raw?: unknown;
};

// Always call this from the callback route to confirm what actually
// happened — never trust the callback POST body alone (it's guest-facing
// and unauthenticated at the network level).
export async function retrieveCheckoutForm(token: string, conversationId?: string): Promise<RetrieveCheckoutFormResult> {
  const result = await iyzicoPost<RetrieveCheckoutFormResult & Record<string, unknown>>(
    "/payment/iyzipos/checkoutform/auth/ecom/detail",
    { locale: "en", token, conversationId }
  );
  return { ...result, raw: result };
}

// Payment succeeded only when both are true — a fraudStatus of 0 (under
// review) or -1 (rejected) means don't treat it as paid yet, per Iyzico's
// own docs.
export function checkoutFormWasSuccessful(result: RetrieveCheckoutFormResult): boolean {
  return result.status === "success" && result.paymentStatus === "SUCCESS" && result.fraudStatus === 1;
}
