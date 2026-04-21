// src/components/Login.jsx
import React, { useEffect, useState } from "react";
import { Eye, EyeOff, Mail, Lock, ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  auth,
  googleProvider,
  githubProvider,
  actionCodeSettings,
  ensureFirebaseClientReady,
} from "../firebaseClient";
import { API_BASE } from "../utils/api";
import {
  authenticateWithSocialProvider,
  completePendingSocialRedirect,
} from "../utils/socialAuth";
import {
  clearAuthRedirectIntent,
  getAuthRedirectIntent,
  readHashRedirectParams,
  storeAuthRedirectIntent,
} from "../utils/authRedirect";
import {
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

const REMEMBERED_LOGIN_KEY = "rememberedLoginIdentifier";

function redirectAfterAuth() {
  const { redirect, id, from } = getAuthRedirectIntent();
  clearAuthRedirectIntent();
  if (redirect === "edit") {
    window.location.hash = "#/edit";
  } else if (redirect === "create") {
    window.location.hash = "#/create";
  } else if (redirect === "preview") {
    const fromSuffix = from ? `&from=${encodeURIComponent(from)}` : "";
    window.location.hash = id ? `#/preview?id=${id}${fromSuffix}` : `#/preview${from ? `?from=${encodeURIComponent(from)}` : ""}`;
  } else {
    window.location.hash = "#/";
  }
}

function looksLikeEmail(value) {
  return /\S+@\S+\.\S+/.test(String(value || "").trim());
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function buildPasswordResetSuccessMessage(email) {
  return `If an account exists for ${email}, a password reset link is on the way. Check your inbox and spam folder next.`;
}

function mapLoginError(error) {
  const code = error?.code || "";

  if (code === "auth/invalid-email") {
    return "Enter a valid email address and try again.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Email/password login is disabled in Firebase Authentication. Enable it in Firebase Auth > Sign-in method.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This app URL is not authorized in Firebase Authentication yet. Add this domain in Firebase Auth > Settings > Authorized domains.";
  }
  if (code === "auth/app-not-authorized" || code === "auth/invalid-api-key") {
    return "Firebase Authentication is not configured correctly for this web app yet. Check the Firebase web app settings and env vars.";
  }
  if (code === "auth/network-request-failed") {
    return "We couldn't reach Firebase right now. Check your connection and try again.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many sign-in attempts were made in a short time. Wait a moment, then try again.";
  }
  if (code === "auth/user-disabled") {
    return "This Firebase account is disabled. Re-enable it in Firebase Authentication before signing in.";
  }
  if (
    code === "auth/wrong-password" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-credential"
  ) {
    return "Invalid email or password.";
  }

  if (error?.message) {
    return error.message;
  }

  return "Failed to connect to the server. Please try again.";
}

function mapVerificationResendError(error) {
  const code = error?.code || "";

  if (
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password"
  ) {
    return "We couldn't resend the verification email. Check your email and password, then try again.";
  }
  if (code === "auth/too-many-requests") {
    return "We sent too many verification emails recently. Wait a moment, then try again.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Email/password sign-in is disabled in Firebase Authentication. Enable it before resending verification emails.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This app URL is not authorized for Firebase email actions yet. Add this domain in Firebase Auth > Settings > Authorized domains.";
  }
  if (code === "auth/app-not-authorized" || code === "auth/invalid-api-key") {
    return "Firebase Authentication is not configured correctly for this web app yet. Check the Firebase web app settings and env vars.";
  }
  if (code === "auth/network-request-failed") {
    return "We couldn't reach Firebase right now. Check your connection and try again.";
  }

  return "We couldn't resend the verification email right now. Please try again.";
}

export default function Login() {
  const [mode, setMode] = useState("login"); // "login" | "reset"
  const [identifier, setIdentifier] = useState("");
  const [pwd, setPwd] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetRequestComplete, setResetRequestComplete] = useState(false);
  const [resetSubmittedEmail, setResetSubmittedEmail] = useState("");

  const [showPwd, setShowPwd] = useState(false);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");

  useEffect(() => {
    storeAuthRedirectIntent(readHashRedirectParams());
  }, []);

  useEffect(() => {
    const rememberedLogin = localStorage.getItem(REMEMBERED_LOGIN_KEY);
    if (rememberedLogin) {
      setIdentifier(rememberedLogin);
      setRememberMe(true);
    }

    const pendingEmail = sessionStorage.getItem("wecast:pendingVerificationEmail");
    if (pendingEmail) {
      setIdentifier(pendingEmail);
      setPendingVerificationEmail(pendingEmail);
      setInfo("Verify your email first, then log in to finish setting up your account.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const finishRedirectLogin = async () => {
      try {
        setLoading(true);
        const completed = await completePendingSocialRedirect({
          auth,
          remember: localStorage.getItem(REMEMBERED_LOGIN_KEY) !== null,
        });
        if (!cancelled && completed) {
          redirectAfterAuth();
        }
      } catch (err) {
        if (!cancelled) {
          console.error("SOCIAL REDIRECT LOGIN ERROR:", err);
          setError(err.message || "Social login failed. Please try again.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    finishRedirectLogin();

    return () => {
      cancelled = true;
    };
  }, []);

  const switchToLogin = () => {
    setMode("login");
    setError("");
    setInfo("");
    setPendingVerificationEmail("");
    setResetRequestComplete(false);
    setResetSubmittedEmail("");
  };

  const switchToReset = () => {
    setMode("reset");
    setError("");
    setInfo("");
    setPendingVerificationEmail("");
    setResetRequestComplete(false);
    setResetSubmittedEmail("");
    // Only prefill when the login field actually contains an email address.
    if (looksLikeEmail(identifier) && !resetEmail) {
      setResetEmail(identifier.trim());
    } else if (!looksLikeEmail(identifier)) {
      setResetEmail("");
    }
  };

  // ------------------ LOGIN SUBMIT ------------------
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setPendingVerificationEmail("");

    if (!identifier.trim() || !pwd.trim()) {
      setError("Please enter both email/username and password.");
      return;
    }

    setLoading(true);

    try {
      const trimmedIdentifier = identifier.trim();
      const normalizedIdentifier = looksLikeEmail(trimmedIdentifier)
        ? normalizeEmail(trimmedIdentifier)
        : trimmedIdentifier;

      if (identifier.includes("@")) {
        try {
          ensureFirebaseClientReady();
          const credential = await signInWithEmailAndPassword(
            auth,
            normalizedIdentifier,
            pwd
          );
          const firebaseUser = credential.user;

          if (!firebaseUser.emailVerified) {
            await signOut(auth);
            sessionStorage.setItem(
              "wecast:pendingVerificationEmail",
              normalizedIdentifier
            );
            setPendingVerificationEmail(normalizedIdentifier);
            setInfo("Your account is almost ready. Verify your email first, then log in.");
            setLoading(false);
            return;
          }

          sessionStorage.removeItem("wecast:pendingVerificationEmail");

          const idToken = await firebaseUser.getIdToken(true);
          const firebaseRes = await fetch(`${API_BASE}/api/firebase-email-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ idToken }),
          });

          let firebaseData = {};
          try {
            firebaseData = await firebaseRes.json();
          } catch {
            firebaseData = {};
          }

          if (!firebaseRes.ok) {
            throw new Error(firebaseData.error || "Login failed.");
          }

          if (firebaseData.token) {
            if (rememberMe) {
              localStorage.setItem("token", firebaseData.token);
              sessionStorage.removeItem("token");
            } else {
              sessionStorage.setItem("token", firebaseData.token);
              localStorage.removeItem("token");
            }
          }

          if (rememberMe) {
            localStorage.setItem(REMEMBERED_LOGIN_KEY, normalizedIdentifier);
          } else {
            localStorage.removeItem(REMEMBERED_LOGIN_KEY);
          }

          if (firebaseData.user) {
            const userJson = JSON.stringify(firebaseData.user);
            if (rememberMe) {
              localStorage.setItem("user", userJson);
              sessionStorage.removeItem("user");
            } else {
              sessionStorage.setItem("user", userJson);
              localStorage.removeItem("user");
            }
          }

          window.dispatchEvent(
            new StorageEvent("storage", { key: "token", newValue: firebaseData.token || "" })
          );

          redirectAfterAuth();
          return;
        } catch (firebaseError) {
          const code = firebaseError?.code || "";
          const shouldFallback =
            code === "auth/user-not-found" ||
            code === "auth/invalid-credential" ||
            code === "auth/invalid-email";

          if (!shouldFallback) {
            throw firebaseError;
          }
        }
      }

      const res = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          identifier: normalizedIdentifier,
          email: normalizedIdentifier,
          password: pwd,
        }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (!res.ok) {
        // account locked case (from backend)
        if (data.locked) {
          const mins = data.lockMinutes ?? 15;
          setError(
            data.error ||
            `Too many failed attempts. Your account is temporarily locked for ${mins} minutes.`
          );
          setLoading(false);
          return;
        }

        // remaining attempts
        if (typeof data.remainingAttempts === "number") {
          setError(
            data.error ||
            `Invalid email or password. You have ${data.remainingAttempts} attempts left.`
          );
          setLoading(false);
          return;
        }

        setError(data.error || "Invalid email or password.");
        setLoading(false);
        return;
      }

      if (data.token) {
        if (rememberMe) {
          // Keep user logged in across browser restarts
          localStorage.setItem("token", data.token);
        } else {
          // Only until the tab or browser is closed
          sessionStorage.setItem("token", data.token);
        }
      }

      if (rememberMe) {
        localStorage.setItem(REMEMBERED_LOGIN_KEY, normalizedIdentifier);
      } else {
        localStorage.removeItem(REMEMBERED_LOGIN_KEY);
      }

      if (data.user) {
        const userJson = JSON.stringify(data.user);
        if (rememberMe) {
          localStorage.setItem("user", userJson);
          sessionStorage.removeItem("user");
        } else {
          sessionStorage.setItem("user", userJson);
          localStorage.removeItem("user");
        }
      }

      window.dispatchEvent(
        new StorageEvent("storage", { key: "token", newValue: data.token || "" })
      );

      redirectAfterAuth();
    } catch (err) {
      console.error("LOGIN NETWORK ERROR:", err);
      setError(mapLoginError(err));
    } finally {
      setLoading(false);
    }
  };

// ------------------ RESET PASSWORD SUBMIT ------------------
  const handleResetSubmitLegacy = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (resetRequestComplete) {
      return;
    }

    if (!resetEmail.trim()) {
      setError("Enter the email address linked to your account.");
      return;
    }

    setLoading(true);

    try {
      const email = normalizeEmail(resetEmail);
      if (!looksLikeEmail(email)) {
        setError("Enter a valid email address to continue.");
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/api/password-reset-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw {
          code: data?.code || "",
          message: data?.error || "We couldn't send the reset email right now. Please try again.",
        };
      }

      setResetEmail(email);
      setResetSubmittedEmail(email);
      setResetRequestComplete(true);
      return;
/*

      try {
        await sendPasswordResetEmail(auth, email, actionCodeSettings);
      } catch (firebaseError) {
        const code = firebaseError?.code || "";

        if (code === "auth/invalid-email") {
          throw firebaseError;
        }

        const res = await fetch(`${API_BASE}/api/password-reset-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw {
            code: data?.code || code,
            message: data?.error || firebaseError?.message || "We couldn’t send the reset email right now. Please try again.",
          };
        }
      }

      setInfo("Check your email for a password reset link. If it doesn’t appear, check your spam folder.");
*/
    } catch (err) {
      console.error("RESET PASSWORD ERROR:", err);
      const code = err?.code || "";
      if (code === "auth/invalid-email") {
        setError("Enter a valid email address to continue.");
      } else if (code === "auth/operation-not-allowed") {
        setError("Password reset is unavailable right now. Please try again a little later.");
      } else if (code === "auth/unauthorized-domain") {
        setError("Password reset isn’t available on this domain yet. Please try again from the main WeCast app.");
      } else {
        setError(err?.message || "We couldn’t send the reset email right now. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (resetRequestComplete) {
      return;
    }

    if (!resetEmail.trim()) {
      setError("Enter the email address linked to your account.");
      return;
    }

    setLoading(true);

    try {
      const email = normalizeEmail(resetEmail);
      if (!looksLikeEmail(email)) {
        setError("Enter a valid email address to continue.");
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/api/password-reset-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw {
          code: data?.code || "",
          message:
            data?.error ||
            "We couldn't send the reset email right now. Please try again.",
        };
      }

      setResetEmail(email);
      setResetSubmittedEmail(email);
      setResetRequestComplete(true);
    } catch (err) {
      console.error("RESET PASSWORD ERROR:", err);
      const code = err?.code || "";
      if (code === "auth/invalid-email") {
        setError("Enter a valid email address to continue.");
      } else if (code === "auth/operation-not-allowed") {
        setError(
          "Password reset is unavailable right now. Please try again a little later."
        );
      } else if (code === "auth/unauthorized-domain") {
        setError(
          "Password reset isn't available on this domain yet. Please try again from the main WeCast app."
        );
      } else {
        setError(
          err?.message ||
            "We couldn't send the reset email right now. Please try again."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // ------------------ SOCIAL LOGINS ------------------
  const handleGoogleLogin = async () => {
    setError("");
    setInfo("");
    setLoading(true);

    try {
      const result = await authenticateWithSocialProvider({
        auth,
        provider: googleProvider,
        providerLabel: "Google",
        remember: rememberMe,
      });
      if (result.redirected) {
        setInfo("Redirecting to Google sign-in...");
        return;
      }
      redirectAfterAuth();
    } catch (err) {
      console.error("GOOGLE LOGIN ERROR:", err);
      setError(err.message || "Google login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerificationLegacy = async () => {
    setError("");
    setInfo("");

    if (!identifier.trim() || !pwd.trim()) {
      setError("Enter your email and password to resend the verification email.");
      return;
    }

    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, identifier.trim(), pwd);
      const firebaseUser = credential.user;

      if (firebaseUser.emailVerified) {
        await signOut(auth);
        sessionStorage.removeItem("wecast:pendingVerificationEmail");
        setPendingVerificationEmail("");
        setInfo("Your email is already verified. You can log in now.");
        return;
      }

      await sendEmailVerification(firebaseUser, actionCodeSettings);
      await signOut(auth);

      sessionStorage.setItem("wecast:pendingVerificationEmail", identifier.trim());
      setPendingVerificationEmail(identifier.trim());
      setInfo("A new verification email has been sent. Check your inbox and spam folder.");
    } catch (err) {
      const code = err?.code || "";
      if (
        code === "auth/invalid-credential" ||
        code === "auth/user-not-found" ||
        code === "auth/wrong-password"
      ) {
        setError("We couldn’t resend the verification email. Check your email and password, then try again.");
      } else {
        setError("We couldn’t resend the verification email right now. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setError("");
    setInfo("");

    if (!identifier.trim() || !pwd.trim()) {
      setError("Enter your email and password to resend the verification email.");
      return;
    }

    setLoading(true);
    try {
      ensureFirebaseClientReady();
      const email = normalizeEmail(identifier);
      const credential = await signInWithEmailAndPassword(auth, email, pwd);
      const firebaseUser = credential.user;

      if (firebaseUser.emailVerified) {
        await signOut(auth);
        sessionStorage.removeItem("wecast:pendingVerificationEmail");
        setPendingVerificationEmail("");
        setInfo("Your email is already verified. You can log in now.");
        return;
      }

      await sendEmailVerification(firebaseUser, actionCodeSettings);
      await signOut(auth);

      sessionStorage.setItem("wecast:pendingVerificationEmail", email);
      setPendingVerificationEmail(email);
      setInfo(
        "A new verification email has been sent. Check your inbox and spam folder."
      );
    } catch (err) {
      setError(mapVerificationResendError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGithubLogin = async () => {
    setError("");
    setInfo("");
    setLoading(true);

    try {
      const result = await authenticateWithSocialProvider({
        auth,
        provider: githubProvider,
        providerLabel: "GitHub",
        remember: rememberMe,
      });
      if (result.redirected) {
        setInfo("Redirecting to GitHub sign-in...");
        return;
      }
      redirectAfterAuth();
    } catch (err) {
      console.error("GITHUB LOGIN ERROR:", err);
      setError(err.message || "GitHub login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Kept as no-op references while the migrated handlers settle in.
  void handleResetSubmitLegacy;
  void handleResendVerificationLegacy;

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center bg-cream dark:bg-[#0a0a1a] transition-colors px-4 pb-12 pt-6 sm:px-6 md:pb-28">
      {/* RIGHT animated shapes */}
      <div className="pointer-events-none absolute right-[-24px] top-24 w-72 h-72 rounded-full blur-3xl opacity-40 bg-pink-400/70 dark:bg-pink-300/20 animate-pulse" />
      <div className="pointer-events-none absolute right-24 bottom-20 w-40 h-40 rounded-2xl blur-xl opacity-40 bg-blue-400/70 dark:bg-blue-300/20 animate-bounce" />

      {/* LEFT background image */}
      <div
        aria-hidden
        className="hidden md:block absolute left-[-6vw] lg:left-[-9vw] top-1/2 -translate-y-1/2 w-[68vw] max-w-[620px] h-[70vh] max-h-[560px] opacity-90 rotate-[-2deg] z-0"
        style={{
          backgroundImage: "url('/img3.png')",
          backgroundRepeat: "no-repeat",
          backgroundSize: "contain",
          backgroundPosition: "left center",
          filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.15))",
        }}
      />

      {/* LOGIN / RESET CARD */}
      <div className="relative z-10 w-full max-w-md">
        <div
          className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 shadow-sm transition-colors sm:p-8"
        >



          {/* Top back button only in reset mode */}
          {mode === "reset" && (
            <button
              type="button"
              onClick={switchToLogin}
              className="mb-4 inline-flex items-center text-sm text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to login
            </button>
          )}

          {/* Heading */}
          <div className={mode === "reset" && resetRequestComplete ? "hidden" : "mb-6 text-center"}>
            {mode === "login" ? (
              <>
                <h2 className="text-2xl font-extrabold tracking-tight text-black dark:text-white sm:text-[2rem]">
                  Log in to{" "}
                  <span className="text-purple-700 dark:text-purple-300">
                    WeCast
                  </span>
                </h2>
                <p className="mt-1 text-sm leading-6 text-black/60 dark:text-white/60">
                  Welcome back. Sign in to access your podcasts and drafts.
                </p>
                <p className="hidden text-sm text-black/60 dark:text-white/60 mt-1">
                  Enter the email you use for WeCast. If it matches an account, we’ll send a reset link.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-extrabold tracking-tight text-black dark:text-white sm:text-[2rem]">
                  Reset your password
                </h2>
                <p className="text-sm text-black/60 dark:text-white/60 mt-1">
                  Enter the email you use for WeCast. If it matches an account, we’ll send a reset link.
                </p>
                <p className="hidden text-sm text-black/60 dark:text-white/60 mt-1">
                  Enter your account email and we’ll send you a secure password reset link.
                </p>
              </>
            )}
          </div>

          {/* Messages */}
          {error && (
            <p className="mb-3 text-sm font-medium text-red-500 text-center">
              {error}
            </p>
          )}
          {info && (
            <p className="mb-3 text-sm font-medium text-emerald-500 text-center">
              {info}
            </p>
          )}
          {mode === "login" && pendingVerificationEmail && (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-center dark:border-amber-500/20 dark:bg-amber-500/10">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Verification pending for <span className="font-semibold">{pendingVerificationEmail}</span>
              </p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-100/80">
                Didn’t get the email? Enter your password and resend the verification link.
              </p>
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={loading}
                className="mt-3 inline-flex items-center justify-center rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-400/20 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-500/10"
              >
                Resend verification email
              </button>
            </div>
          )}

          {/* ------------------ LOGIN FORM ------------------ */}
          {mode === "login" && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email / Username */}
              <div className={resetRequestComplete ? "hidden" : ""}>
                <label className="block text-sm font-medium text-black dark:text-white mb-2">
                  Email or username
                </label>
                <div className="flex items-center border rounded-lg bg-white dark:bg-white/5 border-black/10 dark:border-white/15 focus-within:ring-2 focus-within:ring-purple-500">
                  <span className="pl-3 text-black/60 dark:text-white/60">
                    <Mail className="w-5 h-5" />
                  </span>
                  <input
                    type="text"
                    className="w-full px-3 py-3 rounded-lg outline-none bg-transparent text-black dark:text-white placeholder-black/50 dark:placeholder-white/50"
                    placeholder="you@example.com or your username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password */}
              <div className={resetRequestComplete ? "hidden" : ""}>
                <label className="form-label">Password</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 dark:text-neutral-400">
                    <Lock className="w-5 h-5" />
                  </span>
                  <input
                    type={showPwd ? "text" : "password"}
                    className="form-input pl-10 pr-10"
                    placeholder="Your password"
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white transition"
                    aria-label={showPwd ? "Hide password" : "Show password"}
                  >
                    {showPwd ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>


              {/* Remember + Forgot */}
              <div className="flex items-center justify-between text-sm">
                <label className="inline-flex items-center gap-2 select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-purple-600"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span className="text-black/80 dark:text-white/80">
                    Remember me
                  </span>
                </label>
                <button
                  type="button"
                  onClick={switchToReset}
                  className="text-purple-700 dark:text-purple-300 hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="w-full btn-primary"
                disabled={loading}
              >
                {loading ? "Logging in..." : "Log in"}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                <span className="text-xs text-black/50 dark:text-white/50">
                  or continue with
                </span>
                <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
              </div>

              {/* Social login */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full inline-flex h-11 items-center justify-center gap-3 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-black transition-colors duration-200 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black/10 dark:border-white/15 dark:bg-neutral-900/80 dark:text-white dark:hover:bg-white/10 dark:focus-visible:ring-white/20"
                >
                  {/* Google icon */}
                  <svg
                    viewBox="0 0 48 48"
                    className="w-5 h-5"
                    aria-hidden="true"
                  >
                    <path
                      fill="#FFC107"
                      d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12S17.373 12 24 12c3.059 0 5.84 1.154 7.957 3.043l5.657-5.657C34.842 6.053 29.704 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.345-.138-2.655-.389-3.917z"
                    />
                    <path
                      fill="#FF3D00"
                      d="M6.306 14.691l6.571 4.814C14.4 16.042 18.844 12 24 12c3.059 0 5.84 1.154 7.957 3.043l5.657-5.657C34.842 6.053 29.704 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
                    />
                    <path
                      fill="#4CAF50"
                      d="M24 44c5.164 0 9.86-1.977 13.39-5.205l-6.177-5.219C29.154 35.846 26.727 36.8 24 36.8c-5.192 0-9.602-3.317-11.242-7.943l-6.54 5.038C9.58 39.63 16.261 44 24 44z"
                    />
                    <path
                      fill="#1976D2"
                      d="M43.611 20.083H42V20H24v8h11.303c-.791 2.233-2.273 4.134-4.09 5.556l6.177 5.219C39.708 35.911 44 30.455 44 24c0-1.345-.138-2.655-.389-3.917z"
                    />
                  </svg>
                  Continue with Google
                </button>

                <button
                  type="button"
                  onClick={handleGithubLogin}
                  disabled={loading}
                  className="w-full inline-flex h-11 items-center justify-center gap-3 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-black transition-colors duration-200 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black/10 dark:border-white/15 dark:bg-neutral-900/80 dark:text-white dark:hover:bg-white/10 dark:focus-visible:ring-white/20"
                >
                  {/* GitHub icon */}
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 .5a12 12 0 0 0-3.793 23.4c.6.11.82-.26.82-.58v-2.02c-3.338.73-4.04-1.61-4.04-1.61-.546-1.39-1.333-1.76-1.333-1.76-1.09-.75.083-.734.083-.734 1.205.086 1.84 1.238 1.84 1.238 1.07 1.835 2.807 1.305 3.492.998.108-.79.418-1.305.76-1.604-2.665-.304-5.467-1.333-5.467-5.93 0-1.31.47-2.38 1.236-3.22-.124-.304-.536-1.527.117-3.183 0 0 1.008-.322 3.303 1.23a11.5 11.5 0 0 1 6.006 0c2.294-1.552 3.301-1.23 3.301-1.23.655 1.656.243 2.879.12 3.183.77.84 1.235 1.91 1.235 3.22 0 4.61-2.807 5.624-5.48 5.922.43.37.816 1.102.816 2.222v3.293c0 .322.216.696.826.578A12 12 0 0 0 12 .5z" />
                  </svg>
                  Continue with GitHub
                </button>
              </div>

              <p className="mt-6 text-center text-sm text-neutral-600 dark:text-neutral-300">
                Do not have an account?{" "}
                <a
                  href="#/signup"
                  className="text-purple-medium dark:text-purple-400 underline-offset-2 hover:underline"
                >
                  Sign up
                </a>
              </p>

            </form>
          )}

          {/* ------------------ RESET FORM ------------------ */}
          {mode === "reset" && (
            <form onSubmit={handleResetSubmit} className="space-y-5">
              {/* Email */}
              <div className={resetRequestComplete ? "hidden" : ""}>
                <label className="block text-sm font-medium text-black dark:text-white mb-2">
                  Email address
                </label>
                <div className="flex items-center border rounded-lg bg-white dark:bg-white/5 border-black/10 dark:border-white/15 focus-within:ring-2 focus-within:ring-purple-500">
                  <span className="pl-3 text-black/60 dark:text-white/60">
                    <Mail className="w-5 h-5" />
                  </span>
                  <input
                    type="email"
                    className="w-full px-3 py-3 rounded-lg outline-none bg-transparent text-black dark:text-white placeholder-black/50 dark:placeholder-white/50"
                    placeholder="you@example.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    readOnly={resetRequestComplete}
                    disabled={loading || resetRequestComplete}
                    required
                  />
                </div>
              </div>

              {resetRequestComplete ? (
                <div className="rounded-[28px] border border-emerald-200 bg-[linear-gradient(180deg,rgba(240,253,244,0.98),rgba(255,255,255,0.98))] px-5 py-5 text-left shadow-[0_18px_40px_rgba(5,150,105,0.12)] dark:border-emerald-500/25 dark:bg-[linear-gradient(180deg,rgba(6,95,70,0.22),rgba(10,10,10,0.96))]">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-white/85 text-emerald-700 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-500/12 dark:text-emerald-300">
                      <CheckCircle2 className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
                        Email Sent
                      </p>
                      <p className="mt-1 text-2xl font-semibold tracking-tight text-emerald-950 dark:text-white">
                        Check your email
                      </p>
                      <p className="mt-3 text-sm leading-7 text-emerald-800 dark:text-emerald-100/90">
                        {buildPasswordResetSuccessMessage(resetSubmittedEmail)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {!resetRequestComplete ? (
                <button
                  type="submit"
                  className="w-full btn-primary"
                  disabled={loading}
                >
                  {loading ? "Sending reset link..." : "Send reset link"}
                </button>
              ) : null}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
