import { LegacyCard, Page, Layout, TextContainer, Text } from "@shopify/polaris";

export default function PageName() {
  return (
    <Page title="Page name">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <Text variant="headingMd" as="h2">
              Heading
            </Text>
            <TextContainer>
              <p>Body</p>
            </TextContainer>
          </LegacyCard>
          <LegacyCard sectioned>
            <Text variant="headingMd" as="h2">
              Heading
            </Text>
            <TextContainer>
              <p>Body</p>
            </TextContainer>
          </LegacyCard>
        </Layout.Section>
        <Layout.Section secondary>
          <LegacyCard sectioned>
            <Text variant="headingMd" as="h2">
              Heading
            </Text>
            <TextContainer>
              <p>Body</p>
            </TextContainer>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
