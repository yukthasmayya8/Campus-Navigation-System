import { Navigate, Route, Routes } from 'react-router-dom';
import PublicPage from './pages/PublicPage.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import AdminHome from './pages/AdminHome.jsx';
import AdminRecorder from './pages/AdminRecorder.jsx';
import RequireAdmin from './components/RequireAdmin.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicPage />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<RequireAdmin><AdminHome /></RequireAdmin>} />
      <Route path="/admin/record" element={<RequireAdmin><AdminRecorder /></RequireAdmin>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
