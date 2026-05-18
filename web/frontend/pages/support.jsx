import {
  LegacyCard,
  Page,
  Layout,
  Text,
  Box,
  Banner,
  Button,
  LegacyStack,
} from "@shopify/polaris";
import { FAQ } from "../components/FAQ";
import "./Dashboard.css";

const SUPPORT_EMAIL = "strumpet204@gmail.com";

const FAQS = [
  {
    q: "Where on my store can I use ShopSpot?",
    a: "Anywhere your theme lets you add an app block — product pages, the homepage, collection pages, custom pages, and more.",
  },
  {
    q: "Does ShopSpot work with my theme?",
    a: "ShopSpot works on every Shopify Online Store 2.0 theme. If your theme exposes an “App blocks” picker in the editor, ShopSpot is supported.",
  },
  {
    q: "Will ShopSpot slow my store down?",
    a: "No. The block ships a small CSS and JS bundle, lazy-loads images, and won't add render-blocking scripts.",
  },
  {
    q: "Can I tag more than one product on a single image?",
    a: "Yes. Each ShopSpot block supports up to five product hotspots per image on the Premium plan.",
  },
  {
    q: "Can I customize the colors and headings?",
    a: "Yes. Heading text, button background, hotspot color, and image fit are all editable from the block settings panel in your theme editor.",
  },
  {
    q: "Is ShopSpot mobile-friendly?",
    a: "Yes. The hotspot grid adapts to small screens and opens products in a mobile drawer for an easy tap-to-add experience.",
  },
  {
    q: "What use cases work well with ShopSpot?",
    a: "Outfit-style shoppable lookbooks, “complete the room” furniture pairings, “pair with” cross-sells, gift bundles, and editorial campaign pages.",
  },
  {
    q: "How do I get help if something isn't working?",
    a: `Email us at ${SUPPORT_EMAIL}. We usually reply within one business day.`,
  },
];

export default function Support() {
  const openMail = () => window.open(`mailto:${SUPPORT_EMAIL}`);

  return (
    <div className="ls-dashboard">
      <Page title="Help & support">
        <Layout>
          <Layout.Section>
            <div className="ls-hero">
              <Banner
                status="info"
                title="We're here when you need a hand"
                action={{
                  content: "Email support",
                  onAction: openMail,
                }}
              >
                <p>
                  Tell us what you're trying to do and we'll get back within a
                  business day at <strong>{SUPPORT_EMAIL}</strong>.
                </p>
              </Banner>
            </div>
          </Layout.Section>

          <Layout.Section>
            <div className="ls-card ls-card--cta">
              <LegacyCard sectioned>
                <LegacyStack alignment="center" distribution="equalSpacing">
                  <div>
                    <Text variant="headingMd" as="h2">
                      Direct line
                    </Text>
                    <Box paddingBlockStart="100">
                      <Text variant="bodyMd" color="subdued" as="p">
                        Skip the form, just email us. Include screenshots when
                        you can — it speeds things up.
                      </Text>
                    </Box>
                  </div>
                  <Button primary onClick={openMail}>
                    Email {SUPPORT_EMAIL}
                  </Button>
                </LegacyStack>
              </LegacyCard>
            </div>
          </Layout.Section>

          <Layout.Section>
            <div className="ls-card ls-card--faq">
              <LegacyCard title="Frequently asked questions" sectioned>
                <div className="ls-faq">
                  {FAQS.map((item) => (
                    <FAQ key={item.q} q={item.q} a={item.a} />
                  ))}
                </div>
              </LegacyCard>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
