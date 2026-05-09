(() => {
  const TOKEN_KEY = "auth_demo_token";
  const PROFILE_STORAGE_KEY = "client_portal_profile";
  const LOGGED_OUT_TOKEN_KEY = "auth_demo_logged_out_token";
  const LOGOUT_AT_KEY = "auth_demo_logout_at";

  function resolveAuthEntryUrl() {
    const { protocol, hostname, port } = window.location;

    if (protocol === "file:") {
      return "http://127.0.0.1:8080/auth/?mode=login";
    }

    if (port === "3003") {
      return `${protocol}//${hostname}:8000/auth/?mode=login`;
    }

    return `${window.location.origin}/auth/?mode=login`;
  }

  function getUrlToken() {
    return new URLSearchParams(window.location.search).get("token")?.trim() || "";
  }

  function stripTokenFromUrl() {
    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has("token")) {
      return;
    }

    currentUrl.searchParams.delete("token");
    window.history.replaceState(null, "", currentUrl.toString());
  }

  function isLoggedOutToken(token) {
    return Boolean(token && window.localStorage.getItem(LOGGED_OUT_TOKEN_KEY) === tokenFingerprint(token));
  }

  function tokenFingerprint(token) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${token.length}:${hash >>> 0}`;
  }

  function readToken() {
    const urlToken = getUrlToken();
    if (urlToken) {
      stripTokenFromUrl();
      if (isLoggedOutToken(urlToken)) {
        window.localStorage.removeItem(TOKEN_KEY);
        return "";
      }

      window.localStorage.setItem(TOKEN_KEY, urlToken);
      window.localStorage.removeItem(LOGGED_OUT_TOKEN_KEY);
      window.localStorage.removeItem(LOGOUT_AT_KEY);
      return urlToken;
    }

    const storedToken = window.localStorage.getItem(TOKEN_KEY)?.trim() || "";
    if (isLoggedOutToken(storedToken)) {
      window.localStorage.removeItem(TOKEN_KEY);
      return "";
    }

    return storedToken;
  }

  function clearAuthState() {
    const token = getUrlToken() || window.localStorage.getItem(TOKEN_KEY)?.trim() || "";
    if (token) {
      window.localStorage.setItem(LOGGED_OUT_TOKEN_KEY, tokenFingerprint(token));
    }
    window.localStorage.setItem(LOGOUT_AT_KEY, String(Date.now()));
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    stripTokenFromUrl();
  }

  function redirectToLogin() {
    clearAuthState();
    window.location.replace(resolveAuthEntryUrl());
  }

  function clearLogoutState() {
    window.localStorage.removeItem(LOGGED_OUT_TOKEN_KEY);
    window.localStorage.removeItem(LOGOUT_AT_KEY);
  }

  function ensureAuthenticated() {
    if (!readToken()) {
      redirectToLogin();
      return false;
    }
    return true;
  }

  function protectPage() {
    if (!ensureAuthenticated()) {
      return;
    }

    window.addEventListener("pageshow", () => {
      ensureAuthenticated();
    });

    window.addEventListener("storage", (event) => {
      if ([TOKEN_KEY, LOGGED_OUT_TOKEN_KEY, LOGOUT_AT_KEY].includes(event.key)) {
        ensureAuthenticated();
      }
    });
  }

  window.ClientPortalAuth = {
    clearAuthState,
    clearLogoutState,
    ensureAuthenticated,
    readToken,
    redirectToLogin,
    resolveAuthEntryUrl,
  };

  protectPage();
})();
