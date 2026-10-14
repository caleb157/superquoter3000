import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Box, Calculator, Wrench, Ship, Weight } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/use-document-title';

const tools = [
  {
    to: '/tools/master-carton',
    icon: Box,
    title: 'Master Carton Sizer',
    description: 'Enter inner carton outer dimensions and constraints to get the master carton size, layout and CBM.',
  },
  {
    to: '/tools/iron-weight',
    icon: Weight,
    title: 'Iron Weight Calculator',
    description: 'Weight and cost of iron furniture parts from bars and tubes. Estimate the parts from a photo and save builds by SKU.',
  },
  {
    to: '/tools/breakeven',
    icon: Calculator,
    title: 'Breakeven Calculator',
    description: 'Revenue needed to cover overhead and the cash buffer at any trading / manufacturing mix, from live Odoo margins and overhead. Change any assumption to try it out.',
  },
  {
    to: '/freight-quotes',
    icon: Ship,
    title: 'Freight Quotes',
    description: 'Log, compare and analyse freight forwarder quotes and shipping costs.',
  },
];



export default function Tools() {
  useDocumentTitle('Tools');
  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
        <h1 className="page-title flex items-center gap-2">
          <Wrench className="h-5 w-5 text-muted-foreground" /> Tools
        </h1>
        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map(t => (
            <Link key={t.to} to={t.to}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <t.icon className="h-4 w-4" /> {t.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
