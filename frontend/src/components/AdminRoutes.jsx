import { Navigate, Route, Routes } from "react-router-dom";
import { AdminAuthProvider } from "./AuthContext";
import AdminGuard from "./AdminGuard";
import AdminLogin from "./AdminLogin";
import ForgotPassword from "./ForgotPassword";
import ResetPassword from "./ResetPassword";
import ChangePassword from "./ChangePassword";
import AdminDashboard from "./AdminDashboard";
import { useAdminAuth } from "./AuthContext";

function ForcedChange() {
  const { status } = useAdminAuth();
  if (status === "anonymous") return <Navigate to="/admin/login" replace />;
  if (status === "authenticated") return <Navigate to="/admin" replace />;
  return status === "loading" ? null : <ChangePassword forced />;
}
// Mount once in App.jsx:  <Route path="/admin/*" element={<AdminRoutes />} />
export default function AdminRoutes() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="login" element={<AdminLogin />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route path="change-password" element={<ForcedChange />} />
        <Route path="*" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
      </Routes>
    </AdminAuthProvider>
  );
}
