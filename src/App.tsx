import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Products from "./pages/Products";
import Customers from "./pages/Customers";
import ProjectDetail from "./pages/ProjectDetail";
import ProductCosting from "./pages/ProductCosting";
import AssemblyDetail from "./pages/AssemblyDetail";
import CustomerQuote from "./pages/CustomerQuote";
import Quotes from "./pages/Quotes";
import RfqList from "./pages/RfqList";
import RfqEditor from "./pages/RfqEditor";
import RfqVendorView from "./pages/RfqVendorView";
import QCList from "./pages/QCList";
import QCEditor from "./pages/QCEditor";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={
              <ProtectedRoute requireAdminOrTeam>
                <Dashboard />
              </ProtectedRoute>
            } />
            <Route path="/settings" element={
              <ProtectedRoute requireAdmin>
                <Settings />
              </ProtectedRoute>
            } />
            <Route path="/customers" element={
              <ProtectedRoute requireAdminOrTeam>
                <Customers />
              </ProtectedRoute>
            } />
            <Route path="/products" element={
              <ProtectedRoute requireAdminOrTeam>
                <Products />
              </ProtectedRoute>
            } />
            <Route path="/project/:id" element={
              <ProtectedRoute requireAdminOrTeam>
                <ProjectDetail />
              </ProtectedRoute>
            } />
            <Route path="/product/:id" element={
              <ProtectedRoute requireAdminOrTeam>
                <ProductCosting />
              </ProtectedRoute>
            } />
            <Route path="/assembly/:id" element={
              <ProtectedRoute requireAdminOrTeam>
                <AssemblyDetail />
              </ProtectedRoute>
            } />
            <Route path="/rfqs" element={
              <ProtectedRoute requireAdminOrTeam>
                <RfqList />
              </ProtectedRoute>
            } />
            <Route path="/rfq/:id" element={
              <ProtectedRoute requireAdminOrTeam>
                <RfqEditor />
              </ProtectedRoute>
            } />
            <Route path="/rfq/view/:token" element={<RfqVendorView />} />
            <Route path="/quotes" element={
              <ProtectedRoute requireAdminOrTeam>
                <Quotes />
              </ProtectedRoute>
            } />
            <Route path="/quote/:token" element={<CustomerQuote />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
