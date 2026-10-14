import { Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { UpdateAvailableBanner } from "@/components/UpdateAvailableBanner";
import Login from "./pages/Login";
import { lazyPage } from "@/lib/lazy-page";

// Each page is its own chunk, downloaded the first time it is opened, so the first
// visit no longer loads the whole app (spreadsheet, PDF and chart libraries included).
const Dashboard = lazyPage(() => import("./pages/Dashboard"));
const Settings = lazyPage(() => import("./pages/Settings"));
const Products = lazyPage(() => import("./pages/Products"));
const Customers = lazyPage(() => import("./pages/Customers"));
const CustomerDetail = lazyPage(() => import("./pages/CustomerDetail"));
const ProductDetail = lazyPage(() => import("./pages/ProductDetail"));
const AssemblyDetail = lazyPage(() => import("./pages/AssemblyDetail"));
const CustomerQuote = lazyPage(() => import("./pages/CustomerQuote"));
const Quotes = lazyPage(() => import("./pages/Quotes"));
const QuoteView = lazyPage(() => import("./pages/QuoteView"));
const QuoteComparison = lazyPage(() => import("./pages/QuoteComparison"));
const VendorRfqList = lazyPage(() => import("./pages/VendorRfqList"));
const VendorRfqEditor = lazyPage(() => import("./pages/VendorRfqEditor"));
const VendorRfqPublicView = lazyPage(() => import("./pages/VendorRfqPublicView"));
const VendorRfqSheet = lazyPage(() => import("./pages/VendorRfqSheet"));
const InquiryDetail = lazyPage(() => import("./pages/InquiryDetail"));
const CostingWorkspace = lazyPage(() => import("./pages/CostingWorkspace"));
const InquiryPdView = lazyPage(() => import("./pages/InquiryPdView"));
const PdDashboard = lazyPage(() => import("./pages/PdDashboard"));
const InquiryContainerPlanner = lazyPage(() => import("./pages/InquiryContainerPlanner"));
const SamplesList = lazyPage(() => import("./pages/SamplesList"));
const SampleRequestView = lazyPage(() => import("./pages/SampleRequestView"));
const Tasks = lazyPage(() => import("./pages/Tasks"));
const Projects = lazyPage(() => import("./pages/Projects"));
const ProjectDetail = lazyPage(() => import("./pages/ProjectDetail"));
const Analytics = lazyPage(() => import("./pages/Analytics"));
const Vendors = lazyPage(() => import("./pages/Vendors"));
const Complaints = lazyPage(() => import("./pages/Complaints"));
const Tools = lazyPage(() => import("./pages/Tools"));
const MasterCartonSizer = lazyPage(() => import("./pages/MasterCartonSizer"));
const IronWeightCalculator = lazyPage(() => import("./pages/IronWeightCalculator"));
const BreakevenCalculator = lazyPage(() => import("./pages/BreakevenCalculator"));
const MediaGallery = lazyPage(() => import("./pages/MediaGallery"));
const OAuthConsent = lazyPage(() => import("./pages/OAuthConsent"));
const NotFound = lazyPage(() => import("./pages/NotFound"));
const SoProfitability = lazyPage(() => import("./pages/SoProfitability"));
const FreightQuotes = lazyPage(() => import("./pages/FreightQuotes"));
const FreightQuoteNew = lazyPage(() => import("./pages/FreightQuoteNew"));
const FreightQuoteDetail = lazyPage(() => import("./pages/FreightQuoteDetail"));
const FreightQuoteDashboard = lazyPage(() => import("./pages/FreightQuoteDashboard"));
const FreightQuoteSettings = lazyPage(() => import("./pages/FreightQuoteSettings"));

const queryClient = new QueryClient();

const PageLoading = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
  </div>
);

// Fetch the everyday pages in the background once the first page is up, so opening
// them later is instant. Team members only: customers and vendors on the public quote
// and RFQ links never download the internal pages.
const PreloadCommonPages = () => {
  const { isAdminOrTeam } = useAuth();
  useEffect(() => {
    if (!isAdminOrTeam) return;
    const run = () => [Dashboard, InquiryDetail, CostingWorkspace, Products, Tasks].forEach(p => void p.preload().catch(() => {}));
    const w = window as any;
    const handle = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 5000 }) : window.setTimeout(run, 2000);
    return () => (w.cancelIdleCallback ? w.cancelIdleCallback(handle) : window.clearTimeout(handle));
  }, [isAdminOrTeam]);
  return null;
};

const CostingRedirect = ({ view }: { view?: string }) => {
  const { id } = useParams();
  return <Navigate replace to={`/inquiry/${id}/costing${view ? `?view=${view}` : ''}`} />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <UpdateAvailableBanner />
          <BrowserRouter future={{ v7_startTransition: true }}>
            <PreloadCommonPages />
            <Suspense fallback={<PageLoading />}>
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
              <Route path="/inquiry/:id/costing" element={
                <ProtectedRoute requireAdminOrTeam><CostingWorkspace /></ProtectedRoute>
              } />
              {/* The Pricing, Target and Bulk grids are views of the Costing workspace now. */}
              <Route path="/inquiry/:id/pricing" element={<CostingRedirect view="quotes" />} />
              <Route path="/inquiry/:id/targets" element={<CostingRedirect />} />
              <Route path="/inquiry/:id/audit" element={<CostingRedirect view="buildup" />} />
              <Route path="/inquiry/:id/quote-comparison" element={
                <ProtectedRoute requireAdminOrTeam><QuoteComparison /></ProtectedRoute>
              } />
              <Route path="/inquiry/:id/pd" element={
                <ProtectedRoute requireAdminOrTeam><InquiryPdView /></ProtectedRoute>
              } />

              <Route path="/inquiry/:id/container-plan" element={
                <ProtectedRoute requireAdminOrTeam><InquiryContainerPlanner /></ProtectedRoute>
              } />
              <Route path="/pd-dashboard" element={
                <ProtectedRoute requireAdminOrTeam><PdDashboard /></ProtectedRoute>
              } />
              <Route path="/samples" element={
                <ProtectedRoute requireAdminOrTeam><SamplesList /></ProtectedRoute>
              } />
              <Route path="/samples/:id" element={
                <ProtectedRoute requireAdminOrTeam><SampleRequestView /></ProtectedRoute>
              } />
              <Route path="/products" element={
                <ProtectedRoute requireAdminOrTeam>
                  <Products />
                </ProtectedRoute>
              } />
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
              <Route path="/vendor-rfq-sheet/:batchId" element={
                <ProtectedRoute requireAdminOrTeam><VendorRfqSheet /></ProtectedRoute>
              } />
              <Route path="/vendor-rfq/view/:token" element={<VendorRfqPublicView />} />
              <Route path="/quotes" element={
                <ProtectedRoute requireAdminOrTeam>
                  <Quotes />
                </ProtectedRoute>
              } />
              <Route path="/quotes/:id" element={
                <ProtectedRoute requireAdminOrTeam>
                  <QuoteView />
                </ProtectedRoute>
              } />
              <Route path="/quote/:token" element={<CustomerQuote />} />
              <Route path="/tasks" element={
                <ProtectedRoute requireAdminOrTeam><Tasks /></ProtectedRoute>
              } />
              <Route path="/projects" element={
                <ProtectedRoute requireAdminOrTeam><Projects /></ProtectedRoute>
              } />
              <Route path="/projects/:id" element={
                <ProtectedRoute requireAdminOrTeam><ProjectDetail /></ProtectedRoute>
              } />
              <Route path="/analytics" element={
                <ProtectedRoute requireAdminOrTeam><Analytics /></ProtectedRoute>
              } />
              <Route path="/vendors" element={
                <ProtectedRoute requireAdminOrTeam><Vendors /></ProtectedRoute>
              } />
              <Route path="/complaints" element={
                <ProtectedRoute requireAdminOrTeam><Complaints /></ProtectedRoute>
              } />
              <Route path="/media" element={
                <ProtectedRoute requireAdminOrTeam><MediaGallery /></ProtectedRoute>
              } />
              <Route path="/tools" element={
                <ProtectedRoute requireAdminOrTeam><Tools /></ProtectedRoute>
              } />
              <Route path="/tools/master-carton" element={
                <ProtectedRoute requireAdminOrTeam><MasterCartonSizer /></ProtectedRoute>
              } />
              <Route path="/tools/iron-weight" element={
                <ProtectedRoute requireAdminOrTeam><IronWeightCalculator /></ProtectedRoute>
              } />
              <Route path="/tools/breakeven" element={
                <ProtectedRoute requireAdminOrTeam><BreakevenCalculator /></ProtectedRoute>
              } />

              <Route path="/freight-quotes" element={<ProtectedRoute requireAdminOrTeam><FreightQuotes /></ProtectedRoute>} />
              <Route path="/freight-quotes/new" element={<ProtectedRoute requireAdminOrTeam><FreightQuoteNew /></ProtectedRoute>} />
              <Route path="/freight-quotes/dashboard" element={<ProtectedRoute requireAdminOrTeam><FreightQuoteDashboard /></ProtectedRoute>} />
              <Route path="/freight-quotes/settings" element={<ProtectedRoute requireAdminOrTeam><FreightQuoteSettings /></ProtectedRoute>} />
              <Route path="/freight-quotes/:id" element={<ProtectedRoute requireAdminOrTeam><FreightQuoteDetail /></ProtectedRoute>} />
              <Route path="/profitability" element={
                <ProtectedRoute requireAdminOrTeam><SoProfitability /></ProtectedRoute>
              } />
              <Route path="/team" element={<Navigate to="/settings#team" replace />} />
              <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
