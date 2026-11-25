import { Navigate, useLocation } from 'react-router-dom';
import { redirectFromCustomers } from '@/lib/sales/account-link';

// The Customers page is folded into the Sales CRM (Sales > Accounts). Old links and bookmarks land there,
// with the stage group they asked for (/customers?tab=leads -> Accounts, Leads).
export default function Customers() {
  const { search } = useLocation();
  return <Navigate to={redirectFromCustomers(search)} replace />;
}
