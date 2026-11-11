import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { adminApi, normUser } from "./adminApi";

const Ctx = createContext(null);

// status: loading | anonymous | passwordChange | authenticated | error
export function AdminAuthProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null, error: null });

  const refresh = useCallback(async () => {
    try {
      const user = normUser(await adminApi.me());
      setState({ status: user.forcePasswordChange ? "passwordChange" : "authenticated", user, error: null });
      return user;
    } catch (e) {
      if (e.status === 401) setState({ status: "anonymous", user: null, error: null });
      else if (e.status === 403 && e.code === "PASSWORD_CHANGE_REQUIRED") setState((s) => ({ status: "passwordChange", user: s.user, error: null }));
      else setState({ status: "error", user: null, error: e });
      return null;
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Route guard hook-in: every component passes its caught errors here first.
  // 401 -> login page; 403 PASSWORD_CHANGE_REQUIRED -> change-password form. Returns true when handled.
  const onApiError = useCallback((e) => {
    if (e && e.status === 401) { setState({ status: "anonymous", user: null, error: null }); return true; }
    if (e && e.code === "PASSWORD_CHANGE_REQUIRED") { setState((s) => ({ ...s, status: "passwordChange" })); return true; }
    return false;
  }, []);
  const logout = useCallback(async () => { try { await adminApi.logout(); } catch { /* the session is dropped locally either way */ } setState({ status: "anonymous", user: null, error: null }); }, []);

  const value = useMemo(() => {
    const isSuperAdmin = !!state.user && state.user.role === "super_admin";
    return { ...state, refresh, onApiError, logout, isSuperAdmin, canRestore: state.user ? (state.user.canRestore ?? isSuperAdmin) === true : false };
  }, [state, refresh, onApiError, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAdminAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  return v;
}
