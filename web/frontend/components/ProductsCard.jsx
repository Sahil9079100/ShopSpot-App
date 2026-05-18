import { useState } from "react";
import { LegacyCard, TextContainer, Text } from "@shopify/polaris";
import { useAppQuery, useAuthenticatedFetch } from "../hooks";

export function ProductsCard() {
  const [isLoading, setIsLoading] = useState(true);
  const fetch = useAuthenticatedFetch();

  const {
    data,
    refetch: refetchProductCount,
    isLoading: isLoadingCount,
  } = useAppQuery({
    url: "/api/products/count",
    reactQueryOptions: {
      onSuccess: () => {
        setIsLoading(false);
      },
    },
  });

  const handlePopulate = async () => {
    setIsLoading(true);
    const response = await fetch("/api/products/create");

    if (response.ok) {
      await refetchProductCount();
      shopify.toast.show("5 products created!");
    } else {
      setIsLoading(false);
      shopify.toast.show("There was an error creating products", { isError: true });
    }
  };

  return (
    <>
      <LegacyCard
        title="Product Counter"
        sectioned
        primaryFooterAction={{
          content: "Populate 5 products",
          onAction: handlePopulate,
          loading: isLoading,
        }}
      >
        <TextContainer spacing="loose">
          <p>
            Sample products are created with a default title and price. You can
            remove them at any time.
          </p>
          <Text as="h4" variant="headingMd">
            TOTAL PRODUCTS
            <Text variant="bodyMd" as="p" fontWeight="semibold">
              {isLoadingCount ? "-" : data.count}
            </Text>
          </Text>
        </TextContainer>
      </LegacyCard>
    </>
  );
}
