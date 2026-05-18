/**
 * App Bridge v4 initializes automatically via the CDN script and the
 * <meta name="shopify-api-key"> tag in index.html — no React Provider needed.
 *
 * This component is kept as a thin passthrough so existing imports
 * (e.g. in App.jsx) continue to work without changes elsewhere.
 */
export function AppBridgeProvider({ children }) {
  return <>{children}</>;
}
