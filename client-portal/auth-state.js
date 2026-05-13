(() => {
  const LEGACY_TOKEN_KEY = "auth_demo_token";
  const PROFILE_STORAGE_KEY = "client_portal_profile";

  let accessToken = "";
  let refreshPromise = null;

  function resolveApiBase() {
    const { protocol, hostname, port } = window.location;

    if (protocol === "file:") {
      return "http://127.0.0.1:3002";
    }

    if (port === "3003") {
      return `${protocol}//${hostname}:3002`;
    }

    return "";
  }

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

  function stripTokenFromUrl() {
    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has("token")) {
      return;
    }

    currentUrl.searchParams.delete("token");
    window.history.replaceState(null, "", currentUrl.toString());
  }

  function clearLegacyTokenStorage() {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
    window.localStorage.removeItem("auth_demo_logged_out_token");
    window.localStorage.removeItem("auth_demo_logout_at");
    stripTokenFromUrl();
  }

  function setAccessToken(token) {
    accessToken = String(token || "");
    clearLegacyTokenStorage();
  }

  function readToken() {
    return accessToken;
  }

  async function refreshAccessToken(options = {}) {
    const { redirect = true } = options;

    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = fetch(`${resolveApiBase()}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then(async (response) => {
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;

        if (!response.ok || !data?.access_token) {
          throw new Error(data?.message || data?.detail || `Refresh failed: ${response.status}`);
        }

        setAccessToken(data.access_token);
        return accessToken;
      })
      .catch((error) => {
        accessToken = "";
        clearLegacyTokenStorage();
        if (redirect) {
          window.location.replace(resolveAuthEntryUrl());
        }
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  }

  async function getAccessToken() {
    if (accessToken) {
      return accessToken;
    }

    return refreshAccessToken();
  }

  async function ensureAuthenticated() {
    await getAccessToken();
    return true;
  }

  async function authFetch(input, options = {}) {
    const url =
      typeof input === "string" && input.startsWith("/")
        ? `${resolveApiBase()}${input}`
        : input;
    const authDisabled = options.auth === false;
    const headers = new Headers(options.headers || {});

    if (!authDisabled) {
      headers.set("Authorization", `Bearer ${await getAccessToken()}`);
    }

    const requestOptions = {
      ...options,
      headers,
      credentials: options.credentials || "include",
    };
    delete requestOptions.auth;

    let response = await fetch(url, requestOptions);
    if (response.status === 401 && !authDisabled) {
      headers.set("Authorization", `Bearer ${await refreshAccessToken()}`);
      response = await fetch(url, requestOptions);
    }

    return response;
  }

  function clearAuthState() {
    accessToken = "";
    clearLegacyTokenStorage();
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    fetch(`${resolveApiBase()}/auth/logout`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  }

  function redirectToLogin() {
    clearAuthState();
    window.location.replace(resolveAuthEntryUrl());
  }

  window.ClientPortalAuth = {
    authFetch,
    clearAuthState,
    ensureAuthenticated,
    getAccessToken,
    readToken,
    redirectToLogin,
    refreshAccessToken,
    resolveAuthEntryUrl,
    setAccessToken,
  };

  clearLegacyTokenStorage();
  refreshAccessToken({ redirect: true }).catch(() => {});
})();
