// Inquiry → Odoo → one product's materials and BOM. Final-product fields are edited only on
// the inquiry Odoo page; this screen matches/creates raw materials and creates the BOM.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { Button } from '@/components/ui/button';
import { OdooExportTab } from '@/components/odoo-export/OdooExportTab';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function InquiryOdooBom() {
  const { id: inquiryId = '', productId = '' } = useParams<{ id: string; productId: string }>();
  const navigate = useNavigate();
  const [inq, setInq] = useState('Inquiry');
  const [name, setName] = useState('Product');
  useDocumentTitle(`Materials & BOM · ${name}`);
  useEffect(() => {
    supabase.from('customer_rfqs').select('rfq_number, title').eq('id', inquiryId).maybeSingle()
      .then(({ data }) => data && setInq(data.title || data.rfq_number || 'Inquiry'));
    supabase.from('products').select('name').eq('id', productId).maybeSingle()
      .then(({ data }) => data && setName(data.name || 'Product'));
  }, [inquiryId, productId]);

  return (
    <AppLayout>
      <div className="px-3 sm:px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7 px-2" onClick={() => navigate(`/inquiry/${inquiryId}/odoo`)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Odoo
          </Button>
          <PageBreadcrumbs canonical={[{ label: 'Inquiries', to: '/' }, { label: inq, to: `/inquiry/${inquiryId}` }, { label: 'Odoo', to: `/inquiry/${inquiryId}/odoo` }]} current={`${name} · Materials & BOM`} />
        </div>
        <h1 className="page-title">{name} · Materials &amp; BOM</h1>
        <OdooExportTab productId={productId} />
      </div>
    </AppLayout>
  );
}
