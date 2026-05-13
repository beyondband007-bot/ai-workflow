(() => {
  const THEME_KEY = "client_portal_theme";
  const TOKEN_KEY = "auth_demo_token";
  const PROFILE_STORAGE_KEY = "client_portal_profile";
  const STATIC_ASSET_VERSION = "20260428a";
  const DEFAULT_AVATAR_SRC = `./logo.png?v=${STATIC_ASSET_VERSION}`;

  let profileState = null;
  let pendingAvatarDataUrl = "";
  let pendingAvatarFile = null;

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

  function getToken() {
    if (window.ClientPortalAuth) {
      return window.ClientPortalAuth.readToken();
    }
    return "";
  }

  function clearAuthState() {
    if (window.ClientPortalAuth) {
      window.ClientPortalAuth.clearAuthState();
      return;
    }

    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  }

  function redirectToLogin() {
    if (window.ClientPortalAuth) {
      window.ClientPortalAuth.redirectToLogin();
      return;
    }

    clearAuthState();
    window.location.replace(resolveAuthEntryUrl());
  }

  async function requestJson(path, options = {}) {
    const response = window.ClientPortalAuth
      ? await window.ClientPortalAuth.authFetch(path, options)
      : await fetch(`${resolveApiBase()}${path}`, {
      headers: {
        ...(options.auth === false || !getToken() ? {} : { Authorization: `Bearer ${getToken()}` }),
        ...(options.headers || {}),
      },
      ...options,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      if (response.status === 401 && options.auth !== false) {
        redirectToLogin();
        throw new Error("登录已过期，请重新登录");
      }
      throw new Error(data?.message || data?.detail || `Request failed: ${response.status}`);
    }

    return data;
  }

  function readStoredProfile() {
    try {
      const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn("failed to read profile settings", error);
      return null;
    }
  }

  function writeStoredProfile(profile) {
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch (error) {
      console.warn("failed to write profile settings", error);
    }
  }

  function normalizeDisplayName(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 24);
  }

  function normalizeUsername(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, "")
      .slice(0, 24);
  }

  function normalizePhone(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 20);
  }

  function normalizeAddress(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 255);
  }

  function ensureProfileFormFields() {
    const displayNameInput = document.getElementById("profileDisplayNameInput");
    const usernameInput = document.getElementById("profileUsernameInput");
    const phoneInput = document.getElementById("profilePhoneInput");
    const addressInput = document.getElementById("profileAddressInput");

    if (displayNameInput) {
      displayNameInput.maxLength = 24;
    }
    if (usernameInput) {
      usernameInput.maxLength = 24;
    }
    if (phoneInput) {
      phoneInput.maxLength = 20;
      phoneInput.required = false;
    }
    if (addressInput) {
      addressInput.maxLength = 255;
    }
  }

  function getProfileElements() {
    ensureProfileFormFields();
    return {
      menuRoot: document.getElementById("profileMenu"),
      menuTrigger: document.getElementById("profileMenuTrigger"),
      menuDropdown: document.getElementById("profileMenuDropdown"),
      topbarDisplayName: document.querySelector("#profileMenuTrigger .topbar-profile-copy span"),
      topbarAvatar: document.getElementById("profileAvatarImage"),
      menuAvatar: document.getElementById("profileMenuAvatarImage"),
      menuDisplayName: document.getElementById("profileMenuDisplayName"),
      menuUsername: document.getElementById("profileMenuUsername"),
      editButton: document.getElementById("profileEditButton"),
      logoutButton: document.getElementById("profileLogoutButton"),
      modal: document.getElementById("profileModal"),
      modalClose: document.getElementById("profileModalClose"),
      modalCancel: document.getElementById("profileModalCancel"),
      modalBackdrop: document.querySelector("[data-profile-close='true']"),
      form: document.getElementById("profileForm"),
      avatarPreview: document.getElementById("profileAvatarPreview"),
      avatarInput: document.getElementById("profileAvatarInput"),
      avatarUpload: document.getElementById("profileAvatarUpload"),
      displayNameInput: document.getElementById("profileDisplayNameInput"),
      usernameInput: document.getElementById("profileUsernameInput"),
      phoneInput: document.getElementById("profilePhoneInput"),
      addressInput: document.getElementById("profileAddressInput"),
      submitButton: document.querySelector("#profileForm button[type='submit']"),
      formError: document.getElementById("profileFormError"),
    };
  }

  function getProfileDefaults() {
    const elements = getProfileElements();
    return {
      displayName: normalizeDisplayName(elements.topbarDisplayName?.textContent || "Token Aggregator"),
      username: normalizeUsername(elements.menuUsername?.textContent?.replace(/^@/, "") || "Token_Aggregator"),
      avatarDataUrl: "",
      phone: "",
      address: "",
    };
  }

  function resolveProfileState(overrides = {}) {
    const defaults = getProfileDefaults();
    return {
      displayName:
        normalizeDisplayName(overrides.displayName || profileState?.displayName || defaults.displayName) ||
        defaults.displayName,
      username:
        normalizeUsername(overrides.username || profileState?.username || defaults.username) || defaults.username,
      avatarDataUrl: String(
        overrides.avatarDataUrl ?? profileState?.avatarDataUrl ?? defaults.avatarDataUrl ?? "",
      ),
      phone: normalizePhone(overrides.phone ?? profileState?.phone ?? defaults.phone),
      address: normalizeAddress(overrides.address ?? profileState?.address ?? defaults.address),
    };
  }

  function renderProfile(profile, options = {}) {
    const elements = getProfileElements();
    if (!elements.menuTrigger) {
      return;
    }

    profileState = resolveProfileState(profile);
    const avatarSrc = profileState.avatarDataUrl || DEFAULT_AVATAR_SRC;

    if (elements.topbarDisplayName) {
      elements.topbarDisplayName.textContent = profileState.displayName;
    }
    if (elements.menuDisplayName) {
      elements.menuDisplayName.textContent = profileState.displayName;
    }
    if (elements.menuUsername) {
      elements.menuUsername.textContent = `@${profileState.username}`;
    }

    [elements.topbarAvatar, elements.menuAvatar, elements.avatarPreview].forEach((image) => {
      if (image) {
        image.src = avatarSrc;
      }
    });

    if (options.persist) {
      writeStoredProfile(profileState);
    }
  }

  function mapUserToProfile(user = {}) {
    return {
      displayName: normalizeDisplayName(user.nickname || user.username || "Token Aggregator"),
      username: normalizeUsername(user.username || "Token_Aggregator"),
      avatarDataUrl: String(user.avatar_img || ""),
      phone: normalizePhone(user.phone || ""),
      address: normalizeAddress(user.address || ""),
    };
  }

  function closeProfileMenu() {
    const elements = getProfileElements();
    if (!elements.menuRoot || !elements.menuTrigger || !elements.menuDropdown) {
      return;
    }

    elements.menuRoot.classList.remove("is-open");
    elements.menuTrigger.setAttribute("aria-expanded", "false");
    elements.menuDropdown.setAttribute("aria-hidden", "true");
  }

  function openProfileMenu() {
    const elements = getProfileElements();
    if (!elements.menuRoot || !elements.menuTrigger || !elements.menuDropdown) {
      return;
    }

    elements.menuRoot.classList.add("is-open");
    elements.menuTrigger.setAttribute("aria-expanded", "true");
    elements.menuDropdown.setAttribute("aria-hidden", "false");
  }

  function syncProfileForm() {
    const elements = getProfileElements();
    if (!elements.form) {
      return;
    }

    const nextProfile = resolveProfileState();
    pendingAvatarDataUrl = nextProfile.avatarDataUrl || "";
    pendingAvatarFile = null;

    if (elements.displayNameInput) {
      elements.displayNameInput.value = nextProfile.displayName;
    }
    if (elements.usernameInput) {
      elements.usernameInput.value = nextProfile.username;
    }
    if (elements.phoneInput) {
      elements.phoneInput.value = nextProfile.phone;
    }
    if (elements.addressInput) {
      elements.addressInput.value = nextProfile.address;
    }
    if (elements.avatarPreview) {
      elements.avatarPreview.src = pendingAvatarDataUrl || DEFAULT_AVATAR_SRC;
    }
    if (elements.avatarInput) {
      elements.avatarInput.value = "";
    }
    if (elements.formError) {
      elements.formError.hidden = true;
      elements.formError.textContent = "";
    }
  }

  async function uploadProfileAvatar(file) {
    const formData = new FormData();
    formData.append("avatar", file);

    const response = window.ClientPortalAuth
      ? await window.ClientPortalAuth.authFetch("/api/v1/profile/avatar", {
          method: "POST",
          body: formData,
        })
      : await fetch(`${resolveApiBase()}/api/v1/profile/avatar`, {
          method: "POST",
          headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
          body: formData,
        });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(data?.message || data?.detail || `Avatar upload failed: ${response.status}`);
    }

    return data;
  }

  async function saveProfile(payload) {
    return requestJson("/api/v1/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nickname: payload.displayName,
        username: payload.username,
        phone: payload.phone || null,
        address: payload.address || null,
      }),
    });
  }

  function openProfileModal() {
    const elements = getProfileElements();
    if (!elements.modal) {
      return;
    }

    syncProfileForm();
    elements.modal.classList.add("is-open");
    elements.modal.setAttribute("aria-hidden", "false");
    window.setTimeout(() => elements.displayNameInput?.focus(), 10);
  }

  function closeProfileModal() {
    const elements = getProfileElements();
    if (!elements.modal) {
      return;
    }

    elements.modal.classList.remove("is-open");
    elements.modal.setAttribute("aria-hidden", "true");
  }

  function logout() {
    redirectToLogin();
  }

  function initThemeToggle() {
    const body = document.body;
    const toggleButton = document.getElementById("themeToggle");
    if (!body || !toggleButton) {
      return;
    }

    const toggleLabel = toggleButton.querySelector(".theme-toggle-label");

    function applyTheme(theme) {
      const nextTheme = theme === "dark" ? "dark" : "light";
      const isDark = nextTheme === "dark";
      body.dataset.theme = nextTheme;
      toggleButton.setAttribute("aria-pressed", String(isDark));
      if (toggleLabel) {
        toggleLabel.textContent = isDark ? "夜间模式" : "白天模式";
      }
      window.localStorage.setItem(THEME_KEY, nextTheme);
    }

    applyTheme(window.localStorage.getItem(THEME_KEY) || "light");

    toggleButton.addEventListener("click", () => {
      applyTheme(body.dataset.theme === "dark" ? "light" : "dark");
    });
  }

  function initProfileControls() {
    const elements = getProfileElements();
    if (!elements.menuTrigger || !elements.form) {
      return;
    }

    renderProfile(readStoredProfile() || getProfileDefaults());

    elements.menuTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (elements.menuRoot?.classList.contains("is-open")) {
        closeProfileMenu();
      } else {
        openProfileMenu();
      }
    });

    elements.editButton?.addEventListener("click", () => {
      closeProfileMenu();
      openProfileModal();
    });

    elements.logoutButton?.addEventListener("click", logout);
    elements.modalClose?.addEventListener("click", closeProfileModal);
    elements.modalCancel?.addEventListener("click", closeProfileModal);
    elements.modalBackdrop?.addEventListener("click", closeProfileModal);

    elements.avatarUpload?.addEventListener("click", () => {
      elements.avatarInput?.click();
    });

    elements.avatarInput?.addEventListener("change", () => {
      const file = elements.avatarInput?.files?.[0];
      if (!file) {
        return;
      }

      if (!file.type.startsWith("image/")) {
        if (elements.formError) {
          elements.formError.hidden = false;
          elements.formError.textContent = "请选择图片文件作为头像。";
        }
        return;
      }

      pendingAvatarFile = file;
      const reader = new FileReader();
      reader.onload = () => {
        pendingAvatarDataUrl = typeof reader.result === "string" ? reader.result : "";
        if (elements.avatarPreview) {
          elements.avatarPreview.src = pendingAvatarDataUrl || DEFAULT_AVATAR_SRC;
        }
        if (elements.formError) {
          elements.formError.hidden = true;
          elements.formError.textContent = "";
        }
      };
      reader.readAsDataURL(file);
    });

    elements.form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const displayName = normalizeDisplayName(elements.displayNameInput?.value);
      const username = normalizeUsername(elements.usernameInput?.value).toLowerCase();
      const phone = normalizePhone(elements.phoneInput?.value);
      const address = normalizeAddress(elements.addressInput?.value);

      if (!displayName) {
        elements.formError.hidden = false;
        elements.formError.textContent = "请输入昵称。";
        elements.displayNameInput?.focus();
        return;
      }

      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        elements.formError.hidden = false;
        elements.formError.textContent = "用户名需为 3-24 位，只能包含字母、数字、下划线。";
        elements.usernameInput?.focus();
        return;
      }

      const originalText = elements.submitButton?.textContent || "保存";
      if (elements.submitButton) {
        elements.submitButton.disabled = true;
        elements.submitButton.textContent = "保存中...";
      }

      try {
        if (pendingAvatarFile) {
          const avatarResult = await uploadProfileAvatar(pendingAvatarFile);
          pendingAvatarDataUrl =
            avatarResult.avatar_img || avatarResult.avatar_url || pendingAvatarDataUrl;
        }

        const savedUser = await saveProfile({
          displayName,
          username,
          phone,
          address,
        });

        renderProfile(
          {
            ...mapUserToProfile(savedUser),
            avatarDataUrl: savedUser.avatar_img || pendingAvatarDataUrl || profileState?.avatarDataUrl || "",
          },
          { persist: true },
        );
        closeProfileModal();
      } catch (error) {
        elements.formError.hidden = false;
        elements.formError.textContent = error.message || "保存失败，请稍后重试。";
      } finally {
        if (elements.submitButton) {
          elements.submitButton.disabled = false;
          elements.submitButton.textContent = originalText;
        }
      }
    });

    document.addEventListener("click", (event) => {
      if (!elements.menuRoot?.contains(event.target)) {
        closeProfileMenu();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeProfileMenu();
        closeProfileModal();
      }
    });
  }

  async function syncCurrentUser() {
    try {
      await window.ClientPortalAuth?.ensureAuthenticated();
      const currentUser = await requestJson("/me");
      renderProfile(
        {
          ...mapUserToProfile(currentUser),
          avatarDataUrl: currentUser.avatar_img || readStoredProfile()?.avatarDataUrl || "",
        },
        { persist: true },
      );
    } catch (error) {
      console.warn("failed to sync current user", error);
    }
  }

  function init() {
    if (window.__portalShellInitialized) {
      return;
    }
    window.__portalShellInitialized = true;
    initThemeToggle();
    initProfileControls();
    syncCurrentUser();
  }

  window.portalShell = {
    init,
    syncCurrentUser,
  };

  init();
})();
