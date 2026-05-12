// Auth context for Cycling Segment Tracker 2.
//
// `<AuthProvider>` is mounted at the root. It exposes:
//   - state: "loading" | "needs_setup" | "logged_out" | "logged_in"
//   - user : the current user object (only when logged_in)
//   - login(email, password)
//   - logout()
//   - completeSetup(email, password)  — used on first-run wizard
//
// `<RequireAuth>` is a route guard that renders <Login /> or <SetupWizard />
// as appropriate when the user isn't signed in.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  authStatus,
  login as apiLogin,
  logout as apiLogout,
  setInitialPassword,
} from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState("loading");
  const [user, setUser] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const s = await authStatus();
      if (s.needs_setup) {
        setState("needs_setup");
        setUser(null);
      } else if (s.authenticated && s.user) {
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

  const login = useCallback(async (email, password) => {
    const r = await apiLogin(email, password);
    setUser(r.user);
    setState("logged_in");
    return r.user;
  }, []);

  const completeSetup = useCallback(async (email, password) => {
    const r = await setInitialPassword(email, password);
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
    <AuthCtx.Provider value={{ state, user, login, logout, completeSetup, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be inside <AuthProvider>");
  return v;
}
