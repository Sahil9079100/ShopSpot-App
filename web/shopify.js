import { BillingInterval, ApiVersion } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
import { restResources } from "@shopify/shopify-api/rest/admin/2025-07";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.MONGODB_URL) {
  throw new Error(
    "Missing MONGODB_URL. Set it in web/.env (it should be gitignored)."
  );
}

export const PREMIUM_PLAN_PRICE = Number(process.env.PREMIUM_PLAN_PRICE ?? 10);

if (!Number.isFinite(PREMIUM_PLAN_PRICE) || PREMIUM_PLAN_PRICE <= 0) {
  throw new Error(
    `Invalid PREMIUM_PLAN_PRICE in web/.env: "${process.env.PREMIUM_PLAN_PRICE}". Must be a positive number.`
  );
}

const billingConfig = {
  shop_the_look_premium: {
    lineItems: [
      {
        amount: PREMIUM_PLAN_PRICE,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
  },
};

const shopify = shopifyApp({
  api: {
    apiVersion: ApiVersion.July25,
    restResources,
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    hostName: process.env.HOST ? process.env.HOST.replace(/https?:\/\//, "") : "localhost",
    scopes: process.env.SCOPES ? process.env.SCOPES.split(",") : [],
    billing: billingConfig,
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
  sessionStorage: new MongoDBSessionStorage(
    process.env.MONGODB_URL,
    process.env.MONGO_DB_NAME || "lookspot"
  ),
});

export default shopify;
