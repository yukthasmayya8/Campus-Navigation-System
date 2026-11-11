import { Navigate, useLocation } from "react-router-dom";
import { useAdminAuth } from "./AuthContext";
import { Loading, ErrorBlock, PermissionDenied } from "./ui";

// 401 -> login, PASSWORD_CHANGE_REQUIRED -> change-password, wrong role -> permission message.
// Hiding things is only a convenience; the server checks every role.
export default function AdminGuard({ children, superOnly = false }) {
  const { status, user, error, refresh, isSuperAdmin } = useAdminAuth();
  const loc = useLocation();
  if (status === "loading") return <Loading label="Checking your session…" />;
  if (status === "anonymous") return <Navigate to="/admin/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (status === "passwordChange") return <Navigate to="/admin/change-password" replace />;
  if (status === "error") return <ErrorBlock error={error} onRetry={refresh} />;
  if (superOnly && !isSuperAdmin) return <PermissionDenied />;
  return user ? children : null;
}
