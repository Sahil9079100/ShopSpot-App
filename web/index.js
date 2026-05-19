// @ts-check
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";
import { createProxyMiddleware } from "http-proxy-middleware";
import { RequestedTokenType } from "@shopify/shopify-api";

import shopify, { PREMIUM_PLAN_PRICE } from "./shopify.js";
import cancelSubscription from "./cancel-subscription.js";
import dotenv from "dotenv";

dotenv.config();

/* -------------------------------------------------------------------------- */
/*                                   CONFIG                                   */
/* -------------------------------------------------------------------------- */

const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "3000", 10);
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || "3000", 10);
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const STATIC_PATH = `${process.cwd()}/frontend/dist`;
const VITE_DEV_PATH_REGEX = /^(?:\/@vite|\/@react-refresh|\/src\/|\/node_modules\/|\/assets\/|\/index\.jsx$|\/App\.jsx$|\/Routes\.jsx$|\/dev_embed\.js$|\/pages\/|\/components\/|\/hooks\/)/;

// Active plan handle. Must match a key in `billingConfig` in web/shopify.js.
// IMPORTANT: this MUST NOT match any plan registered in Partner Dashboard
// (Managed Pricing) — Shopify rejects Billing-API calls for handles that
// also exist on the PD side, returning a 403 Forbidden. Keep this handle
// unique to the app-managed billing flow. PREMIUM_PLAN_PRICE in web/.env
// is the source of truth for the actual charge amount.
const PREMIUM_PLAN = "shop_the_look_premium";

// Older plan handles still recognized so existing subscribers under prior
// names are still treated as Premium. `normalizePlanName` maps any of these
// to PREMIUM_PLAN for UI consistency.
const LEGACY_PAID_PLANS = [
  "premium-plan",
  "shop_the_look_starter",
  "shop_the_look_pro",
  "shop_the_look_freemium",
];
const BILLING_CHECK_PLANS = [PREMIUM_PLAN, ...LEGACY_PAID_PLANS];
const MEROXIO = "meroxio";

// Metafield key used in the storefront theme blocks to gate Premium features
// (`app.metafields.meroxio.shop_the_look_premium`). Kept stable across plan-
// handle migrations so existing themes don't break.
const PREMIUM_PLAN_KEY = "shop_the_look_premium";

// Billing mode. Dev stores REQUIRE test charges (real charges are rejected).
// Set SHOPIFY_BILLING_IS_TEST=false in production to enable real charges.
// Defaults to true (safer — won't accidentally charge real money in dev).
const IS_TEST =
  (process.env.SHOPIFY_BILLING_IS_TEST ?? "true").toLowerCase() !== "false";
console.log(
  `[startup] Billing mode: ${IS_TEST ? "TEST (no real charges)" : "PRODUCTION (real charges)"}`
);

const HTTP_STATUS = {
  OK: 200,
  INTERNAL_ERROR: 500,
};

/**
 * Normalizes legacy paid plans so the UI behaves as a simple Free/Premium model.
 * @param {string | undefined} planName
 */
const normalizePlanName = (planName) => {
  if (!planName) return planName;
  return LEGACY_PAID_PLANS.includes(planName) ? PREMIUM_PLAN : planName;
};

/* -------------------------------------------------------------------------- */
/*                                EXPRESS APP                                 */
/* -------------------------------------------------------------------------- */

const app = express();
app.use(express.json());

/* -------------------------------------------------------------------------- */
/*                            SHOPIFY AUTH (TOKEN EXCHANGE)                   */
/* -------------------------------------------------------------------------- */

// Webhook endpoint (no auth required — Shopify sends HMAC-signed requests)
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: {} })
);

// OAuth install + re-auth routes. /api/billing/start redirects here when
// the cached offline token is stale (401 from Shopify). shopify.auth.begin()
// initiates the OAuth grant; shopify.auth.callback() exchanges the code for
// a fresh offline token and stores the session; redirectToShopifyOrAppRoot
// returns the merchant to the embedded admin URL after.
//
// Wrapper around auth.begin: append `grant_options[]=expiring` to the
// authorize URL so Shopify issues an EXPIRING offline access token. Without
// this, shopify-api 13.0.0 emits an authorize URL with no grant_options,
// and Shopify (in older app configurations) issues a non-expiring offline
// token. Shopify has deprecated those — every Admin API call with one
// returns 403 "Non-expiring access tokens are no longer accepted".
app.get(shopify.config.auth.path, (req, res, next) => {
  const originalRedirect = res.redirect.bind(res);
  res.redirect = function patchedRedirect(...args) {
    const url = typeof args[0] === "number" ? args[1] : args[0];
    if (typeof url === "string" && url.includes("/admin/oauth/authorize")) {
      try {
        const u = new URL(url);
        if (!u.searchParams.getAll("grant_options[]").includes("expiring")) {
          u.searchParams.append("grant_options[]", "expiring");
        }
        const newUrl = u.toString();
        console.log(`[auth/begin] requesting expiring offline token`);
        if (typeof args[0] === "number") {
          return originalRedirect(args[0], newUrl);
        }
        return originalRedirect(newUrl);
      } catch (_e) {
        // Fall through to original redirect if URL parsing fails
      }
    }
    return originalRedirect.apply(res, args);
  };
  return shopify.auth.begin()(req, res, next);
});
app.get(
  shopify.config.auth.callbackPath,
  // Wrap shopify.auth.callback so that a 403 during the post-auth
  // webhook-subscription registration step does NOT abort OAuth.
  // Order of operations inside the library's callback:
  //   1. exchange code → access token
  //   2. store session in MongoDB             ← session is saved here
  //   3. register webhooks via GraphQL        ← step that 403s
  // If step 3 fails, step 2's session is still valid; the user just can't
  // automatically receive webhook deliveries (which we don't actually use
  // beyond compliance topics, and those are registered by Shopify itself
  // from shopify.app.toml). Catching the 401/403 (using the same helpers
  // billing.start uses, which cover GraphqlError.networkStatusCode and the
  // other error shapes shopify-api throws) lets OAuth complete and the
  // merchant land back in the app.
  async (req, res, next) => {
    const callbackHandler = shopify.auth.callback();
    try {
      await new Promise((resolve, reject) => {
        callbackHandler(req, res, (err) => (err ? reject(err) : resolve()));
      });
      next();
    } catch (err) {
      // [DEBUG] structured error dump — remove when verified
      console.error("[auth/callback] caught error:", {
        name: err?.name,
        message: err?.message,
        networkStatusCode: err?.networkStatusCode,
        statusCode: err?.statusCode,
        code: err?.code,
        responseCode: err?.response?.code,
      });
      if (isShopify401(err) || isShopify403(err)) {
        console.warn(
          `[auth/callback] Ignoring ${isShopify401(err) ? "401" : "403"} from post-auth webhook registration; offline session is already saved, continuing redirect.`
        );
        return next();
      }
      next(err);
    }
  },
  shopify.redirectToShopifyOrAppRoot()
);

/**
 * Token-exchange middleware for embedded apps.
 *
 * Instead of the legacy OAuth redirect flow (which produces non-expiring
 * tokens that Shopify no longer accepts), this middleware extracts the
 * session token provided by App Bridge in the Authorization header and
 * exchanges it for an expiring offline access token via the Token Exchange
 * API.
 */
async function performTokenExchange(shop, sessionToken) {
  console.log("[auth] Performing token exchange for", shop);
  const { session: newSession } = await shopify.api.auth.tokenExchange({
    shop,
    sessionToken,
    requestedTokenType: RequestedTokenType.OfflineAccessToken,
    expiring: true,
  });

  console.log("[auth] Token exchange success | shop:", newSession.shop,
    "| scope:", newSession.scope, "| expires:", newSession.expires,
    "| hasToken:", !!newSession.accessToken);

  await shopify.config.sessionStorage.storeSession(newSession);
  return newSession;
}

async function authenticateWithTokenExchange(req, res, next) {
  const bearerMatch = req.headers.authorization?.match(/Bearer (.*)/);
  if (!bearerMatch) {
    res.status(401).send({ error: "Missing session token" });
    return;
  }

  const sessionToken = bearerMatch[1];

  try {
    const payload = await shopify.api.session.decodeSessionToken(sessionToken);
    const shop = payload.dest.replace("https://", "");

    // Check if we already have a valid cached session
    const offlineSessionId = shopify.api.session.getOfflineId(shop);
    let session = await shopify.config.sessionStorage.loadSession(offlineSessionId);

    if (session && session.expires && session.isActive(shopify.api.config.scopes)) {
      console.log("[auth] Using cached session for", shop, "| expires:", session.expires);
      res.locals.shopify = { ...res.locals.shopify, session };

      // Store sessionToken so we can retry with fresh exchange on 401
      res.locals._sessionToken = sessionToken;
      res.locals._shop = shop;
      return next();
    }

    // No valid cached session — perform fresh token exchange
    session = await performTokenExchange(shop, sessionToken);
    res.locals.shopify = { ...res.locals.shopify, session };
    res.locals._sessionToken = sessionToken;
    res.locals._shop = shop;
    return next();
  } catch (error) {
    console.error("[auth] Token exchange FAILED:", error.message || error);
    res.status(401).send({ error: "Authentication failed" });
  }
}

/**
 * Re-authenticate by forcing a fresh token exchange.
 * Call this when a Shopify API call returns 401 with a stale cached session.
 */
async function refreshSession(res) {
  const sessionToken = res.locals._sessionToken;
  const shop = res.locals._shop;
  if (!sessionToken || !shop) return null;

  console.log("[auth] Refreshing stale session for", shop);
  const newSession = await performTokenExchange(shop, sessionToken);
  res.locals.shopify = { ...res.locals.shopify, session: newSession };
  return newSession;
}

console.log(`[startup] PREMIUM_PLAN_PRICE loaded = $${PREMIUM_PLAN_PRICE} USD / 30 days`);
console.log("[startup] cancel route: PUBLIC /api/cancelSubscription (id_token-in-query)");

/* -------------------------------------------------------------------------- */
/*               PUBLIC BILLING-START REDIRECT (no Bearer auth)               */
/* -------------------------------------------------------------------------- */

/**
 * Top-level redirect target for the "Upgrade to Premium" button.
 *
 * Why public: App Bridge v4's `shopify.idToken()` can hang in some
 * embedded-iframe states, which makes any token-authenticated fetch
 * unreliable for the billing flow. Doing the work server-side from a
 * top-level navigation bypasses idToken entirely. The browser navigates
 * to /api/billing/start?shop=X, the backend looks up the merchant's
 * stored offline session, creates the recurring charge, and 302-
 * redirects to Shopify's approval page where the merchant must still
 * personally approve — so the worst-case abuse from this being public
 * is a "do you want to subscribe?" prompt the merchant can dismiss.
 */
app.get("/api/billing/start", async (req, res) => {
  const shop = req.query.shop?.toString();
  const idToken = req.query.id_token?.toString();
  try {
    if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
      console.warn(`[billing/start] invalid shop param: ${shop}`);
      return res
        .status(400)
        .send("Invalid or missing shop parameter. Reload the app from Shopify admin.");
    }

    let session;

    // If the embedded app passed us a fresh session token (id_token from
    // Shopify's iframe URL), exchange it for a brand-new EXPIRING offline
    // access token. Shopify deprecated non-expiring offline tokens, so any
    // stale token in our DB will be rejected with 403. Token Exchange is
    // the documented way to get an expiring one.
    if (idToken) {
      try {
        console.log(`[billing/start] performing Token Exchange for ${shop}`);
        session = await performTokenExchange(shop, idToken);
        console.log(
          `[billing/start] Token Exchange success: expires=${session?.expires}, scope=${session?.scope}`
        );
      } catch (err) {
        console.warn(
          `[billing/start] Token Exchange failed (${err?.message}), falling back to stored session`
        );
      }
    }

    // Fall back to the stored session if Token Exchange wasn't possible.
    // (If this is a legacy non-expiring token, the REST call below will
    // 403 and we'll bounce through OAuth to refresh.)
    if (!session?.accessToken) {
      const offlineSessionId = shopify.api.session.getOfflineId(shop);
      session = await shopify.config.sessionStorage.loadSession(offlineSessionId);
    }

    if (!session?.accessToken) {
      console.log(`[billing/start] no session for ${shop}, sending to OAuth`);
      return res.redirect(`/api/auth?shop=${encodeURIComponent(shop)}`);
    }

    // Anti-duplicate guard: if the merchant is already on Premium (or any
    // legacy paid plan that normalizes to Premium), short-circuit instead
    // of creating a second pending charge.
    const billingCheck = await shopify.api.billing.check({
      session,
      plans: BILLING_CHECK_PLANS,
      isTest: IS_TEST,
      returnObject: true,
    });
    if (billingCheck?.hasActivePayment) {
      console.log(
        `[billing/start] ${shop} already has an active subscription, skipping create`
      );
      return res.redirect(`https://${shop}/admin/apps`);
    }

    // Create the recurring app subscription via the GraphQL Billing API
    // (appSubscriptionCreate mutation). shopify.api.billing.request reads
    // the plan's lineItems from billingConfig in web/shopify.js, which
    // pulls the amount from PREMIUM_PLAN_PRICE in web/.env.
    //
    // Critical: pass returnUrl pointing at /api/billing/return so the
    // post-approval redirect bounces the merchant back into admin's
    // embedded iframe (with a fresh id_token in the URL). The default
    // returnUrl drops them top-level on the app's domain with no
    // id_token, which leaves /api/billing/status unable to Token
    // Exchange and showing Free. We previously routed through /api/auth
    // for a full OAuth re-handshake, but OAuth's auto-webhook-
    // registration step kept 403'ing in this environment — bouncing
    // straight to admin avoids that whole code path.
    const billingReturnUrl = process.env.HOST
      ? `${process.env.HOST.replace(/\/$/, "")}/api/billing/return?shop=${encodeURIComponent(shop)}`
      : undefined;

    console.log(
      `[billing/start] requesting ${PREMIUM_PLAN} ($${PREMIUM_PLAN_PRICE}, isTest=${IS_TEST}) for ${shop} | returnUrl=${billingReturnUrl ?? "<library default>"}`
    );
    const confirmationUrl = await shopify.api.billing.request({
      session,
      plan: PREMIUM_PLAN,
      isTest: IS_TEST,
      ...(billingReturnUrl ? { returnUrl: billingReturnUrl } : {}),
    });
    console.log(`[billing/start] redirecting to ${confirmationUrl}`);

    res.redirect(confirmationUrl);
  } catch (err) {
    // [DEBUG] Structured one-line dump of every diagnostic field on the
    // thrown error — remove once 403 routing is verified in logs. Different
    // @shopify/shopify-api error classes (GraphqlError vs HttpResponseError
    // vs ShopifyError) expose the status code on different fields, so we
    // log them all to make the next failure obvious.
    console.error("[billing/start] caught error:", {
      name: err?.name,
      message: err?.message,
      networkStatusCode: err?.networkStatusCode,
      statusCode: err?.statusCode,
      code: err?.code,
      responseCode: err?.response?.code,
      errorData: err?.errorData,
    });

    // 401 → stale offline token. Bounce through OAuth so the auth.begin
    // wrapper (which adds grant_options[]=expiring) replaces the bad token
    // with an expiring one Shopify will accept.
    if (isShopify401(err) && shop) {
      console.log(
        `[billing/start] 401 from Shopify for ${shop}, redirecting to OAuth to refresh session`
      );
      return res.redirect(`/api/auth?shop=${encodeURIComponent(shop)}`);
    }

    // 403 → almost always means the stored token is non-expiring (Shopify
    // deprecated those) or otherwise rejected for the appSubscriptionCreate
    // mutation. Same recovery path as 401: re-OAuth to mint a fresh
    // expiring token, then merchant retries the upgrade click.
    if (isShopify403(err) && shop) {
      console.log(
        `[billing/start] 403 from Shopify for ${shop}, re-OAuthing for a fresh expiring token`
      );
      return res.redirect(`/api/auth?shop=${encodeURIComponent(shop)}`);
    }

    console.error("[billing/start] uncategorized error:", err?.message || err);
    if (err?.errorData) console.error("[billing/start] errorData:", err.errorData);
    res.status(500).send(
      `Failed to start billing: ${err?.message || "unknown error"}. Please reload from Shopify admin and try again.`
    );
  }
});

/* -------------------------------------------------------------------------- */
/*               PUBLIC BILLING-RETURN REDIRECT (no Bearer auth)              */
/* -------------------------------------------------------------------------- */

/**
 * Post-approval landing route used as the `returnUrl` of billing.request().
 *
 * After the merchant approves the charge on Shopify's hosted billing page,
 * Shopify redirects the browser here with `?shop=X&charge_id=Y`. We do
 * exactly one thing: 302 to the embedded admin URL for this app.
 *
 * Why this route exists:
 *   - We don't want to use Shopify's default returnUrl, because that drops
 *     the merchant top-level on the app's domain (NOT in admin's iframe),
 *     with no `id_token` in the URL — which leaves the Subscription page
 *     unable to Token Exchange and showing Free.
 *   - We tried routing through /api/auth (full OAuth re-handshake) so a
 *     fresh expiring offline token would be minted. But OAuth's automatic
 *     post-callback webhook-subscription registration step keeps 403'ing
 *     in this app's environment, surfacing the very error we're trying to
 *     avoid.
 *   - This route splits the difference: skip OAuth, just bounce the
 *     browser into admin. Admin embeds the app fresh; Shopify includes a
 *     fresh `id_token` in the iframe URL; the existing `/api/billing/status`
 *     handler picks that up, runs Token Exchange, gets a fresh expiring
 *     offline session, and `billing.check` correctly returns the active
 *     subscription created by the approval. No new auth code paths.
 */
app.get("/api/billing/return", (req, res) => {
  const shop = req.query.shop?.toString();
  const chargeId = req.query.charge_id?.toString();
  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    console.warn(`[billing/return] invalid shop param: ${shop}`);
    return res
      .status(400)
      .send("Invalid or missing shop parameter. Reload the app from Shopify admin.");
  }
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");
  const adminUrl = `https://admin.shopify.com/store/${shopHandle}/apps/${process.env.SHOPIFY_API_KEY}`;
  console.log(
    `[billing/return] post-approval redirect | shop=${shop} | charge_id=${chargeId ?? "<absent>"} | → ${adminUrl}`
  );
  res.redirect(adminUrl);
});

/* -------------------------------------------------------------------------- */
/*               PUBLIC BILLING-STATUS ENDPOINT (no Bearer auth)              */
/* -------------------------------------------------------------------------- */

/**
 * Returns the current shop's subscription status, bypassing App Bridge.
 *
 * The Pricing page and Dashboard need to know whether the merchant is on
 * Premium or Free. The previous `/api/hasActiveSubscription` route required
 * a Bearer token from `shopify.idToken()`, which can hang in the embedded
 * iframe — making the page silently fall back to "Free Plan" even after a
 * successful approval. This endpoint takes the shop from the URL instead
 * and looks up the offline session in MongoDB. Same data shape as before.
 */
app.get("/api/billing/status", async (req, res) => {
  const shop = req.query.shop?.toString();
  const idToken = req.query.id_token?.toString();
  try {
    if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
      return res
        .status(400)
        .send({ error: "Invalid or missing shop parameter" });
    }

    // [DEBUG] entry log — remove after verification
    console.log(
      `[billing/status] enter | shop=${shop} | idToken=${idToken ? "present" : "missing"}`
    );

    let session;

    // Match the /api/billing/start flow: if the embedded app passed us a
    // fresh session token (Shopify's iframe URL includes `id_token`), do a
    // Token Exchange to get a brand-new EXPIRING offline access token. This
    // is what fixes the post-approval state-sync bug — the cached token in
    // MongoDB can be stale (or non-expiring, which Shopify now rejects),
    // and `billing.check` against a stale token returns 401/403, causing
    // the catch below to fall through to the Free Plan fallback even
    // though Shopify has the merchant on Premium.
    if (idToken) {
      try {
        console.log(`[billing/status] performing Token Exchange for ${shop}`);
        session = await performTokenExchange(shop, idToken);
        console.log(
          `[billing/status] Token Exchange success | expires=${session?.expires} | scope=${session?.scope} | hasToken=${!!session?.accessToken}`
        );
      } catch (err) {
        console.warn(
          `[billing/status] Token Exchange failed (${err?.message}) — falling back to stored session`
        );
      }
    }

    // Fall back to the stored offline session if Token Exchange wasn't
    // possible (no id_token in URL, or exchange threw).
    if (!session?.accessToken) {
      const offlineSessionId = shopify.api.session.getOfflineId(shop);
      session = await shopify.config.sessionStorage.loadSession(offlineSessionId);
      console.log(
        `[billing/status] loaded stored session | id=${offlineSessionId} | hasToken=${!!session?.accessToken} | expires=${session?.expires ?? "non-expiring"}`
      );
    }

    if (!session?.accessToken) {
      console.log(`[billing/status] no session for ${shop} — returning Free`);
      return res.send({ hasActiveSubscription: false, activePlan: "Free Plan" });
    }

    // [DEBUG] log billing.check inputs — remove after verification
    console.log(
      `[billing/status] billing.check | shop=${shop} | plans=${JSON.stringify(BILLING_CHECK_PLANS)} | isTest=${IS_TEST}`
    );
    const billingData = await shopify.api.billing.check({
      session,
      plans: BILLING_CHECK_PLANS,
      isTest: IS_TEST,
      returnObject: true,
    });
    // [DEBUG] log billing.check result — remove after verification
    console.log(
      `[billing/status] billing.check result | hasActivePayment=${billingData?.hasActivePayment} | appSubscriptions=${JSON.stringify(
        (billingData?.appSubscriptions || []).map((sub) => ({
          name: sub?.name,
          status: sub?.status,
          test: sub?.test,
          id: sub?.id,
        }))
      )}`
    );

    if (!billingData?.hasActivePayment) {
      console.log(
        `[billing/status] no active payment for ${shop} — returning Free`
      );
      return res.send({ hasActiveSubscription: false, activePlan: "Free Plan" });
    }

    const activeSubscriptions = billingData.appSubscriptions || [];
    const currentPlan =
      normalizePlanName(activeSubscriptions[0]?.name) || "Free Plan";
    // [DEBUG] log final plan resolution — remove after verification
    console.log(
      `[billing/status] active plan resolved | raw=${activeSubscriptions[0]?.name} | normalized=${currentPlan}`
    );

    // Mirror the storefront-gating side-effect from the old auth-required
    // route: ensure the meroxio.shop_the_look_premium metafield exists so
    // theme blocks unlock immediately after a fresh approval.
    try {
      const installation = await MetafieldService.getInstallation(session);
      if (installation && !installation.metafield) {
        await MetafieldService.createMetafield(session, installation.id);
        console.log(
          `[billing/status] created premium metafield for ${shop}`
        );
      }
    } catch (metaErr) {
      console.warn(
        `[billing/status] metafield sync failed (non-fatal):`,
        metaErr?.message || metaErr
      );
    }

    res.send({ hasActiveSubscription: true, activePlan: currentPlan });
  } catch (err) {
    // [DEBUG] structured error dump — remove when verified
    console.error("[billing/status] caught error:", {
      name: err?.name,
      message: err?.message,
      networkStatusCode: err?.networkStatusCode,
      statusCode: err?.statusCode,
      code: err?.code,
      responseCode: err?.response?.code,
    });

    // 401/403 = stale offline token. Both surface to the frontend the same
    // way: as a Free fallback with reauthRequired:true so the Pricing page
    // can decide whether to bounce the merchant through OAuth.
    if (isShopify401(err) || isShopify403(err)) {
      console.warn(
        `[billing/status] 401/403 for ${shop} — stale session, returning Free + reauthRequired:true`
      );
      return res.send({
        hasActiveSubscription: false,
        activePlan: "Free Plan",
        reauthRequired: true,
      });
    }
    console.error("[billing/status] error:", err?.message || err);
    if (err?.errorData) console.error("[billing/status] errorData:", err.errorData);
    res.status(500).send({ error: err?.message || "Failed to fetch status" });
  }
});

/* -------------------------------------------------------------------------- */
/*           PUBLIC CANCEL-SUBSCRIPTION ROUTE (no Bearer auth)                */
/* -------------------------------------------------------------------------- */

/**
 * Cancels the merchant's active app subscription.
 *
 * Mounted BEFORE `app.use("/api", authenticateWithTokenExchange)` so the
 * frontend can call it without a Bearer token. App Bridge v4's
 * `shopify.idToken()` has been observably flaky in this app's embedded
 * iframe — relying on it for cancellation would let `await shopify.idToken()`
 * hang indefinitely, before any AbortController could fire. This mirrors
 * the public-with-id_token-in-query pattern already used by
 * `/api/billing/start` and `/api/billing/status`.
 *
 * Auth: prefer Token Exchange against the request's `id_token`, falling
 * back to the stored offline session in MongoDB if exchange isn't possible
 * (no token, or exchange threw). The cancellation mutation runs against
 * whichever session we end up with.
 *
 * Idempotency: if the merchant has no active subscription (already
 * cancelled, never subscribed, etc.) the helper returns NO_SUBSCRIPTION,
 * which we surface to the frontend as the "No subscription found" status.
 */
app.get("/api/cancelSubscription", async (req, res) => {
  // First-line entry log so backend console immediately shows the request
  // hit this handler — proves the route is reachable through Vite proxy +
  // tunnel, and rules out auth-middleware short-circuit. If you click
  // cancel and DON'T see this line, the request didn't reach the backend
  // (tunnel issue / stale dev server).
  console.log(`[cancel] HIT /api/cancelSubscription | query=${JSON.stringify(req.query)}`);
  const shop = req.query.shop?.toString();
  const idToken = req.query.id_token?.toString();
  try {
    if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
      console.warn(`[cancel] invalid shop param: ${shop}`);
      return res.status(400).send({ error: "Invalid or missing shop parameter" });
    }

    console.log(
      `[cancel] enter | shop=${shop} | idToken=${idToken ? "present" : "missing"}`
    );

    let session;
    if (idToken) {
      try {
        session = await performTokenExchange(shop, idToken);
        console.log(
          `[cancel] Token Exchange success | scope=${session?.scope} | hasToken=${!!session?.accessToken}`
        );
      } catch (err) {
        console.warn(
          `[cancel] Token Exchange failed (${err?.message}) — falling back to stored session`
        );
      }
    }

    if (!session?.accessToken) {
      const offlineSessionId = shopify.api.session.getOfflineId(shop);
      session = await shopify.config.sessionStorage.loadSession(offlineSessionId);
      console.log(
        `[cancel] loaded stored session | hasToken=${!!session?.accessToken}`
      );
    }

    if (!session?.accessToken) {
      console.log(`[cancel] no session for ${shop} — cannot cancel`);
      return res
        .status(401)
        .send({ error: "No active session for shop", reauthRequired: true });
    }

    const result = await BillingService.cancel(session);
    const status = result?.status;
    const subscriptionId = result?.subscriptionId ?? null;
    console.log(
      `[cancel] mutation result | shop=${shop} | status=${status} | subscriptionId=${subscriptionId}`
    );

    if (status === "NO_SUBSCRIPTION") {
      return res.send({
        status: "No subscription found",
        subscriptionId: null,
      });
    }

    // Storefront-gating side effect: drop the meroxio.shop_the_look_premium
    // metafield so theme blocks immediately stop showing premium content.
    // Best-effort — if this fails, the cancellation itself is already done
    // and the metafield will get reconciled on the next status check.
    try {
      const installation = await MetafieldService.getInstallation(session);
      if (installation?.metafield) {
        await MetafieldService.deleteMetafield(session, installation);
        console.log(`[cancel] metafield deleted for ${shop}`);
      }
    } catch (metaErr) {
      console.warn(
        `[cancel] metafield delete failed (non-fatal):`,
        metaErr?.message || metaErr
      );
    }

    res.send({
      status: status === "CANCELLED" ? "CANCELLED_SUCCESSFULLY" : status,
      subscriptionId,
    });
  } catch (err) {
    console.error("[cancel] caught error:", {
      name: err?.name,
      message: err?.message,
      networkStatusCode: err?.networkStatusCode,
      statusCode: err?.statusCode,
    });
    if (isShopify401(err) || isShopify403(err)) {
      return res
        .status(401)
        .send({ error: err?.message || "Reauth required", reauthRequired: true });
    }
    res
      .status(500)
      .send({ error: err?.message || "Failed to cancel subscription" });
  }
});

app.use("/api", authenticateWithTokenExchange);

/* -------------------------------------------------------------------------- */
/*                              HELPER UTILITIES                              */
/* -------------------------------------------------------------------------- */

/**
 * @param {import("express").Response} res
 */
const getSession = (res) => {
  return res.locals.shopify.session;
};

/**
 * @param {import("@shopify/shopify-api").Session} session
 */
const getGraphQLClient = (session) =>
  new shopify.api.clients.Graphql({ session });

/**
 * @param {import("express").Response} res
 * @param {string} message
 */
const handleError = (res, message) => {
  console.error(message);
  res.status(500).send({ error: message });
};

/**
 * Checks if an error is a 401 Unauthorized from Shopify's API. The exact
 * error shape varies between REST and GraphQL paths in @shopify/shopify-api:
 *   - REST/HTTP errors: `error.code` or `error.statusCode`
 *   - GraphqlError: `error.networkStatusCode`
 *   - Legacy: `error.response.code`
 *   - All paths: prose message starting with "Received an error response (401…"
 */
const isShopify401 = (error) =>
  error &&
  (error.networkStatusCode === 401 ||
    error.statusCode === 401 ||
    error.code === 401 ||
    error.response?.code === 401 ||
    error.message?.includes("401") ||
    error.message?.includes("Unauthorized"));

/**
 * Checks if an error is a 403 Forbidden from Shopify's API. Same fields as
 * isShopify401 — `GraphqlError` exposes `networkStatusCode`, not
 * `response.code`, which is why the previous catch block was missing
 * GraphQL 403s and falling through to the generic 500 handler.
 */
const isShopify403 = (error) =>
  error &&
  (error.networkStatusCode === 403 ||
    error.statusCode === 403 ||
    error.code === 403 ||
    error.response?.code === 403 ||
    /\b403\b|forbidden/i.test(error.message || ""));

/**
 * Wraps a route handler to automatically retry once with a fresh session
 * if a Shopify API call returns 401 (stale cached token).
 */
function withSessionRetry(handler) {
  return async (req, res) => {
    try {
      await handler(req, res, getSession(res));
    } catch (error) {
      if (isShopify401(error)) {
        console.log("[retry] Got 401 from Shopify, refreshing session...");
        try {
          const freshSession = await refreshSession(res);
          if (freshSession) {
            await handler(req, res, freshSession);
            return;
          }
        } catch (retryError) {
          console.error("[retry] Retry also failed:", retryError.message || retryError);
        }
      }
      throw error;
    }
  };
}

/* -------------------------------------------------------------------------- */
/*                              BILLING SERVICE                               */
/* -------------------------------------------------------------------------- */

const BillingService = {
  /**
   * @param {import("@shopify/shopify-api").Session} session
   */
  async check(session) {
    return await shopify.api.billing.check({
      session,
      plans: BILLING_CHECK_PLANS,
      isTest: IS_TEST,
      returnObject: true,
    });
  },

  /**
   * @param {import("@shopify/shopify-api").Session} session
   * @param {string} plan
   */
  async request(session, plan = PREMIUM_PLAN) {
    return await shopify.api.billing.request({
      session,
      plan: plan,
      isTest: IS_TEST,
    });
  },

  /**
   * @param {import("@shopify/shopify-api").Session} session
   */
  async cancel(session) {
    return await cancelSubscription(session);
  },
};

/* -------------------------------------------------------------------------- */
/*                            METAFIELD SERVICE                               */
/* -------------------------------------------------------------------------- */

const MetafieldService = {
  /**
   * @param {import("@shopify/shopify-api").Session} session
   */
  async getInstallation(session) {
    const client = getGraphQLClient(session);

    const body = await client.request(CURRENT_APP_INSTALLATION, {
      variables: {
        namespace: MEROXIO,
        key: PREMIUM_PLAN_KEY,
      },
    });

    return body?.data?.currentAppInstallation;
  },

  /**
   * @param {import("@shopify/shopify-api").Session} session
   * @param {string} ownerId
   */
  async createMetafield(session, ownerId) {
    const client = getGraphQLClient(session);

    await client.request(CREATE_APP_DATA_METAFIELD, {
      variables: {
        metafieldsSetInput: [
          {
            ownerId: ownerId,
            namespace: MEROXIO,
            key: PREMIUM_PLAN_KEY,
            value: "true",
            type: "boolean",
          },
        ],
      },
    });
  },

  /**
   * @param {import("@shopify/shopify-api").Session} session
   * @param {{id?: string} | null | undefined} installation
   */
  async deleteMetafield(session, installation) {
    const client = getGraphQLClient(session);
    const ownerId = installation?.id;

    if (!ownerId) {
      throw new Error("Missing installation ID for metafield deletion");
    }

    const body = await client.request(DELETE_APP_DATA_METAFIELD, {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: MEROXIO,
            key: PREMIUM_PLAN_KEY,
          },
        ],
      },
    });

    if (body.errors) {
      console.error("GraphQL deleteMetafield errors:", body.errors);

      const graphQLErrorMessages = (body.errors.graphQLErrors || [])
        .map(
          /** @param {{ message?: string }} graphQLError */
          (graphQLError) => graphQLError?.message || ""
        )
        .filter(Boolean);

      throw new Error(
        graphQLErrorMessages.length
          ? graphQLErrorMessages.join("; ")
          : body.errors.message || "GraphQL deleteMetafield failed"
      );
    }

    const deleteResult = body.data?.metafieldsDelete;
    if (Array.isArray(deleteResult?.userErrors) && deleteResult.userErrors.length) {
      console.error("metafieldsDelete user errors:", deleteResult.userErrors);

      const userErrorMessages = deleteResult.userErrors
        .map(
          /** @param {{ message?: string }} userError */
          (userError) => userError?.message || ""
        )
        .filter(Boolean);

      throw new Error(
        userErrorMessages.join("; ") || "metafieldsDelete returned user errors"
      );
    }

    return true;
  },
};

// Note: /api/cancelSubscription is now defined ABOVE the auth middleware
// (search for "PUBLIC CANCEL-SUBSCRIPTION ROUTE"), using the same public-
// with-id_token-in-query pattern as /api/billing/start and /api/billing/
// status. That bypasses the App Bridge `shopify.idToken()` hang risk that
// would otherwise leave the cancel modal spinning forever in flaky-tunnel
// conditions.

/* -------------------------------------------------------------------------- */
/*                               GET SHOP API                                 */
/* -------------------------------------------------------------------------- */

app.get("/api/getshop", async (req, res) => {
  try {
    const session = getSession(res);

    res.send({
      shop: session?.shop,
    });
  } catch (error) {
    handleError(res, "Failed to get shop");
  }
});

/* -------------------------------------------------------------------------- */
/*                              FRONTEND SERVE                                */
/* -------------------------------------------------------------------------- */

app.use(shopify.cspHeaders());

if (IS_PRODUCTION) {
  if (!existsSync(join(STATIC_PATH, "index.html"))) {
    throw new Error(`Missing production frontend build at ${STATIC_PATH}`);
  }

  app.use(serveStatic(STATIC_PATH, { index: false }));

  app.use("/", async (_req, res) => {
    const html = readFileSync(join(STATIC_PATH, "index.html"), "utf8").replace(
      "%SHOPIFY_API_KEY%",
      process.env.SHOPIFY_API_KEY || ""
    );
    res.status(200).set("Content-Type", "text/html").send(html);
  });
} else {
  const viteProxy = createProxyMiddleware({
    target: FRONTEND_URL,
    changeOrigin: false,
    ws: true,
  });

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api") || req.path === shopify.config.auth.path || req.path === shopify.config.auth.callbackPath) {
      return next();
    }
    if (VITE_DEV_PATH_REGEX.test(req.path)) {
      return viteProxy(req, res, next);
    }
    next();
  });

  app.get("/", shopify.ensureInstalledOnShop(), async (_req, res) => {
    const html = readFileSync(join(process.cwd(), "frontend", "index.html"), "utf8").replace(
      "%SHOPIFY_API_KEY%",
      process.env.SHOPIFY_API_KEY || ""
    );
    res.status(200).set("Content-Type", "text/html").send(html);
  });

  app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res) => {
    const html = readFileSync(join(process.cwd(), "frontend", "index.html"), "utf8").replace(
      "%SHOPIFY_API_KEY%",
      process.env.SHOPIFY_API_KEY || ""
    );
    res.status(200).set("Content-Type", "text/html").send(html);
  });
}

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);

/* -------------------------------------------------------------------------- */
/*                                GRAPHQL                                     */
/* -------------------------------------------------------------------------- */

const CURRENT_APP_INSTALLATION = `
query appSubscription($namespace: String!, $key: String!) {
  currentAppInstallation {
    id
    metafield(namespace: $namespace, key: $key) {
      namespace
      key
      value
      id
    }
  }
}
`;

const CREATE_APP_DATA_METAFIELD = `
mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafieldsSetInput) {
    metafields {
      id
      namespace
      key
    }
    userErrors {
      field
      message
    }
  }
}
`;

const DELETE_APP_DATA_METAFIELD = `
mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    userErrors {
      field
      message
    }
  }
}
`;
