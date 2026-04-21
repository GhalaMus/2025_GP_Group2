// src/components/Account.jsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut, Check, AlertCircle, AlertTriangle, Save, RefreshCcw, Bell, PlayCircle, Palette, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../utils/api";
import { DEFAULT_ACCOUNT_PREFERENCES, loadAccountPreferences, saveAccountPreferences } from "../utils/accountPreferences";

/* ---- Dark mode helper ---- */
function applyDarkMode(enabled) {
  const root = document.documentElement;
  if (enabled) root.classList.add("dark");
  else root.classList.remove("dark");
  localStorage.setItem("wecast:dark", JSON.stringify(enabled));
}

/* ---- Toast notification ---- */
function Toast({ message, type = "success", onClose }) {
  if (!message) return null;
  
  const bgColor = {
    success: "bg-green-500 border-green-300",
    error: "bg-red-500 border-red-300",
    warning: "bg-yellow-500 border-yellow-300",
    info: "bg-blue-500 border-blue-300"
  }[type] || "bg-green-500 border-green-300";

  const Icon = {
    success: Check,
    error: AlertCircle,
    warning: AlertTriangle,
    info: AlertCircle
  }[type] || Check;

  return (
    <div className="fixed top-6 right-6 z-[10000] animate-in slide-in-from-right-8 duration-300">
      <div className={`${bgColor} text-white px-6 py-3 rounded-xl shadow-2xl border`}>
        <div className="flex items-center gap-2 font-semibold">
          <Icon className="w-4 h-4" />
          {message}
        </div>
      </div>
    </div>
  );
}

/* Build a nice fallback avatar  */
function dicebearAvatar(name = "WeCast User") {
  const seed = encodeURIComponent(name.trim() || "WeCast User");
  return `https://api.dicebear.com/8.x/adventurer/svg?seed=${seed}`;
}

function normalizeAuthProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw.includes("google")) return "google";
  if (raw.includes("github")) return "github";
  if (raw.includes("password") || raw.includes("email")) return "password";
  return raw;
}

function formatAuthProviderLabel(provider) {
  switch (normalizeAuthProvider(provider)) {
    case "google":
      return "Google";
    case "github":
      return "GitHub";
    case "password":
      return "Email";
    default:
      return "your sign-in provider";
  }
}

const ACCOUNT_ACTION_BUTTON_CLASS =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[11.5rem]";
const ACCOUNT_SECONDARY_BUTTON_CLASS =
  `${ACCOUNT_ACTION_BUTTON_CLASS} border border-black/15 text-black hover:bg-black/5 dark:border-white/15 dark:text-white dark:hover:bg-white/10`;
const ACCOUNT_PRIMARY_BUTTON_CLASS =
  `${ACCOUNT_ACTION_BUTTON_CLASS} bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90`;
const ACCOUNT_DANGER_BUTTON_CLASS =
  `${ACCOUNT_ACTION_BUTTON_CLASS} border border-red-500 bg-red-600 text-white hover:bg-red-700`;
const ACCOUNT_STATUS_PILL_CLASS =
  "inline-flex w-full items-center justify-center rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-sm font-semibold text-black/70 dark:border-white/10 dark:bg-white/5 dark:text-white/70 sm:w-auto sm:min-w-[11.5rem]";

export default function Account() {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState("success");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [sendingResetLink, setSendingResetLink] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [authProvider, setAuthProvider] = useState("unknown");
  
  const [profile, setProfile] = useState({
    displayName: "WeCast User",
    bio: "I create AI-powered podcasts.",
    avatarUrl: "",
    email: "user@example.com",
  });

  const [originalProfile, setOriginalProfile] = useState({});

  // Dark mode state (saved to localStorage)
  const [darkMode, setDarkMode] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_ACCOUNT_PREFERENCES);

  // Local avatar preview
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);

  const fileRef = useRef(null);

  const showToast = (message, type = "success") => {
    setToastMsg(message);
    setToastType(type);
    setTimeout(() => {
      setToastMsg("");
      setToastType("success");
    }, 3000);
  };

  const hasUnsavedChanges = JSON.stringify(profile) !== JSON.stringify(originalProfile) || avatarFile !== null;
  const normalizedAuthProvider = normalizeAuthProvider(authProvider);
  const providerLabel = formatAuthProviderLabel(normalizedAuthProvider);
  const canSendResetLink = normalizedAuthProvider === "password" && Boolean(String(profile.email || "").trim());
  const isProviderManaged = normalizedAuthProvider === "google" || normalizedAuthProvider === "github";

  useEffect(() => {
    // Load Dark Mode from localStorage
    const saved = localStorage.getItem("wecast:dark");
    if (saved !== null) {
      const v = JSON.parse(saved);
      setDarkMode(v);
      applyDarkMode(v);
    }

    setPreferences(loadAccountPreferences());

    loadUserProfile();
  }, []);

  useEffect(() => {
    saveAccountPreferences(preferences);
  }, [preferences]);

  const loadUserProfile = async () => {
    setLoading(true);
    try {
      // First load from localStorage
      const storedUserRaw = localStorage.getItem("user") || sessionStorage.getItem("user");
      if (storedUserRaw) {
        try {
          const u = JSON.parse(storedUserRaw);
          const name = u.displayName || u.name || "WeCast User";
          const storedAuthProvider = normalizeAuthProvider(u.authProvider);
          setProfile((p) => ({
            ...p,
            displayName: name,
            email: u.email || p.email,
            bio: u.bio || p.bio,
            avatarUrl: u.avatarUrl || "",
          }));
          setAuthProvider(storedAuthProvider);
          setOriginalProfile((p) => ({
            ...p,
            displayName: name,
            email: u.email || p.email,
            bio: u.bio || p.bio,
            avatarUrl: u.avatarUrl || "",
          }));
        } catch {
          // ignore parse error
        }
      }

      // Then try to load from API
      const token = localStorage.getItem("token") || sessionStorage.getItem("token");
      if (!token) {
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/api/me`, {
        method: "GET",
        credentials: "include",
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        console.warn("GET /api/me failed with status", res.status);
        setLoading(false);
        return;
      }

      const data = await res.json();
      if (!data || data.error) {
        setLoading(false);
        return;
      }

      const resolvedAuthProvider = normalizeAuthProvider(data.authProvider);

      const userProfile = {
        displayName: data.displayName || data.name || profile.displayName,
        bio: data.bio || profile.bio,
        email: data.email || profile.email,
        avatarUrl: data.avatarUrl || profile.avatarUrl,
      };

      setProfile(userProfile);
      setOriginalProfile(userProfile);
      setAuthProvider(resolvedAuthProvider);
      
      // Update localStorage
      const userToStore = {
        displayName: userProfile.displayName,
        email: userProfile.email,
        bio: userProfile.bio,
        avatarUrl: userProfile.avatarUrl,
        authProvider: resolvedAuthProvider,
      };
      
      if (localStorage.getItem("user")) {
        localStorage.setItem("user", JSON.stringify(userToStore));
      } else if (sessionStorage.getItem("user")) {
        sessionStorage.setItem("user", JSON.stringify(userToStore));
      }
      
    } catch (err) {
      console.error("GET /api/me error:", err);
    } finally {
      setLoading(false);
    }
  };

  const shownAvatar = avatarPreview || profile.avatarUrl || dicebearAvatar(profile.displayName);

  function onPickAvatar() {
    fileRef.current?.click();
  }

  function onAvatarFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      showToast("Please select an image file", "error");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast("Image size should be less than 5MB", "error");
      return;
    }

    setAvatarFile(file);
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);
  }

  function toggleDark(v) {
    setDarkMode(v);
    applyDarkMode(v);
  }

  function resetProfileChanges() {
    setProfile(originalProfile);
    setAvatarFile(null);
    setAvatarPreview(null);
    if (fileRef.current) fileRef.current.value = "";
    showToast("Profile changes discarded", "info");
  }

  function resetAppearance() {
    const defaults = { ...DEFAULT_ACCOUNT_PREFERENCES };
    setPreferences(defaults);
    setDarkMode(false);
    applyDarkMode(false);
    showToast("Appearance settings reset", "info");
  }

  async function save() {
    if (!hasUnsavedChanges) {
      showToast("No changes to save", "info");
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem("token") || sessionStorage.getItem("token");
      
      // If not authenticated, save to localStorage only
      if (!token) {
        const userToStore = {
          displayName: profile.displayName,
          email: profile.email,
          bio: profile.bio,
          avatarUrl: profile.avatarUrl,
          authProvider: normalizedAuthProvider,
        };
        
        localStorage.setItem("user", JSON.stringify(userToStore));
        
        setOriginalProfile(profile);
        setAvatarFile(null);
        setAvatarPreview(null);
        
        showToast("Profile saved locally!", "success");
        setSaving(false);
        return;
      }

      // Prepare FormData for API call
      const formData = new FormData();
      formData.append('displayName', profile.displayName);
      formData.append('bio', profile.bio);
      
      if (avatarFile) {
        formData.append('avatar', avatarFile);
      }

      const res = await fetch(`${API_BASE}/api/profile/update`, {
        method: "POST",
        credentials: "include",
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update profile");
      }

      const data = await res.json();

      // Update localStorage
      const userToStore = {
        displayName: profile.displayName,
        email: profile.email,
        bio: profile.bio,
        avatarUrl: data.avatarUrl || profile.avatarUrl,
        authProvider: normalizedAuthProvider,
      };
      
      if (localStorage.getItem("user")) {
        localStorage.setItem("user", JSON.stringify(userToStore));
      } else if (sessionStorage.getItem("user")) {
        sessionStorage.setItem("user", JSON.stringify(userToStore));
      }

      setOriginalProfile(profile);
      
      if (data.avatarUrl) {
        setProfile(prev => ({ ...prev, avatarUrl: data.avatarUrl }));
        setOriginalProfile(prev => ({ ...prev, avatarUrl: data.avatarUrl }));
      }
      
      setAvatarFile(null);
      setAvatarPreview(null);

      showToast("Profile updated successfully!", "success");
      
    } catch (error) {
      console.error("Save error:", error);
      
      // Fallback to localStorage
      const userToStore = {
        displayName: profile.displayName,
        email: profile.email,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        authProvider: normalizedAuthProvider,
      };
      
      localStorage.setItem("user", JSON.stringify(userToStore));
      setOriginalProfile(profile);
      
      showToast(error.message || "Saved locally (server unavailable)", "warning");
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");

    sessionStorage.setItem(
      "wecast:flash",
      "You have been logged out successfully."
    );

    window.dispatchEvent(
      new StorageEvent("storage", { key: "token", newValue: "" })
    );

    window.location.hash = "#/";
  }

  function openResetPasswordModal() {
    if (!canSendResetLink) return;
    setShowResetPasswordModal(true);
  }

  function closeResetPasswordModal() {
    if (sendingResetLink) return;
    setShowResetPasswordModal(false);
  }

  async function handleSendResetLink() {
    const email = String(profile.email || "").trim().toLowerCase();
    if (!email) {
      showToast(t("account.passwordInvalidEmail"), "error");
      return;
    }

    setSendingResetLink(true);
    try {
      const res = await fetch(`${API_BASE}/api/account/password-reset-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw {
          code: data?.code || "",
          message: data?.error || t("account.passwordSendFailed"),
        };
      }

      setShowResetPasswordModal(false);
      showToast(t("account.passwordSent", { email: data?.email || email }), "success");
    } catch (error) {
      const code = error?.code || "";
      let message = error?.message || t("account.passwordSendFailed");

      if (code === "auth/too-many-requests") {
        message = t("account.passwordTooManyRequests");
      } else if (code === "auth/invalid-email") {
        message = t("account.passwordInvalidEmail");
      }

      showToast(message, code === "auth/too-many-requests" ? "warning" : "error");
    } finally {
      setSendingResetLink(false);
    }
  }

  function openDeleteModal() {
    setDeleteConfirmation("");
    setShowDeleteModal(true);
  }

  function closeDeleteModal() {
    if (deletingAccount) return;
    setDeleteConfirmation("");
    setShowDeleteModal(false);
  }

  async function handleDeleteAccount() {
    if (deleteConfirmation !== "DELETE") {
      showToast('Type DELETE to confirm account removal.', "warning");
      return;
    }

    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    if (!token) {
      showToast("You need to be signed in to delete your account.", "error");
      return;
    }

    setDeletingAccount(true);
    try {
      const res = await fetch(`${API_BASE}/api/account`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete account");
      }

      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("wecast:dark");
      localStorage.removeItem("wecast-lang");
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("user");

      window.dispatchEvent(
        new StorageEvent("storage", { key: "token", newValue: "" })
      );

      sessionStorage.setItem(
        "wecast:flash",
        "Your account has been deleted successfully."
      );

      setShowDeleteModal(false);
      window.location.hash = "#/";
    } catch (error) {
      console.error("Delete account error:", error);
      showToast(error.message || "Failed to delete account", "error");
    } finally {
      setDeletingAccount(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6 flex justify-center items-center min-h-[400px]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 sm:p-6 sm:space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-extrabold sm:text-4xl">{t("account.title")}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
           {t("account.subtitle")}
        </p>
        {hasUnsavedChanges && (
          <p className="text-sm text-yellow-600 dark:text-yellow-400 flex items-center gap-1 mt-2">
            <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
            You have unsaved changes
          </p>
        )}
      </header>

      {/* PROFILE */}
      <Card
        title={t("account.profile")}
        subtitle="Update your public identity, avatar, and bio in one place."
        icon={<Save className="w-5 h-5" />}
      >
        <div className="flex flex-col gap-6">
          {/* Avatar + name row */}
          <div className="flex flex-col md:flex-row items-start gap-6">
            <div className="relative shrink-0">
              <img
                src={shownAvatar}
                alt="Avatar"
                className="w-28 h-28 rounded-[24px] object-cover border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm"
              />
              <button
                onClick={onPickAvatar}
                className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-xs px-3 py-1.5 rounded-full
                  bg-black text-white dark:bg-white dark:text-black border
                  border-black dark:border-white shadow-md"
              >
                Change
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onAvatarFile}
              />
            </div>

            <div className="flex-1 grid md:grid-cols-2 gap-4 items-start">
              <div className="md:col-span-2 rounded-2xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                  Profile snapshot
                </p>
                <p className="mt-2 text-lg font-semibold text-black dark:text-white">
                  {profile.displayName || "WeCast User"}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {profile.email || "No email available"}
                </p>
              </div>

              <Field
                label={t("account.username")}
                hint={t("account.usernameHint")}
              >
                <input
                  className="form-input"
                  placeholder="Enter your name"
                  value={profile.displayName}
                  onChange={(e) =>
                    setProfile({ ...profile, displayName: e.target.value })
                  }
                />
              </Field>

              {profile.email && (
                <Field label={t("account.email")}>
                  <input
                    className="form-input bg-neutral-100 dark:bg-neutral-800"
                    value={profile.email}
                    readOnly
                  />
                </Field>
              )}
            </div>
          </div>

          {/* Bio */}
          <Field
            label={t("account.bio")}
            hint={t("account.bioHint")}
          >
            <textarea
              className="form-textarea"
              placeholder="Tell the world what you make…"
              value={profile.bio}
              onChange={(e) =>
                setProfile({ ...profile, bio: e.target.value })
              }
              rows="3"
            />
          </Field>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
            <button
              type="button"
              onClick={resetProfileChanges}
              disabled={!hasUnsavedChanges || saving}
              className={`${ACCOUNT_SECONDARY_BUTTON_CLASS} ${
                hasUnsavedChanges && !saving
                  ? ""
                  : "border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-500"
              }`}
            >
              <RefreshCcw className="w-4 h-4" />
              Reset
            </button>
            <button
              onClick={save}
              disabled={saving || !hasUnsavedChanges}
              className={`${ACCOUNT_PRIMARY_BUTTON_CLASS} ${
                hasUnsavedChanges
                  ? ""
                  : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
              }`}
            >
              {saving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  {t("account.saving")}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {t("account.save")}
                </>
              )}
            </button>
          </div>
        </div>
      </Card>

      {/* APPEARANCE */}
      <Card
        title={t("account.appearance")}
        subtitle="Device-level preferences for how WeCast feels while you work."
        icon={<Palette className="w-5 h-5" />}
      >
        <div className="space-y-5">
          <PreferenceRow
            icon={<Palette className="w-4 h-4" />}
            title={t("account.darkMode")}
            hint={t("account.darkModeHint")}
            control={<Toggle checked={darkMode} onChange={toggleDark} />}
          />
          <PreferenceRow
            icon={<PlayCircle className="w-4 h-4" />}
            title="Auto-play voice previews"
            hint="Keep preview playback immediate when you test voices and clips on this device."
            control={
              <Toggle
                checked={preferences.autoplayPreview}
                onChange={(value) =>
                  setPreferences((prev) => ({ ...prev, autoplayPreview: value }))
                }
              />
            }
          />
          <PreferenceRow
            icon={<Bell className="w-4 h-4" />}
            title="Editing notifications"
            hint="Show or hide non-critical success notices while editing. Errors and warnings still appear."
            control={
              <Toggle
                checked={preferences.editingNotifications}
                onChange={(value) =>
                  setPreferences((prev) => ({ ...prev, editingNotifications: value }))
                }
              />
            }
          />
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={resetAppearance}
              className={ACCOUNT_SECONDARY_BUTTON_CLASS}
            >
              <RefreshCcw className="h-4 w-4" />
              Reset Appearance
            </button>
          </div>
        </div>
      </Card>

      {/* ACTIONS */}
      <Card
        title={t("account.actions")}
        subtitle={t("account.actionsSubtitle")}
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-black/10 bg-white/75 px-5 py-5 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-black dark:text-white">{t("account.securityTitle")}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {canSendResetLink
                    ? t("account.passwordHint")
                    : isProviderManaged
                      ? t("account.passwordProviderHint", { provider: providerLabel })
                      : t("account.passwordUnavailableHint")}
                </p>
              </div>
              {canSendResetLink ? (
                <button
                  type="button"
                  onClick={openResetPasswordModal}
                  disabled={sendingResetLink}
                  className={ACCOUNT_SECONDARY_BUTTON_CLASS}
                >
                  {sendingResetLink ? (
                    <>
                      <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin"></span>
                      {t("account.passwordSending")}
                    </>
                  ) : (
                    t("account.passwordButton")
                  )}
                </button>
              ) : (
                <span className={ACCOUNT_STATUS_PILL_CLASS}>
                  {isProviderManaged
                    ? t("account.passwordProviderManaged", { provider: providerLabel })
                    : t("account.passwordUnavailable")}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="group flex w-full items-center gap-3 rounded-2xl border border-black/10 bg-white/75 px-5 py-4 text-left transition hover:border-black/15 hover:bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/10 bg-black/[0.04] text-black transition group-hover:bg-black group-hover:text-white dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:group-hover:bg-white dark:group-hover:text-black">
              <LogOut className="h-4 w-4" />
            </span>
            <span className="text-base font-semibold text-black dark:text-white">
              {t("account.logout")}
            </span>
          </button>

          <div className="rounded-2xl border border-red-200/80 bg-red-50/80 px-5 py-5 dark:border-red-500/20 dark:bg-red-950/20">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-red-700 dark:text-red-300">Delete account</p>
                <p className="text-sm text-red-600/90 dark:text-red-200/80">
                  Permanently delete your account and all episodes created with it.
                </p>
              </div>
              <button
                type="button"
                onClick={openDeleteModal}
                disabled={deletingAccount}
                className={ACCOUNT_DANGER_BUTTON_CLASS}
              >
                <Trash2 className="h-4 w-4" />
                Delete Account
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Toast notification */}
      <Toast message={toastMsg} type={toastType} />
      <PasswordResetModal
        open={showResetPasswordModal}
        sending={sendingResetLink}
        onCancel={closeResetPasswordModal}
        onConfirm={handleSendResetLink}
        title={t("account.passwordModalTitle")}
        body={t("account.passwordModalBody", { email: profile.email })}
        note={t("account.passwordModalNote")}
        cancelLabel={t("account.passwordModalCancel")}
        confirmLabel={t("account.passwordModalConfirm")}
        sendingLabel={t("account.passwordSending")}
      />
      <DeleteAccountModal
        open={showDeleteModal}
        confirmationText={deleteConfirmation}
        deleting={deletingAccount}
        onConfirmationChange={setDeleteConfirmation}
        onCancel={closeDeleteModal}
        onConfirm={handleDeleteAccount}
      />
    </div>
  );
}

/* ---------- UI helpers ---------- */
function Card({ title, subtitle, icon, children }) {
  return (
    <div className="ui-card">
      {(title || subtitle) && (
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            {title && (
              <div className="flex items-center gap-2">
                {icon ? <span className="text-black/70 dark:text-white/70">{icon}</span> : null}
                <h2 className="ui-card-title !mb-0">{title}</h2>
              </div>
            )}
            {subtitle ? (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{subtitle}</p>
            ) : null}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

function PasswordResetModal({
  open,
  sending,
  onCancel,
  onConfirm,
  title,
  body,
  note,
  cancelLabel,
  confirmLabel,
  sendingLabel,
}) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-black/10 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-neutral-950">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-200">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-black dark:text-white">{title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">{body}</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">{note}</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={sending}
              className="inline-flex items-center justify-center rounded-xl border border-black/15 px-5 py-3 text-sm font-semibold text-black transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={sending}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              {sending ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin"></span>
                  {sendingLabel}
                </>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DeleteAccountModal({
  open,
  confirmationText,
  deleting,
  onConfirmationChange,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-red-200 bg-white p-6 shadow-2xl dark:border-red-500/20 dark:bg-neutral-950">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-black dark:text-white">Delete account?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              This action permanently deletes your account and all episodes tied to it.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Type <span className="font-semibold text-black dark:text-white">DELETE</span> to confirm.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <input
            className="form-input"
            value={confirmationText}
            onChange={(e) => onConfirmationChange(e.target.value)}
            placeholder="Type DELETE"
            autoFocus
          />

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="inline-flex items-center justify-center rounded-xl border border-black/15 px-5 py-3 text-sm font-semibold text-black transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={deleting || confirmationText !== "DELETE"}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete Account
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Field({ label, hint, children, full }) {
  return (
    <label className={`flex flex-col gap-2 ${full ? "md:col-span-2" : ""}`}>
      {label && <span className="form-label">{label}</span>}
      {children}
      {hint && <span className="form-help">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-14 h-7 rounded-full flex items-center px-1 transition ${
        checked
          ? "bg-black dark:bg-white justify-end"
          : "bg-gray-300 justify-start"
      }`}
      title="Toggle dark mode"
    >
      <span className="w-5 h-5 rounded-full bg-white dark:bg-black shadow transition" />
    </button>
  );
}

function PreferenceRow({ icon, title, hint, control }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-white/5 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-black text-white dark:bg-white dark:text-black">
          {icon}
        </div>
        <div>
          <p className="font-semibold text-black dark:text-white">{title}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">{hint}</p>
        </div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

