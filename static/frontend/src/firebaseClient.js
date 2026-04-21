// src/firebaseClient.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const REQUIRED_FIREBASE_ENV_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

const missingFirebaseConfigKeys = REQUIRED_FIREBASE_ENV_KEYS.filter(
  (key) => !String(import.meta.env[key] || "").trim()
);

const firebaseConfigIssue = missingFirebaseConfigKeys.length
  ? `Firebase client config is missing ${missingFirebaseConfigKeys.join(
      ", "
    )}. Add them to the frontend environment before using signup or social login.`
  : "";

if (firebaseConfigIssue && typeof window !== "undefined") {
  console.error(firebaseConfigIssue);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const actionCodeSettings = {
  url: typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}#/login` : "http://localhost:5173/#/login",
  handleCodeInApp: false,
};

const googleProvider = new GoogleAuthProvider();
const githubProvider = new GithubAuthProvider();

googleProvider.addScope("email");
googleProvider.addScope("profile");
googleProvider.setCustomParameters({ prompt: "select_account" });

githubProvider.addScope("read:user");
githubProvider.addScope("user:email");

function ensureFirebaseClientReady() {
  if (firebaseConfigIssue) {
    throw new Error(firebaseConfigIssue);
  }
}

export {
  auth,
  googleProvider,
  githubProvider,
  actionCodeSettings,
  ensureFirebaseClientReady,
  firebaseConfigIssue,
};
