import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DemoProvider } from "@/lib/demo-store";
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
import DemoMode from "./pages/DemoMode";
import HowItWorks from "./pages/HowItWorks";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DemoProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/painel" element={<OperationalPanel />} />
              <Route path="/colaboradores" element={<Employees />} />
              <Route path="/ambientes" element={<ColdAreas />} />
              <Route path="/dispositivos" element={<Devices />} />
              <Route path="/eventos" element={<Events />} />
              <Route path="/pausas" element={<ThermalBreaks />} />
              <Route path="/alertas" element={<Alerts />} />
              <Route path="/ocorrencias" element={<Occurrences />} />
              <Route path="/relatorios" element={<Reports />} />
              <Route path="/integracoes" element={<Integrations />} />
              <Route path="/empresas" element={<Tenants />} />
              <Route path="/demo" element={<DemoMode />} />
              <Route path="/como-funciona" element={<HowItWorks />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </DemoProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
