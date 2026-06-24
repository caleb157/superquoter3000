import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Products from "./pages/Products";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import ProjectRedirect from "./pages/ProjectRedirect";
import ProductDetail from "./pages/ProductDetail";
import AssemblyDetail from "./pages/AssemblyDetail";
import CustomerQuote from "./pages/CustomerQuote";
import Quotes from "./pages/Quotes";
import VendorRfqList from "./pages/VendorRfqList";
import VendorRfqEditor from "./pages/VendorRfqEditor";
import VendorRfqPublicView from "./pages/VendorRfqPublicView";
import InquiryDetail from "./pages/InquiryDetail";
import InquiryPricingGrid from "./pages/InquiryPricingGrid";
import InquiryAuditGrid from "./pages/InquiryAuditGrid";
import SamplesList from "./pages/SamplesList";
import Tasks from "./pages/Tasks";
import Analytics from "./pages/Analytics";
import TeamManagement from "./pages/TeamManagement";
import Vendors from "./pages/Vendors";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
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
              <Route path="/inquiries" element={
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
              <Route path="/customers/:id" element={
                <ProtectedRoute requireAdminOrTeam>
                  <CustomerDetail />
                </ProtectedRoute>
              } />
              <Route path="/inquiry/:id" element={
                <ProtectedRoute requireAdminOrTeam><InquiryDetail /></ProtectedRoute>
              } />
              <Route path="/inquiry/:id/pricing" element={
                <ProtectedRoute requireAdminOrTeam><InquiryPricingGrid /></ProtectedRoute>
              } />
              <Route path="/inquiry/:id/audit" element={
                <ProtectedRoute requireAdminOrTeam><InquiryAuditGrid /></ProtectedRoute>
              } />
              <Route path="/samples" element={
                <ProtectedRoute requireAdminOrTeam><SamplesList /></ProtectedRoute>
              } />
              <Route path="/products" element={
                <ProtectedRoute requireAdminOrTeam>
                  <Products />
                </ProtectedRoute>
              } />
              <Route path="/project/:id" element={<ProjectRedirect />} />
              <Route path="/product/:id" element={
                <ProtectedRoute requireAdminOrTeam>
                  <ProductDetail />
                </ProtectedRoute>
              } />
              <Route path="/assembly/:id" element={
                <ProtectedRoute requireAdminOrTeam>
                  <AssemblyDetail />
                </ProtectedRoute>
              } />
              <Route path="/vendor-rfqs" element={
                <ProtectedRoute requireAdminOrTeam>
                  <VendorRfqList />
                </ProtectedRoute>
              } />
              <Route path="/vendor-rfq/:id" element={
                <ProtectedRoute requireAdminOrTeam>
                  <VendorRfqEditor />
                </ProtectedRoute>
              } />
              <Route path="/vendor-rfq/view/:token" element={<VendorRfqPublicView />} />
              <Route path="/quotes" element={
                <ProtectedRoute requireAdminOrTeam>
                  <Quotes />
                </ProtectedRoute>
              } />
              <Route path="/quote/:token" element={<CustomerQuote />} />
              <Route path="/tasks" element={
                <ProtectedRoute requireAdminOrTeam><Tasks /></ProtectedRoute>
              } />
              <Route path="/analytics" element={
                <ProtectedRoute requireAdminOrTeam><Analytics /></ProtectedRoute>
              } />
              <Route path="/vendors" element={
                <ProtectedRoute requireAdminOrTeam><Vendors /></ProtectedRoute>
              } />
              <Route path="/team" element={
                <ProtectedRoute requireAdmin><TeamManagement /></ProtectedRoute>
              } />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
