import {
  LegacyCard,
  Page,
  Layout,
  Text,
  Box,
  Button,
  Banner,
} from "@shopify/polaris";
import { useCallback } from "react";
import { useAppQuery } from "../hooks";
import { ThemeEditMajor } from "@shopify/polaris-icons";
import "./Dashboard.css";

const STEPS = [
  {
    title: "Open your theme editor",
    body: "From your Shopify admin, head to Online Store → Themes → Customize on your active theme.",
  },
  {
    title: "Add the ShopSpot block",
    body: "In the theme editor, pick a section and click “Add block”. Choose “ShopSpot” from the App blocks list.",
  },
  {
    title: "Upload a hero image",
    body: "Use a single image that frames your products together. Lifestyle shots and editorial flatlays work best.",
  },
  {
    title: "Drop hotspots and link products",
    body: "Position a hotspot on each product in the image and pick the matching product from your catalog.",
  },
  {
    title: "Save and preview",
    body: "Save the theme. Visit any page where you placed the block to see ShopSpot live.",
  },
];

export default function Installation() {
  const { data: shopData } = useAppQuery({ url: "/api/getshop" });

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
      }
    }
  }, [handle, shopData?.shop, template, uuid]);

  return (
    <div className="ls-dashboard">
      <Page title="Installation guide">
        <Layout>
          <Layout.Section>
            <div className="ls-hero">
              <Banner
                status="info"
                title="A two-minute setup"
                action={{
                  content: "Open theme editor",
                  onAction: openThemeEditor,
                }}
              >
                <p>
                  ShopSpot installs as a theme app block — no code changes, no
                  uploads. Follow the five steps below and you're ready to go.
                </p>
              </Banner>
            </div>
          </Layout.Section>

          <Layout.Section>
            <div className="ls-card ls-card--steps">
              <LegacyCard title="Step-by-step" sectioned>
                <ol className="ls-steps">
                  {STEPS.map((step, idx) => (
                    <li key={step.title}>
                      <span className="ls-step-num">{idx + 1}</span>
                      <div>
                        <Text variant="headingSm" as="h3">
                          {step.title}
                        </Text>
                        <Text variant="bodyMd" color="subdued" as="p">
                          {step.body}
                        </Text>
                      </div>
                    </li>
                  ))}
                </ol>
                <Box paddingBlockStart="400">
                  <Button
                    primary
                    icon={ThemeEditMajor}
                    onClick={openThemeEditor}
                  >
                    Open theme editor
                  </Button>
                </Box>
              </LegacyCard>
            </div>
          </Layout.Section>

          <Layout.Section>
            <div className="ls-card ls-card--highlights">
              <LegacyCard title="Theme requirements" sectioned>
                <Text variant="bodyMd" as="p">
                  ShopSpot works on every Shopify Online Store 2.0 theme.
                  Older 1.0 themes (e.g. legacy Debut, classic Brooklyn) are
                  not supported because they don't run app blocks.
                </Text>
                <Box paddingBlockStart="200">
                  <Text variant="bodyMd" color="subdued" as="p">
                    Not sure which version your theme is on? Open the theme
                    editor — if you can see the “App blocks” picker
                    when adding a block to a section, you're on 2.0 and
                    ShopSpot is good to go.
                  </Text>
                </Box>
              </LegacyCard>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
