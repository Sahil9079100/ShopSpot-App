import { BrowserRouter } from "react-router-dom";
import Routes from "./Routes";

import {
  AppBridgeProvider,
  QueryProvider,
  PolarisProvider,
} from "./components";
import { SubscriptionProvider } from "./hooks";

export default function App() {
  // Any .tsx or .jsx files in /pages will become a route
  // See documentation for <Routes /> for more info
  const pages = import.meta.globEager("./pages/**/!(*.test.[jt]sx)*.([jt]sx)");

  return (
    <PolarisProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppBridgeProvider>
          <QueryProvider>
            {/* SubscriptionProvider runs the /api/billing/status fetch ONCE
                at the app level and shares the result with every page via
                useSubscriptionStatus(). Home and Subscription pages now
                read the same context object — they cannot show different
                plan states. */}
            <SubscriptionProvider>
              <ui-nav-menu>
                <a href="/" rel="home">Home</a>
                <a href="/install">Settings</a>
                <a href="/pricing">Subscription</a>
              </ui-nav-menu>
              <Routes pages={pages} />
            </SubscriptionProvider>
          </QueryProvider>
        </AppBridgeProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}
