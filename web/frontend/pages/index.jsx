import {
  LegacyCard,
  Page,
  Layout,
  Button,
  Text,
  ButtonGroup,
  Box,
  Banner,
  Badge,
  LegacyStack,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { ExternalMinor, ThemeEditMajor } from "@shopify/polaris-icons";
import { useNavigate } from "react-router-dom";
import { useSubscriptionStatus } from "../hooks";
import "./Dashboard.css";

export default function HomePage() {
  const [, setToastError] = useState(null);
  const navigate = useNavigate();

  // Subscription status comes from the same shared hook the Subscription
  // page uses — guarantees the badge here and the Active flag on /pricing
  // can never disagree about the merchant's plan.
  const { isLoaded, isPremiumActive } = useSubscriptionStatus();

  // Shop string for building the Theme Editor URL. Read directly from
  // App Bridge / URL so we don't need to keep a duplicate state copy.
  const shop = (() => {
    try {
      if (typeof shopify !== "undefined" && shopify?.config?.shop) {
        return shopify.config.shop;
      }
    } catch (_) {}
    return new URLSearchParams(window.location.search).get("shop");
  })();
  const shopData = shop ? { shop } : null;

  const template = "index";
  const uuid = "a2466bea-1992-4968-aeaa-2dd4f83511b6";
  const handle = "shop_the_look_embed";

  const openThemeEditor = useCallback(() => {
    const adminPath = `/themes/current/editor?context=apps&template=${template}&activateAppId=${uuid}/${handle}`;

    try {
      window.open(`shopify:admin${adminPath}`, "_self");
    } catch (_error) {
      if (shopData?.shop) {
        window.open(`https://${shopData.shop}/admin${adminPath}`, "_blank");
      } else {
        setToastError(
          "Unable to open Theme Editor right now. Please try again."
        );
        shopify.toast.show(
          "Unable to open Theme Editor right now. Please try again.",
          { isError: true }
        );
      }
    }
  }, [handle, shopData?.shop, template, uuid]);

  const navigateToPricing = useCallback(() => {
    navigate("/pricing");
  }, [navigate]);

  return (
    <div className="ls-dashboard">
      <Page title="ShopSpot home">
        <Layout>
          <Layout.Section>
            <div className="ls-hero">
              <Banner status="info" title="Welcome to ShopSpot">
                <p>
                  Turn any product image into a shoppable look. Drop hotspots,
                  link products, and let shoppers add multiple items to cart
                  from a single visual.
                </p>
              </Banner>
            </div>
          </Layout.Section>

          <Layout.Section>
            <div className="ls-card ls-card--status">
              <LegacyCard sectioned>
                <div className="ls-status-row">
                  <div className="ls-status-text">
                    <Text variant="headingMd" as="h2">
                      Your subscription
                    </Text>
                    <Box paddingBlockStart="200">
                      <Text variant="bodyMd" color="subdued" as="p">
                        {isPremiumActive
                          ? "Premium plan active. All ShopSpot features are unlocked."
                          : "You're currently on the Free plan with limited usage."}
                      </Text>
                    </Box>
                  </div>
                  <div className="ls-status-badge">
                    {isLoaded ? (
                      isPremiumActive ? (
                        <Badge status="success">Premium</Badge>
                      ) : (
                        <Badge>Free</Badge>
                      )
                    ) : (
                      <Badge>—</Badge>
                    )}
                  </div>
                </div>
                <Box paddingBlockStart="400">
                  <ButtonGroup>
                    <Button
                      onClick={navigateToPricing}
                      icon={ExternalMinor}
                      disabled={!isLoaded}
                    >
                      {isPremiumActive ? "Manage plan" : "Compare plans"}
                    </Button>
                    <Button
                      primary
                      icon={ThemeEditMajor}
                      onClick={openThemeEditor}
                    >
                      Open theme editor
                    </Button>
                  </ButtonGroup>
                </Box>
              </LegacyCard>
            </div>
          </Layout.Section>

          <Layout.Section>
            <div className="ls-card ls-card--steps">
              <LegacyCard title="Get started in four steps" sectioned>
                <ol className="ls-steps">
                  <li>
                    <span className="ls-step-num">1</span>
                    <div>
                      <Text variant="headingSm" as="h3">
                        Add the ShopSpot block
                      </Text>
                      <Text variant="bodyMd" color="subdued" as="p">
                        Click <strong>Open theme editor</strong> above, then add
                        the ShopSpot block to any section of your theme.
                      </Text>
                    </div>
                  </li>
                  <li>
                    <span className="ls-step-num">2</span>
                    <div>
                      <Text variant="headingSm" as="h3">
                        Upload a hero image
                      </Text>
                      <Text variant="bodyMd" color="subdued" as="p">
                        Pick a single image that pairs your products together —
                        editorial flatlays and lifestyle shots work best.
                      </Text>
                    </div>
                  </li>
                  <li>
                    <span className="ls-step-num">3</span>
                    <div>
                      <Text variant="headingSm" as="h3">
                        Drop hotspots and link products
                      </Text>
                      <Text variant="bodyMd" color="subdued" as="p">
                        Place a hotspot over each product on the image and pick
                        the matching product from your catalog.
                      </Text>
                    </div>
                  </li>
                  <li>
                    <span className="ls-step-num">4</span>
                    <div>
                      <Text variant="headingSm" as="h3">
                        Save and publish
                      </Text>
                      <Text variant="bodyMd" color="subdued" as="p">
                        Save the theme. Shoppers can now tap any hotspot to add
                        the product without leaving the page.
                      </Text>
                    </div>
                  </li>
                </ol>
              </LegacyCard>
            </div>
          </Layout.Section>

          <Layout.Section>
            <div className="ls-card ls-card--highlights">
              <LegacyCard title="What ShopSpot does for your store" sectioned>
                <div className="ls-highlights-grid">
                  <div className="ls-highlight">
                    <div className="ls-highlight-dot ls-dot-a" />
                    <Text variant="headingSm" as="h3">
                      Shoppable lookbooks
                    </Text>
                    <Text variant="bodyMd" color="subdued" as="p">
                      Turn any product photo into an interactive gallery with
                      tappable items.
                    </Text>
                  </div>
                  <div className="ls-highlight">
                    <div className="ls-highlight-dot ls-dot-b" />
                    <Text variant="headingSm" as="h3">
                      Higher cart value
                    </Text>
                    <Text variant="bodyMd" color="subdued" as="p">
                      Pair products in one view so shoppers add the full look
                      instead of a single piece.
                    </Text>
                  </div>
                  <div className="ls-highlight">
                    <div className="ls-highlight-dot ls-dot-c" />
                    <Text variant="headingSm" as="h3">
                      No code, no theme edits
                    </Text>
                    <Text variant="bodyMd" color="subdued" as="p">
                      Drop the block into any 2.0 theme — works out of the box
                      on desktop and mobile.
                    </Text>
                  </div>
                  <div className="ls-highlight">
                    <div className="ls-highlight-dot ls-dot-d" />
                    <Text variant="headingSm" as="h3">
                      Lightweight by design
                    </Text>
                    <Text variant="bodyMd" color="subdued" as="p">
                      Loads fast, plays well with image lazy-loading, and won't
                      tank your speed score.
                    </Text>
                  </div>
                </div>
              </LegacyCard>
            </div>
          </Layout.Section>

          <Layout.Section>
            <div className="ls-card ls-card--cta">
              <LegacyCard sectioned>
                <LegacyStack alignment="center" distribution="equalSpacing">
                  <div>
                    <Text variant="headingMd" as="h2">
                      Need a hand?
                    </Text>
                    <Text variant="bodyMd" color="subdued" as="p">
                      Email us at strumpet204@gmail.com — we usually reply
                      within a business day.
                    </Text>
                  </div>
                  <Button
                    onClick={() =>
                      window.open("mailto:strumpet204@gmail.com")
                    }
                  >
                    Contact support
                  </Button>
                </LegacyStack>
              </LegacyCard>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
