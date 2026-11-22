import { Navigate, Route, Routes } from 'react-router-dom';
import PublicPage from './pages/PublicPage.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import AdminHome from './pages/AdminHome.jsx';
import AdminRecorder from './pages/AdminRecorder.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicPage />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminHome />} />
      <Route path="/admin/record" element={<AdminRecorder />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
