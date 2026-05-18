import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function ExitIframe() {
  const { search } = useLocation();

  useEffect(() => {
    if (search) {
      const params = new URLSearchParams(search);
      const redirectUri = params.get("redirectUri");
      if (redirectUri) {
        const url = new URL(decodeURIComponent(redirectUri));
        if (url.hostname === location.hostname) {
          window.open(decodeURIComponent(redirectUri), "_top");
        }
      }
    }
  }, [search]);

  return null;
}
