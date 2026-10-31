import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ConnectPage from "./pages/public/ConnectPage";
import Login from "./pages/crm/Login";
import ResetPassword from "./pages/crm/ResetPassword";
import Shell from "./components/crm/Shell";
import Dashboard from "./pages/crm/Dashboard";
import Sessions from "./pages/crm/Sessions";
import Viewer from "./pages/crm/Viewer";
import Devices from "./pages/crm/Devices";
import Links from "./pages/crm/Links";
import Settings, { Team } from "./pages/crm/Settings";
import LiveConsole from "./pages/crm/LiveConsole";

const Protected = ({ children, admin }) => {
  const { user, ready, isAdmin } = useAuth();
  if (!ready) return <div className="min-h-screen bg-[#0b0f17]" />;
  if (!user) return <Navigate to="/crm/login" replace />;
  if (admin && !isAdmin) return <Navigate to="/crm" replace />;
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<ConnectPage />} />
          <Route path="/assistir/:code" element={<ConnectPage />} />
          <Route path="/crm/login" element={<Login />} />
          <Route path="/crm/reset/:token" element={<ResetPassword />} />
          <Route path="/crm" element={<Protected><Shell /></Protected>}>
            <Route index element={<Dashboard />} />
            <Route path="atendimentos" element={<Sessions />} />
            <Route path="atendimentos/:id" element={<Viewer />} />
            <Route path="consola" element={<LiveConsole />} />
            <Route path="equipa" element={<Protected admin><Team /></Protected>} />
            <Route path="dispositivos" element={<Devices />} />
            <Route path="links" element={<Links />} />
            <Route path="configuracoes" element={<Protected admin><Settings /></Protected>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="top-right" theme="dark" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
