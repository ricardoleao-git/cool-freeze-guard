import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DemoProvider } from "@/lib/demo-store";
import { AuthProvider, ProtectedRoute, RoleGuard } from "@/lib/auth";
import AppLayout from "@/components/AppLayout";
import DemoShell from "@/components/DemoShell";
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
import PublicPanel from "./pages/PublicPanel";
import HowItWorks from "./pages/HowItWorks";
import History from "./pages/History";
import Login from "./pages/Login";
import NoPermission from "./pages/NoPermission";
import NotFound from "./pages/NotFound";
import LgpdPrivacy from "./pages/LgpdPrivacy";
import TimeAdjustments from "./pages/TimeAdjustments";
import MyDay from "./pages/MyDay";
import DailySummary from "./pages/DailySummary";
import GuardiaIntegration from "./pages/GuardiaIntegration";
import Statement from "./pages/Statement";
import Inconsistencies from "./pages/Inconsistencies";
import PeriodClosure from "./pages/PeriodClosure";
import Kiosk from "./pages/Kiosk";
import KioskTokens from "./pages/KioskTokens";

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
              <Route path="/painel" element={<Kiosk />} />
              <Route path="/painel-demo" element={<PublicPanel />} />
              <Route path="/painel-tv" element={<PublicPanel />} />
              <Route path="/sem-permissao" element={<ProtectedRoute><NoPermission /></ProtectedRoute>} />


              {/* Modo de demonstração público: navegação completa, sem login,
                  escopado ao tenant 'demo-tenant'. */}
              <Route path="/demo" element={<DemoShell />}>
                <Route index element={<Dashboard />} />
                <Route path="experimento" element={<DemoMode />} />
                <Route path="painel-operacional" element={<OperationalPanel />} />
                <Route path="painel" element={<OperationalPanel />} />
                <Route path="colaboradores" element={<Employees />} />
                <Route path="ambientes" element={<ColdAreas />} />
                <Route path="dispositivos" element={<Devices />} />
                <Route path="eventos" element={<Events />} />
                <Route path="pausas" element={<ThermalBreaks />} />
                <Route path="alertas" element={<Alerts />} />
                <Route path="ocorrencias" element={<Occurrences />} />
                <Route path="historico" element={<History />} />
                <Route path="relatorios" element={<Reports />} />
                <Route path="integracoes" element={<Integrations />} />
                <Route path="empresas" element={<Tenants />} />
                <Route path="usuarios" element={<Users />} />
                <Route path="como-funciona" element={<HowItWorks />} />
                <Route path="lgpd" element={<LgpdPrivacy />} />
                <Route path="ajustes" element={<TimeAdjustments />} />
                <Route path="meu-dia" element={<MyDay />} />
                <Route path="resumo-diario" element={<DailySummary />} />
                <Route path="configuracoes/integracao-guardia" element={<GuardiaIntegration />} />
                <Route path="extrato" element={<Statement />} />
                <Route path="inconsistencias" element={<Inconsistencies />} />
                <Route path="fechamento" element={<PeriodClosure />} />
              </Route>

              <Route element={<ProtectedRoute><RoleGuard><AppLayout /></RoleGuard></ProtectedRoute>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/painel-operacional" element={<OperationalPanel />} />
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
                <Route path="/lgpd" element={<LgpdPrivacy />} />
                <Route path="/ajustes" element={<TimeAdjustments />} />
                <Route path="/meu-dia" element={<MyDay />} />
                <Route path="/resumo-diario" element={<DailySummary />} />
                <Route path="/configuracoes/integracao-guardia" element={<GuardiaIntegration />} />
                <Route path="/extrato" element={<Statement />} />
                <Route path="/inconsistencias" element={<Inconsistencies />} />
                <Route path="/fechamento" element={<PeriodClosure />} />
                <Route path="/configuracoes/painel-externo" element={<KioskTokens />} />
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
