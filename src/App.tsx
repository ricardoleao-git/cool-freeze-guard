import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DemoProvider } from "@/lib/demo-store";
import { AuthProvider, ProtectedRoute, RoleGuard } from "@/lib/auth";
import AppLayout from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import OperationalPanel from "./pages/OperationalPanel";
import Employees from "./pages/Employees";
import ColdAreas from "./pages/ColdAreas";
import Devices from "./pages/Devices";
import Events from "./pages/Events";
import ThermalBreaks from "./pages/ThermalBreaks";
import Alerts from "./pages/Alerts";
import Occurrences from "./pages/Occurrences";
import Reports from "./pages/Reports";
import Integrations from "./pages/Integrations";
import Tenants from "./pages/Tenants";
import Users from "./pages/Users";
import DemoMode from "./pages/DemoMode";
import HowItWorks from "./pages/HowItWorks";
import History from "./pages/History";
import Login from "./pages/Login";
import NoPermission from "./pages/NoPermission";
import NotFound from "./pages/NotFound";
import LgpdPrivacy from "./pages/LgpdPrivacy";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <DemoProvider>
            <Toaster />
            <Sonner />
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/demo" element={<DemoMode />} />
              <Route path="/sem-permissao" element={<ProtectedRoute><NoPermission /></ProtectedRoute>} />
              <Route element={<ProtectedRoute><RoleGuard><AppLayout /></RoleGuard></ProtectedRoute>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/painel" element={<OperationalPanel />} />
                <Route path="/colaboradores" element={<Employees />} />
                <Route path="/ambientes" element={<ColdAreas />} />
                <Route path="/dispositivos" element={<Devices />} />
                <Route path="/eventos" element={<Events />} />
                <Route path="/pausas" element={<ThermalBreaks />} />
                <Route path="/alertas" element={<Alerts />} />
                <Route path="/ocorrencias" element={<Occurrences />} />
                <Route path="/historico" element={<History />} />
                <Route path="/relatorios" element={<Reports />} />
                <Route path="/integracoes" element={<Integrations />} />
                <Route path="/empresas" element={<Tenants />} />
                <Route path="/usuarios" element={<Users />} />
                <Route path="/como-funciona" element={<HowItWorks />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </DemoProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
