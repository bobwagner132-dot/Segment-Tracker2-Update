// Auth context for Cycling Segment Tracker 2.
//
// `<AuthProvider>` is mounted at the root. It exposes:
//   - state: "loading" | "logged_out" | "logged_in"
//   - user : the current user object (only when logged_in)
//   - signIn(name)  — passwordless sign-in by display name
//   - logout()
//
// First sign-in with an unseen name auto-creates that profile on the backend.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  authStatus,
  signIn as apiSignIn,
  logout as apiLogout,
} from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState("loading");
  const [user, setUser] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const s = await authStatus();
      if (s.authenticated && s.user) {
        setState("logged_in");
        setUser(s.user);
      } else {
        setState("logged_out");
        setUser(null);
      }
    } catch {
      setState("logged_out");
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(async (name) => {
    const r = await apiSignIn(name);
    setUser(r.user);
    setState("logged_in");
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
      setState("logged_out");
    }
  }, []);

  return (
    <AuthCtx.Provider value={{ state, user, signIn, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be inside <AuthProvider>");
  return v;
}
