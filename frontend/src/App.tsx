import { Navigate, Route, Routes } from 'react-router-dom';
import PublicPage from './pages/PublicPage.jsx';
import AdminRecorder from './pages/AdminRecorder.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import AdminGuard from './components/AdminGuard.jsx';
import AdminLogin from './components/AdminLogin.jsx';
import ForgotPassword from './components/ForgotPassword.jsx';
import ResetPassword from './components/ResetPassword.jsx';
import ChangePassword from './components/ChangePassword.jsx';
import { AdminAuthProvider } from './components/AuthContext.jsx';

function Protected({ children }) {
  return <AdminGuard>{children}</AdminGuard>;
}

export default function App() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="/" element={<PublicPage />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/forgot-password" element={<ForgotPassword />} />
        <Route path="/admin/reset-password" element={<ResetPassword />} />
        <Route path="/admin/change-password" element={<Protected><ChangePassword forced /></Protected>} />
        <Route path="/admin/record" element={<Protected><AdminRecorder /></Protected>} />
        <Route path="/admin/*" element={<Protected><AdminDashboard /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}
