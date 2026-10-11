import { useParams } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import CustomerQuote from '@/pages/CustomerQuote';

/** In-app view of a quote (opens inside the app, PDF button at the top). */
export default function QuoteView() {
  const { id } = useParams<{ id: string }>();
  return (
    <AppLayout>
      <div className="-m-3 sm:-m-4">
        <CustomerQuote embeddedId={id} />
      </div>
    </AppLayout>
  );
}
