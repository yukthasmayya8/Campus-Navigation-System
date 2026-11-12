import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAdminAuth } from "./AuthContext";
import AdminGuard from "./AdminGuard";
import LocationManagement from "./LocationManagement";
import RouteManagement from "./RouteManagement";
import AdminHistory from "./AdminHistory";
import AuditLog from "./AuditLog";
import AdminAccountManagement from "./AdminAccountManagement";
import ChangePassword from "./ChangePassword";
import { cx, styles } from "./ui";

// ONE dashboard for Admin and Super Admin, built by composition: shared features are written once, and the
// Super Admin extras (Audit log, Accounts) are added only when isSuperAdmin. The server still checks every role.
export function DashboardLayout() {
  const { user, isSuperAdmin, logout } = useAdminAuth();
  const tabs = [
    ["locations", "Locations"],
    ["routes", "Routes"],
    ["/admin/record", "Record route"],
    ["history", "History"],
    ...(isSuperAdmin ? [["audit", "Audit log"], ["accounts", "Accounts"]] : []),
    ["account", "My account"],
  ];
  return (
    <div className={styles.root}>
      <div className={styles.row}><strong>{user.name} · {isSuperAdmin ? "Super Admin" : "Admin"}</strong><button type="button" onClick={logout}>Log out</button></div>
      <nav className={styles.tabs} aria-label="Admin sections">
        {tabs.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => cx(styles.tab, isActive && styles.tabActive)}>{label}</NavLink>)}
      </nav>
      <Outlet />
    </div>
  );
}
export default function AdminDashboard() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<Navigate to="locations" replace />} />
        <Route path="locations" element={<LocationManagement />} />
        <Route path="routes" element={<RouteManagement />} />
        <Route path="record" element={<Navigate to="/admin/record" replace />} />
        <Route path="history" element={<AdminHistory />} />
        <Route path="audit" element={<AdminGuard superOnly><AuditLog /></AdminGuard>} />
        <Route path="accounts" element={<AdminGuard superOnly><AdminAccountManagement /></AdminGuard>} />
        <Route path="account" element={<ChangePassword />} />
        <Route path="*" element={<div className={styles.card}>Page not found.</div>} />
      </Route>
    </Routes>
  );
}
