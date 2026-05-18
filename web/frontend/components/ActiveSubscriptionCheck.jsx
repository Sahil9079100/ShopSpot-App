import { Banner } from "@shopify/polaris";
import { useState, useCallback } from "react";
import { useAppQuery, useAuthenticatedFetch } from "../hooks";
import $ from "jquery";

export function ActiveSubscription() {
  const [isLoading, setIsLoading] = useState(true);

  const { data, isLoading: isLoadingCount } = useAppQuery({
    url: "/api/hasActiveSubscription",
    reactQueryOptions: {
      onSuccess: () => {
        setIsLoading(false);
      },
    },
  });

  console.log("hasActiveSubscription:", data?.hasActiveSubscription);

  if (data?.hasActiveSubscription === false) {
    $(".Polaris-Button").each(function () {
      if ($(this).text().includes("Activate Now - Gold Plan ➡️")) {
        $(this).hide();
      }
    });
  } else if (data?.hasActiveSubscription === true) {
    $(".Polaris-Button").each(function () {
      if ($(this).text().includes("Activate Now - Free Plan ➡️")) {
        $(this).hide();
      }
    });
  }

  function handleDismiss() {
    console.log("dismiss clicked");
    document.getElementById("subscriptionBanner").remove();
  }

  return (
    <div id="subscriptionBanner">
      {isLoadingCount ? (
        ""
      ) : data?.hasActiveSubscription ? (
        <Banner
          title="Current Plan: Premium plan"
          status="success"
          onDismiss={() => {
            handleDismiss();
          }}
        >
          <p>
            Congratulations🎉🎉, You are now our pro{" "}
            <strong>Premium plan</strong> customer and can access all
            features of this app without any limitation.
          </p>
          <p>
            <strong>Enable Steps: </strong> Open Theme Customization &gt; Add a
            section &gt; choose <em>ShopSpot Premium</em> from the app blocks
            picker.
          </p>
        </Banner>
      ) : (
        <Banner
          title="Current Plan: Free"
          status="warning"
          onDismiss={() => {
            handleDismiss();
          }}
        >
          <p>- You are currently on Free plan with limited features.</p>
          <p>
            - <strong>Enable Steps: </strong> Open Theme Customization &gt; Add
            a section &gt; choose <em>ShopSpot Free</em> from the app blocks
            picker.
          </p>
          <p>- Compare plans below for better insights. </p>
    
        </Banner>
      )}
    </div>
  );
}
