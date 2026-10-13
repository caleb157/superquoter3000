import { AppLayout } from '@/components/AppLayout';
import { SampleRequestsList } from '@/components/SampleRequestsList';
import { useDocumentTitle } from '@/hooks/use-document-title';

/** All sample requests across inquiries. Create one from an inquiry's Products tab (tick products, Request samples). */
export default function SamplesList() {
  useDocumentTitle('Samples');
  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div>
          <h1 className="page-title">Samples</h1>
          <p className="text-sm text-muted-foreground">
            One request per batch of samples. The clock runs until every sample is received at our factory.
          </p>
        </div>
        <SampleRequestsList />
      </div>
    </AppLayout>
  );
}
