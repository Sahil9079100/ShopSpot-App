import shopify from "./shopify.js";

/**
 * Cancels the merchant's currently-active Shopify app subscription.
 *
 * Cancellation timing: we do NOT pass `prorate: true`, so Shopify cancels at
 * the end of the current billing cycle. The mutation still returns
 * status=CANCELLED immediately, and `billing.check` will eventually report no
 * active payment after the cycle ends. For test subscriptions (isTest=true on
 * a dev store) Shopify treats the cancellation as effective immediately.
 *
 * Returns: { status, subscriptionId } — caller forwards both so the frontend
 * can log/verify exactly which subscription was cancelled.
 */
export default async function cancelSubscription(session) {
  const subscriptionId = await getActiveSubsId(session);
  console.log("[cancel] resolved active subscription id:", subscriptionId);

  if (!subscriptionId) {
    return { status: "NO_SUBSCRIPTION", subscriptionId: null };
  }

  const status = await appSubscriptionCancel(session, subscriptionId);
  return { status, subscriptionId };
}

async function getActiveSubsId(session) {
  const client = new shopify.api.clients.Graphql({ session });

  const currentInstallations = await client.request(RECURRING_PURCHASES_QUERY);

  const subscriptions =
    currentInstallations?.data?.currentAppInstallation?.activeSubscriptions || [];

  if (!subscriptions.length) {
    console.log("No active subscriptions found for current installation");
    return null;
  }

  const subscription = subscriptions[0];
  console.log("subscription name: ", subscription.name);
  console.log("Subscription Id: ", subscription.id);
  return subscription.id;
}

async function appSubscriptionCancel(session, subscriptionId) {
  if (!subscriptionId) {
    console.log("No subscription ID provided for cancellation");
    return "NO_SUBSCRIPTION";
  }

  const client = new shopify.api.clients.Graphql({ session });

  const body = await client.request(CANCEL_SUBSCRIPTION, {
    variables: {
      id: subscriptionId,
    },
  });

  if (body.errors?.length) {
    console.error("GraphQL errors during subscription cancel:", body.errors);
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }

  const data = body.data?.appSubscriptionCancel;
  if (data?.userErrors?.length) {
    console.error("User errors during subscription cancel:", data.userErrors);
    throw new Error(data.userErrors.map((error) => error.message).join("; "));
  }

  console.log("Subscription canceled successfully: ", session.shop);
  return data?.appSubscription?.status || "CANCELLED";
}

  const CANCEL_SUBSCRIPTION = `
mutation appSubscriptionCancel($id: ID!) {
  appSubscriptionCancel(id: $id) {
    appSubscription {
      id
      name
      status
    }
    userErrors {
      field
      message
    }
  }
}
`;

const RECURRING_PURCHASES_QUERY = `
query appSubscription {
  currentAppInstallation {
    activeSubscriptions {
      name, id, test
    }
  }
}
`;
