import {
  Page,
  LegacyCard,
  Layout,
  Icon,
  Button,
  Text,
  Box,
  Badge,
  Banner,
} from "@shopify/polaris";
import { CircleTickMinor, CircleCancelMinor } from "@shopify/polaris-icons";
import { useEffect, useState } from "react";
import { useSubscriptionStatus, PREMIUM_PLAN } from "../hooks";
import "./Pricing.css";

// Single source of truth: PREMIUM_PLAN_PRICE in web/.env. Vite injects it
// into the bundle via the `define` block in vite.config.js, sourced from the
// same env var the backend uses for billing.request().
const PREMIUM_PRICE = (() => {
  const raw = Number(process.env.PREMIUM_PLAN_PRICE);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
})();

// resolveShop is also needed by subscribePlan (the Upgrade button) so it
// can build /api/billing/start?shop=… — kept inline here. The hook's
// internal copy is for the status fetch only.
function resolveShop() {
  try {
    if (typeof shopify !== "undefined" && shopify?.config?.shop) {
      return shopify.config.shop;
    }
  } catch (_) {}
  return new URLSearchParams(window.location.search).get("shop");
}

// resolveIdToken used by subscribePlan when forwarding id_token to
// /api/billing/start (so the backend can Token Exchange before billing).
const INITIAL_ID_TOKEN = (() => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("id_token");
})();
function resolveIdToken() {
  const fromUrl = new URLSearchParams(window.location.search).get("id_token");
  return fromUrl || INITIAL_ID_TOKEN;
}

// Cross-origin top-level navigation from an embedded Shopify iframe.
// Synthesizing a click on a `target="_top"` anchor is the most reliable
// pattern for App Bridge v4 (CDN): direct `window.top.location.href`
// assignments and post-await `window.open` calls can be silently blocked
// by iframe sandbox / popup-blocker rules, while a real anchor click
// is treated as a user-initiated top navigation and respected.
function redirectTopLevel(url) {
  console.log("[upgrade] redirecting top-level to:", url);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_top";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

const PLAN_FEATURES = [
  { label: "Shoppable looks", free: "Limited", premium: "Unlimited" },
  { label: "Hotspots per image", free: "Up to 2", premium: "Unlimited" },
  { label: "Custom styling controls", free: false, premium: true },
  { label: "Mobile drawer & gallery", free: true, premium: true },
  { label: "Priority email support", free: false, premium: true },
  { label: "ShopSpot watermark removed", free: false, premium: true },
];

function FeatureCell({ value }) {
  if (value === true)
    return (
      <span className="ls-pricing-cell ls-pricing-cell--yes">
        <Icon source={CircleTickMinor} color="success" />
      </span>
    );
  if (value === false)
    return (
      <span className="ls-pricing-cell ls-pricing-cell--no">
        <Icon source={CircleCancelMinor} color="subdued" />
      </span>
    );
  return <span className="ls-pricing-cell">{value}</span>;
}

export default function Pricing() {
  const [loadingPlan, setLoadingPlan] = useState(null);

  // Single normalized subscription state. Identical for both the Home
  // page and this Subscription page — no chance of UI drift.
  const {
    isLoaded,
    hasActiveSubscription,
    isPremiumActive,
    isFreeActive,
    fetchFailed,
    refetch: refetchSubscription,
  } = useSubscriptionStatus();

  // Force a fresh /api/billing/status fetch every time the merchant
  // navigates to this page. The Provider's initial fetch may have been
  // run while the dev tunnel was wedged or before the merchant clicked
  // through Shopify's billing approval; refetching on Subscription
  // mount ensures the page reflects current truth, not stale state.
  useEffect(() => {
    refetchSubscription();
  }, [refetchSubscription]);

  // [DEBUG] log whenever state propagates so we can confirm in the
  // browser console that the hook's flip actually reaches this page.
  // Remove once the bug is verified resolved.
  useEffect(() => {
    console.log("[pricing] state propagated:", {
      isLoaded,
      hasActiveSubscription,
      isPremiumActive,
      isFreeActive,
      fetchFailed,
    });
  }, [isLoaded, hasActiveSubscription, isPremiumActive, isFreeActive, fetchFailed]);

  // Upgrade flow: synchronous top-level redirect to a public backend
  // endpoint that uses the merchant's stored offline session to create
  // the recurring charge and 302-redirects to Shopify's approval page.
  // No App Bridge idToken / Bearer auth involved — bulletproof against
  // App Bridge stalling. The shop is read from App Bridge config (set
  // during initial admin embedding) with a fallback to the URL params
  // for the case where App Bridge hasn't initialized yet.
  const subscribePlan = (planHandle) => {
    console.log("[upgrade] click → plan:", planHandle);
    setLoadingPlan(planHandle);

    const shop = resolveShop();
    console.log("[upgrade] resolved shop:", shop);

    if (!shop) {
      setLoadingPlan(null);
      const msg =
        "Could not determine your shop. Reload the app from Shopify admin and try again.";
      console.error("[upgrade] missing shop param");
      if (typeof shopify !== "undefined" && shopify?.toast) {
        shopify.toast.show(msg, { isError: true });
      } else {
        alert(msg);
      }
      return;
    }

    // Pass Shopify's session token (`id_token`) through to the backend so
    // it can do Token Exchange and obtain an EXPIRING offline access token
    // (Shopify deprecated non-expiring ones). Shopify auto-includes
    // `id_token` as a query param when it embeds the app — we capture it
    // at module load and prefer the current URL's value for freshness.
    const idToken = resolveIdToken();
    const params = new URLSearchParams({ shop });
    if (idToken) params.set("id_token", idToken);
    const url = `/api/billing/start?${params.toString()}`;
    console.log(
      `[upgrade] redirecting top-level to: ${url} (id_token=${idToken ? "present" : "missing"})`
    );
    redirectTopLevel(url);
    // The page navigates away from here. setLoadingPlan(null) is not
    // needed — the React tree unmounts. If the navigation is somehow
    // blocked, the spinner stays until the user reloads.
  };

  // Note: in-app cancellation has been removed for v1. Merchants who want
  // to downgrade go through Shopify admin → Settings → Billing, which is
  // the standard Shopify-supported path. The /api/cancelSubscription
  // backend route is left in place for potential future reuse.

  return (
    <div className="ls-pricing">
      <Page title="Plans & billing">
        <Layout>
          {/* If the fetch settled but came back with no usable payload
              (timeout / network error / non-OK), surface that honestly
              instead of silently rendering Free Active. The merchant can
              click the action to retry. */}
          {isLoaded && fetchFailed && (
            <Layout.Section>
              <div className="ls-pricing-status">
                <Banner
                  status="warning"
                  title="Couldn't verify subscription status"
                  action={{
                    content: "Retry",
                    onAction: () => refetchSubscription(),
                  }}
                >
                  <p>
                    We couldn't reach the billing API. If you've already
                    subscribed and this still says Free, click Retry, or
                    reload the app from Shopify admin.
                  </p>
                </Banner>
              </div>
            </Layout.Section>
          )}

          {isLoaded && hasActiveSubscription && (
            <Layout.Section>
              <div className="ls-pricing-status">
                <Banner status="success" title="Premium plan active">
                  <p>
                    You're on the Premium plan. All ShopSpot features are
                    unlocked across your storefront.
                  </p>
                </Banner>
              </div>
            </Layout.Section>
          )}

          <Layout.Section>
            <Layout>
              <Layout.Section oneHalf>
                <div className="ls-plan ls-plan--premium">
                  <LegacyCard sectioned>
                    <div className="ls-plan-head">
                      <Text variant="headingMd" as="h2">
                        Premium
                      </Text>
                      {isPremiumActive && <Badge status="success">Active</Badge>}
                    </div>
                    <Box paddingBlockStart="200" paddingBlockEnd="200">
                      <Text variant="heading2xl" as="p">
                        ${PREMIUM_PRICE ?? "…"}
                        <span className="ls-plan-cadence"> / month</span>
                      </Text>
                    </Box>
                    <Text variant="bodyMd" color="subdued" as="p">
                      Unlimited looks, unlimited hotspots, full styling
                      controls, priority support.
                    </Text>
                    <Box paddingBlockStart="400">
                      <Button
                        primary
                        fullWidth
                        loading={loadingPlan === PREMIUM_PLAN}
                        disabled={isPremiumActive || PREMIUM_PRICE == null}
                        onClick={() => subscribePlan(PREMIUM_PLAN)}
                      >
                        {isPremiumActive ? "Current plan" : "Upgrade to Premium"}
                      </Button>
                    </Box>
                  </LegacyCard>
                </div>
              </Layout.Section>

              <Layout.Section oneHalf>
                <div className="ls-plan ls-plan--free">
                  <LegacyCard sectioned>
                    <div className="ls-plan-head">
                      <Text variant="headingMd" as="h2">
                        Free
                      </Text>
                      {isFreeActive && !fetchFailed && (
                        <Badge status="success">Active</Badge>
                      )}
                    </div>
                    <Box paddingBlockStart="200" paddingBlockEnd="200">
                      <Text variant="heading2xl" as="p">
                        $0
                        <span className="ls-plan-cadence"> / forever</span>
                      </Text>
                    </Box>
                    <Text variant="bodyMd" color="subdued" as="p">
                      Get a feel for ShopSpot. Limited looks per store and a
                      cap of 2 hotspots per image.
                    </Text>
                    {isFreeActive && !fetchFailed && (
                      <Box paddingBlockStart="400">
                        <Button fullWidth disabled>
                          Current plan
                        </Button>
                      </Box>
                    )}
                  </LegacyCard>
                </div>
              </Layout.Section>
            </Layout>
          </Layout.Section>

          <Layout.Section>
            <div className="ls-pricing-compare">
              <LegacyCard title="What's included" sectioned>
                <ul className="ls-pricing-list">
                  <li className="ls-pricing-list-head">
                    <span>Feature</span>
                    <span>Free</span>
                    <span>Premium</span>
                  </li>
                  {PLAN_FEATURES.map((row) => (
                    <li key={row.label} className="ls-pricing-list-row">
                      <span className="ls-pricing-feature">{row.label}</span>
                      <FeatureCell value={row.free} />
                      <FeatureCell value={row.premium} />
                    </li>
                  ))}
                </ul>
              </LegacyCard>
            </div>
          </Layout.Section>

        </Layout>
      </Page>
    </div>
  );
}
