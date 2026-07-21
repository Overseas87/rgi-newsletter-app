import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

type EditorAuthState = {
  configured: boolean;
  configurationError: boolean;
  loading: boolean;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || undefined,
};

const configured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId,
);
let configurationError = false;
let editorAuth: Auth | null = null;

if (configured) {
  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    editorAuth = getAuth(app);
    const emulatorUrl = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL?.trim();
    if (emulatorUrl) {
      const parsed = new URL(emulatorUrl);
      const loopback =
        parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
      if (!loopback || !firebaseConfig.projectId?.startsWith("demo-")) {
        throw new Error(
          "Firebase Auth emulator configuration must use a loopback demo project.",
        );
      }
      connectAuthEmulator(editorAuth, parsed.origin, { disableWarnings: true });
    }
  } catch {
    configurationError = true;
    editorAuth = null;
  }
}

export async function getEditorIdToken(): Promise<string | null> {
  if (!editorAuth) return null;
  await editorAuth.authStateReady();
  return editorAuth.currentUser?.getIdToken() ?? null;
}

const EditorAuthContext = createContext<EditorAuthState | null>(null);

export function EditorAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(
    editorAuth?.currentUser ?? null,
  );
  const [loading, setLoading] = useState(Boolean(editorAuth));

  useEffect(() => {
    if (!editorAuth) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(editorAuth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const value = useMemo<EditorAuthState>(
    () => ({
      configured: Boolean(editorAuth),
      configurationError,
      loading,
      user,
      signIn: async (email, password) => {
        if (!editorAuth) throw new Error("Editor sign-in is not configured.");
        await signInWithEmailAndPassword(editorAuth, email, password);
      },
      signOut: async () => {
        if (editorAuth) await signOut(editorAuth);
      },
    }),
    [loading, user],
  );

  return (
    <EditorAuthContext.Provider value={value}>
      {children}
    </EditorAuthContext.Provider>
  );
}

export function useEditorAuth(): EditorAuthState {
  const value = useContext(EditorAuthContext);
  if (!value)
    throw new Error("useEditorAuth must be used within EditorAuthProvider");
  return value;
}
