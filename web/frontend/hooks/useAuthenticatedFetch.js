/**
 * A hook that returns an auth-aware fetch function.
 * @desc Uses App Bridge v4's shopify.idToken() to get a session token
 * and attaches it as a Bearer token in the Authorization header.
 *
 * @returns {Function} fetch function
 */
export function useAuthenticatedFetch() {
  return async (uri, options = {}) => {
    const token = await shopify.idToken();

    const response = await fetch(uri, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    checkHeadersForReauthorization(response.headers);
    return response;
  };
}

function checkHeadersForReauthorization(headers) {
  if (headers.get("X-Shopify-API-Request-Failure-Reauthorize") === "1") {
    const authUrlHeader =
      headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url") ||
      `/api/auth`;

    const url = authUrlHeader.startsWith("/")
      ? `https://${window.location.host}${authUrlHeader}`
      : authUrlHeader;

    window.open(url, "_top");
  }
}
