import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Box, Wrench } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/use-document-title';

const tools = [
  {
    to: '/tools/master-carton',
    icon: Box,
    title: 'Master Carton Sizer',
    description: 'Enter inner carton outer dimensions and constraints to get the master carton size, layout and CBM.',
  },
];

export default function Tools() {
  useDocumentTitle('Tools');
  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Wrench className="h-4 w-4" /> Tools
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
