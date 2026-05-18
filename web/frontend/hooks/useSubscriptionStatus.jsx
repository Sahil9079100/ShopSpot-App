import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// Bundle version marker. Bumped whenever this file's structure changes,
// so you can spot in the browser console whether the bundle running is
// actually the latest. If you don't see "[subscription-status] HOOK
// VERSION: v4..." in the console after reloading, your browser has a
// cached old bundle — hard refresh (Ctrl+Shift+R).
const HOOK_VERSION = "v5-localstorage-cache-2026-05-08";
if (typeof window !== "undefined") {
  console.log(`[subscription-status] HOOK VERSION: ${HOOK_VERSION}`);
}

// Plan-handle constant used by callers that need to construct billing
// requests against the backend (e.g. /api/billing/start?plan=…). The
// context's *output* `activePlan` field is a normalized enum
// ("PREMIUM" / "FREE") — separate concept from this handle.
export const PREMIUM_PLAN = "shop_the_look_premium";

// Resolve the current shop without depending on App Bridge's idToken
// (which can hang). Try the App Bridge `shopify.config.shop` first,
// fall back to the URL params.
function resolveShop() {
  if (typeof window === "undefined") return null;
  try {
    if (typeof shopify !== "undefined" && shopify?.config?.shop) {
      return shopify.config.shop;
    }
  } catch (_) {}
  return new URLSearchParams(window.location.search).get("shop");
}

// Capture Shopify's session token (`id_token`) once at module-load time.
// Shopify includes it in the iframe URL on initial embed, but client-
// side React Router navigation strips query params from the URL.
const INITIAL_ID_TOKEN = (() => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("id_token");
})();

function resolveIdToken() {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("id_token");
  return fromUrl || INITIAL_ID_TOKEN;
}

// Per-shop localStorage cache. The dev tunnel can drop responses, leaving
// data=null even after a successful backend processing. By persisting the
// last good payload across mounts, the UI reflects the merchant's true plan
// instantly on remount; the next reachable fetch reconciles authoritatively.
function cacheKey(shop) {
  return `lookspot:subscription-status:${shop}`;
}

function loadCachedData(shop) {
  if (typeof window === "undefined" || !shop) return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(shop));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "hasActiveSubscription" in parsed) {
      return parsed;
    }
    return null;
  } catch (_) {
    return null;
  }
}

function saveCachedData(shop, payload) {
  if (typeof window === "undefined" || !shop) return;
  try {
    window.localStorage.setItem(cacheKey(shop), JSON.stringify(payload));
  } catch (_) {}
}

export function clearCachedSubscriptionData(shop) {
  if (typeof window === "undefined" || !shop) return;
  try {
    window.localStorage.removeItem(cacheKey(shop));
  } catch (_) {}
}

const SubscriptionContext = createContext(null);

/**
 * Single fetch + state mounted ONCE at the app level. Both the Home
 * page and the Subscription page read the resulting state via
 * useSubscriptionStatus(); they share the exact same object, so they
 * literally cannot disagree about whether the merchant is on Premium.
 *
 * Lifecycle:
 *   - Provider mounts → starts fetch
 *   - Fetch settles (success / error / 10s abort) → isLoaded = true
 *   - refetch() bumps an internal counter that re-runs the effect
 *
 * Output invariants:
 *   - activePlan is always either "PREMIUM" or "FREE"
 *   - isPremiumActive === (activePlan === "PREMIUM")
 *   - isFreeActive === (activePlan === "FREE")
 *   - hasActiveSubscription is gated on isLoaded so the success
 *     banner / cancel block don't flash on during the loading window
 */
export function SubscriptionProvider({ children }) {
  // Hydrate from localStorage synchronously so the first paint reflects the
  // merchant's last-known plan rather than flashing Free/loading. The
  // background fetch still runs and reconciles. If the cache is empty or
  // corrupt, this falls back to null and behavior is unchanged.
  const [data, setData] = useState(() => loadCachedData(resolveShop()));
  const [isLoaded, setIsLoaded] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const shop = resolveShop();
    if (!shop) {
      console.warn("[subscription-status] no shop param, cannot fetch");
      setIsLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    const idToken = resolveIdToken();
    const params = new URLSearchParams({ shop });
    if (idToken) params.set("id_token", idToken);
    const url = `/api/billing/status?${params.toString()}`;

    console.log(
      `[subscription-status] effect fired | url=${url} | id_token=${idToken ? "present" : "missing"} | trigger=${refetchTrigger}`
    );

    // 30s safety timeout. Belt-and-suspenders: also call setIsLoaded(true)
    // *inside* the timeout handler so the page exits the loading state even
    // if AbortController.abort() doesn't cleanly propagate through the dev
    // tunnel (we've observed the tunnel can swallow aborts and leave the
    // promise pending indefinitely). The fetch's own finally branch ALSO
    // calls setIsLoaded(true) — both calls are idempotent.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(
        "[subscription-status] 30s timeout — aborting fetch and forcing isLoaded=true"
      );
      controller.abort();
      if (!cancelled) setIsLoaded(true);
    }, 30000);

    (async () => {
      try {
        const res = await window.fetch(url, { signal: controller.signal });
        console.log(
          `[subscription-status] response status=${res.status} ok=${res.ok}`
        );
        if (res.ok) {
          const payload = await res.json();
          console.log("[subscription-status] payload:", payload);
          if (!cancelled) {
            setData(payload);
            saveCachedData(shop, payload);
          }
        }
      } catch (err) {
        if (err?.name === "AbortError") {
          console.error("[subscription-status] fetch aborted (timeout)");
        } else {
          console.error("[subscription-status] fetch failed:", err);
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) {
          console.log("[subscription-status] flipping isLoaded → true");
          setIsLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [refetchTrigger]);

  const refetch = useCallback(() => {
    console.log("[subscription-status] refetch requested");
    setIsLoaded(false);
    setRefetchTrigger((t) => t + 1);
  }, []);

  // Optimistic update for after a confirmed cancel. The /api/billing/status
  // fetch can be slow or hang through a flaky tunnel, so once we KNOW the
  // backend has accepted the cancellation we flip in-memory state and the
  // localStorage cache to Free immediately. The next reachable status fetch
  // reconciles authoritatively — if Shopify still reports the subscription
  // as active (e.g. cancel-at-end-of-cycle behavior), the truth wins.
  const markAsFree = useCallback(() => {
    console.log("[subscription-status] markAsFree (optimistic)");
    const freePayload = {
      hasActiveSubscription: false,
      activePlan: "Free Plan",
    };
    setData(freePayload);
    setIsLoaded(true);
    const shop = resolveShop();
    if (shop) saveCachedData(shop, freePayload);
  }, []);

  // Derive the public shape ONCE here. Both consumers see the same
  // object reference — by construction they cannot disagree.
  const apiPlanHandle = data?.activePlan;
  const apiHasActive = !!data?.hasActiveSubscription;
  const isPremium = apiHasActive && apiPlanHandle === PREMIUM_PLAN;

  // True when the fetch finished but came back with no usable payload
  // (timeout / network error / non-OK response). Lets the Subscription
  // page surface a "couldn't verify status" warning instead of silently
  // presenting the Free fallback as if it were a confident plan state.
  const fetchFailed = isLoaded && data === null;

  const value = {
    isLoaded,
    activePlan: isPremium ? "PREMIUM" : "FREE",
    isPremiumActive: isPremium,
    isFreeActive: !isPremium,
    // Banner / cancel-block guard — gated on isLoaded so they don't
    // flash on during the brief loading window.
    hasActiveSubscription: isLoaded && isPremium,
    reauthRequired: !!data?.reauthRequired,
    fetchFailed,
    refetch,
    markAsFree,
  };

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

/**
 * Read the shared subscription state. Must be called inside a
 * <SubscriptionProvider> mounted somewhere up the tree (App.jsx).
 */
export function useSubscriptionStatus() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    // Provider missing OR Vite HMR served a different SubscriptionContext
    // module instance than the one the Provider was created from. Return
    // a NEUTRAL fallback (no badge claims active) so the bug is visually
    // obvious — *not* a Free-Active fallback that masquerades as a real
    // state. Also log loudly so the cause is clear in the console.
    console.error(
      "[subscription-status] useSubscriptionStatus is rendering OUTSIDE SubscriptionProvider. " +
        "This is almost always a Vite HMR module-identity glitch from a recent file rename or " +
        "syntax error recovery. HARD REFRESH (Ctrl+Shift+R) the app to clear it."
    );
    return {
      isLoaded: false,
      activePlan: null,
      isPremiumActive: false,
      isFreeActive: false,
      hasActiveSubscription: false,
      reauthRequired: false,
      fetchFailed: false,
      refetch: () => Promise.resolve(),
      markAsFree: () => {},
    };
  }
  return ctx;
}
