// DKT Cash Flow (/tools/dkt-cash-flow): when DKT needs cash and how much. DKT's own figures
// (cash, overhead, loans, credit lines, Amazon, Allegro) are typed in and kept until changed;
// DKT orders are the open HQ inquiries sold through DKT. Math: src/lib/dkt-cashflow.ts and
// src/lib/dkt-amazon.ts. Data: src/hooks/use-dkt-cashflow.ts.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Landmark, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useDktCashflow } from '@/hooks/use-dkt-cashflow';
import { useManualCashEntries } from '@/hooks/use-manual-cash-entries';
import { addMonths, buildForecast, loanOutstanding, type Month } from '@/lib/dkt-cashflow';
import { cn } from '@/lib/utils';
import { ForecastTab } from '@/components/dkt/ForecastTab';
import { OrdersTab } from '@/components/dkt/OrdersTab';
import { OdooOrdersCard } from '@/components/dkt/OdooOrdersCard';
import { CostsTab } from '@/components/dkt/CostsTab';
import { LoansTab } from '@/components/dkt/LoansTab';
import { CreditTab } from '@/components/dkt/CreditTab';
import { AmazonTab } from '@/components/dkt/AmazonTab';
import { AllegroTab } from '@/components/dkt/AllegroTab';

const TAB_KEY = 'dkt-cash-flow-tab';

export default function DktCashFlow() {
  useDocumentTitle('DKT Cash Flow');
  const thisMonth: Month = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const { data, loading, error, api, odoo } = useDktCashflow(thisMonth);
  const manual = useManualCashEntries('dkt');
  const [tab, setTab] = useState(() => { try { return localStorage.getItem(TAB_KEY) || 'forecast'; } catch { return 'forecast'; } });
  const pickTab = (t: string) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };

  const forecast = useMemo(() => {
    if (!data) return null;
    const inForecast = new Set(data.scenarios.filter(s => s.in_forecast).map(s => s.id));
    return buildForecast({
      settings: data.settings, thisMonth,
      orders: data.orders, costs: data.costs, loans: data.loans, loanPayments: data.loanPayments,
      creditLines: data.creditLines, creditDraws: data.creditDraws,
      amazonSkus: data.skus.filter(s => s.scenario_id && inForecast.has(s.scenario_id)),
      odooOrders: odoo.rows, odooInvoices: odoo.invoices, manual: manual.entries,
    });
  }, [data, thisMonth, odoo.rows, odoo.invoices, manual.entries]);

  const horizon = data?.settings.horizon_months ?? 12;
  const lookahead = Math.max(horizon, 24);

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8"><Link to="/tools" aria-label="Back to Tools"><ArrowLeft className="h-4 w-4" /></Link></Button>
            <h1 className="page-title flex items-center gap-2"><Landmark className="h-5 w-5 text-muted-foreground" /> DKT Cash Flow</h1>
          </div>
          <Button size="sm" variant="outline" onClick={api.reload} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} /> Reload
          </Button>
        </div>

        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">{error}</div>}
        {loading && !data && <p className="text-sm text-muted-foreground">Loading…</p>}
        {odoo.error && data && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-2 text-xs">
            Confirmed orders and invoices from Odoo didn't load ({odoo.error}), so the forecast leaves them out for now.
          </div>
        )}

        {data && forecast && (
          <Tabs value={tab} onValueChange={pickTab}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="forecast">Forecast</TabsTrigger>
              <TabsTrigger value="orders">Orders ({data.orders.filter(o => !o.excluded).length + odoo.rows.filter(o => !o.excluded).length})</TabsTrigger>
              <TabsTrigger value="costs">Overhead &amp; expenses</TabsTrigger>
              <TabsTrigger value="loans">Loans</TabsTrigger>
              <TabsTrigger value="credit">Credit lines</TabsTrigger>
              <TabsTrigger value="amazon">Amazon</TabsTrigger>
              <TabsTrigger value="allegro">Allegro</TabsTrigger>
            </TabsList>

            <TabsContent value="forecast" className="mt-4">
              <ForecastTab
                forecast={forecast} settings={data.settings} saveSettings={api.saveSettings}
                totalOwed={data.loans.filter(l => l.active).reduce((s, l) => s + loanOutstanding(l, data.loanPayments), 0)}
                creditAvailable={data.creditLines.reduce((s, l) => s + Math.max(0, l.limit_usd - l.drawn_usd), 0)}
                scenarios={data.scenarios} skus={data.skus}
                setScenarioInForecast={(id, on) => api.update('dkt_amazon_scenarios', id, { in_forecast: on }, 'scenarios')}
                manual={manual}
              />
            </TabsContent>
            <TabsContent value="orders" className="mt-4">
              <OrdersTab orders={data.orders} odooRows={odoo.rows} share={odoo.share} meta={data.orderMeta} settings={data.settings} dktEntityName={data.dktEntityName}
                saveOrder={api.saveOrder} saveTermsToInquiry={api.saveTermsToInquiry} saveStatus={api.saveOrderStatus} saveSettings={api.saveSettings}
                odooCard={<OdooOrdersCard rows={odoo.rows} invoices={odoo.invoices} partner={odoo.partner} loading={odoo.loading} error={odoo.error}
                  thisMonth={thisMonth} reload={api.reloadOdoo} save={api.saveOdooTerms} />} />
            </TabsContent>
            <TabsContent value="costs" className="mt-4">
              <CostsTab costs={data.costs} thisMonth={thisMonth} settings={data.settings} saveSettings={api.saveSettings}
                add={row => api.insert('dkt_cash_items', row)}
                update={(id, p) => api.update('dkt_cash_items', id, p, 'costs')}
                remove={id => api.remove('dkt_cash_items', id, 'costs')} />
            </TabsContent>
            <TabsContent value="loans" className="mt-4">
              <LoansTab loans={data.loans} payments={data.loanPayments} orders={data.orders} odooOrders={odoo.rows} thisMonth={thisMonth}
                addLoan={() => api.insert('dkt_loans', { name: 'New loan', kind: 'lump' })}
                updateLoan={(id, p) => api.update('dkt_loans', id, p, 'loans')}
                removeLoan={id => api.remove('dkt_loans', id, 'loans')}
                addPayment={loanId => api.insert('dkt_loan_payments', { loan_id: loanId, due_date: `${thisMonth}-01` })}
                updatePayment={(id, p) => api.update('dkt_loan_payments', id, p, 'loanPayments')}
                removePayment={id => api.remove('dkt_loan_payments', id, 'loanPayments')} />
            </TabsContent>
            <TabsContent value="credit" className="mt-4">
              <CreditTab lines={data.creditLines} draws={data.creditDraws} forecast={forecast} thisMonth={thisMonth} horizon={horizon}
                addLine={() => api.insert('dkt_credit_lines', { name: '' })}
                updateLine={(id, p) => api.update('dkt_credit_lines', id, p, 'creditLines')}
                removeLine={id => api.remove('dkt_credit_lines', id, 'creditLines')}
                addDraw={row => api.insert('dkt_credit_draws', row)}
                updateDraw={(id, p) => api.update('dkt_credit_draws', id, p, 'creditDraws')}
                removeDraw={id => api.remove('dkt_credit_draws', id, 'creditDraws')} />
            </TabsContent>
            <TabsContent value="amazon" className="mt-4">
              <AmazonTab scenarios={data.scenarios} skus={data.skus} thisMonth={thisMonth} lookahead={lookahead}
                addScenario={() => api.insert('dkt_amazon_scenarios', { name: 'New scenario', in_forecast: false })}
                duplicateScenario={sc => api.duplicateScenario(sc, data.skus)}
                updateScenario={(id, p) => api.update('dkt_amazon_scenarios', id, p, 'scenarios')}
                removeScenario={id => api.remove('dkt_amazon_scenarios', id, 'scenarios')}
                addSku={(scenarioId, mode) => api.insert('dkt_amazon_skus', { scenario_id: scenarioId, mode, name: '', start_month: mode === 'simple' ? thisMonth : addMonths(thisMonth, 4) })}
                updateSku={(id, p) => api.update('dkt_amazon_skus', id, p, 'skus')}
                removeSku={id => api.remove('dkt_amazon_skus', id, 'skus')} />
            </TabsContent>
            <TabsContent value="allegro" className="mt-4">
              <AllegroTab settings={data.settings} saveSettings={api.saveSettings} thisMonth={thisMonth} lookahead={lookahead} skus={data.skus} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
