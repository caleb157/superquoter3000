import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { AlertTriangle, Loader2 } from 'lucide-react';

type GroupName =
  | 'Inquiries' | 'Products' | 'Vendors & Quotes'
  | 'Samples & Tasks' | 'Reference Data' | 'Analytics & Events' | 'Settings';

type ExportTable = {
  id: string;
  label: string;
  group: GroupName;
  description?: string;
  defaultSelected?: boolean;
};

const EXPORT_TABLES: ExportTable[] = [
  // Inquiries
  { id: 'customer_rfqs', label: 'Inquiries', group: 'Inquiries', description: 'Top-level inquiries with status, customer, PO info.', defaultSelected: true },
  { id: 'inquiry_received_rfqs', label: 'Received RFQs (log)', group: 'Inquiries', defaultSelected: true },
  { id: 'inquiry_received_rfs', label: 'Received RFS (log)', group: 'Inquiries', defaultSelected: true },
  { id: 'inquiry_status_events', label: 'Inquiry status events', group: 'Inquiries' },

  // Products and costing
  { id: 'products', label: 'Products', group: 'Products', defaultSelected: true },
  { id: 'product_variants', label: 'Product variants', group: 'Products' },
  { id: 'cogs_items', label: 'COGS items (BOM)', group: 'Products', defaultSelected: true },
  { id: 'non_unit_cogs', label: 'Non-unit COGS', group: 'Products', defaultSelected: true },
  { id: 'overhead_items', label: 'Overhead items (labor)', group: 'Products', defaultSelected: true },
  { id: 'shipping_items', label: 'Shipping items', group: 'Products', defaultSelected: true },
  { id: 'cbm_estimates', label: 'CBM estimates', group: 'Products', defaultSelected: true },
  { id: 'product_assemblies', label: 'Assemblies', group: 'Products' },
  { id: 'assembly_components', label: 'Assembly components', group: 'Products' },

  // Vendors & quotes
  { id: 'vendor_rfqs', label: 'Vendor RFQs', group: 'Vendors & Quotes', defaultSelected: true },
  { id: 'vendor_rfq_line_items', label: 'Vendor RFQ line items', group: 'Vendors & Quotes', defaultSelected: true },
  { id: 'vendor_rfq_responses', label: 'Vendor RFQ responses', group: 'Vendors & Quotes', defaultSelected: true },
  { id: 'quote_snapshots', label: 'Quote snapshots', group: 'Vendors & Quotes', defaultSelected: true },

  // Samples & tasks
  { id: 'samples', label: 'Samples', group: 'Samples & Tasks', defaultSelected: true },
  { id: 'tasks', label: 'Tasks', group: 'Samples & Tasks', defaultSelected: true },

  // Reference data
  { id: 'customers', label: 'Customers', group: 'Reference Data', defaultSelected: true },
  { id: 'vendors', label: 'Vendors', group: 'Reference Data', defaultSelected: true },
  { id: 'product_types', label: 'Product types', group: 'Reference Data' },
  { id: 'shipping_types', label: 'Shipping types', group: 'Reference Data' },
  { id: 'currencies', label: 'Currencies', group: 'Reference Data' },
  { id: 'finishing_difficulty', label: 'Finishing difficulty', group: 'Reference Data' },
  { id: 'cogs_categories', label: 'COGS categories', group: 'Reference Data' },
  { id: 'raw_material_costs', label: 'Raw material costs', group: 'Reference Data' },
  { id: 'local_transport_locations', label: 'Local transport locations', group: 'Reference Data' },
  { id: 'box_data', label: 'Box prices', group: 'Reference Data' },
  { id: 'chemical_prices', label: 'Chemical prices', group: 'Reference Data' },
  { id: 'wood_prices', label: 'Wood prices', group: 'Reference Data' },
  { id: 'hardware_prices', label: 'Hardware prices', group: 'Reference Data' },
  { id: 'labor_employees', label: 'Labor employees', group: 'Reference Data' },
  { id: 'company_entities', label: 'Company entities', group: 'Reference Data' },

  // Analytics & events
  { id: 'product_stage_events', label: 'Product stage events', group: 'Analytics & Events', description: 'Every stage transition. Can be large.' },
  { id: 'customer_lifecycle_events', label: 'Customer lifecycle events', group: 'Analytics & Events' },
  { id: 'customer_status_events', label: 'Customer status events', group: 'Analytics & Events' },

  // Settings
  { id: 'global_settings', label: 'Global settings', group: 'Settings' },
];

const GROUP_ORDER: GroupName[] = ['Inquiries', 'Products', 'Vendors & Quotes', 'Samples & Tasks', 'Reference Data', 'Analytics & Events', 'Settings'];

function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/?*\[\]:]/g, '_').slice(0, 31);
}

export default function DataExportSection() {
  const { user } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(EXPORT_TABLES.filter(t => t.defaultSelected).map(t => t.id))
  );
  const [rowCounts, setRowCounts] = useState<Record<string, number | null>>({});
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string>('');

  useEffect(() => {
    (async () => {
      const counts: Record<string, number | null> = {};
      await Promise.all(EXPORT_TABLES.map(async (t) => {
        try {
          const { count, error } = await (supabase as any)
            .from(t.id).select('*', { count: 'exact', head: true });
          counts[t.id] = error ? null : (count ?? 0);
        } catch {
          counts[t.id] = null;
        }
      }));
      setRowCounts(counts);
    })();
  }, []);

  const selectedTables = useMemo(
    () => EXPORT_TABLES.filter(t => selected.has(t.id)),
    [selected]
  );
  const totalRows = useMemo(
    () => selectedTables.reduce((sum, t) => sum + (rowCounts[t.id] ?? 0), 0),
    [selectedTables, rowCounts]
  );

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(EXPORT_TABLES.map(t => t.id)));
  const selectCommon = () => setSelected(new Set(EXPORT_TABLES.filter(t => t.defaultSelected).map(t => t.id)));
  const clearAll = () => setSelected(new Set());

  const fetchTable = async (id: string) => {
    const { data, error } = await (supabase as any).from(id).select('*');
    if (error) throw error;
    return data ?? [];
  };

  const generateXlsx = async () => {
    if (selectedTables.length === 0) { toast.error('Select at least one table.'); return; }
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const meta: any[][] = [
        ['Generated', new Date().toISOString()],
        ['By user', user?.email || 'unknown'],
        ['Source', 'SuperQuoter 3000 / DKT'],
        [],
        ['Sheet', 'Source table', 'Row count'],
        ...selectedTables.map(t => [sanitizeSheetName(t.label), t.id, rowCounts[t.id] ?? 0]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), '_meta');

      for (const table of selectedTables) {
        setProgress(`Fetching ${table.label}…`);
        try {
          const rows = await fetchTable(table.id);
          const sheet = rows.length > 0
            ? XLSX.utils.json_to_sheet(rows)
            : XLSX.utils.aoa_to_sheet([['(no rows)']]);
          XLSX.utils.book_append_sheet(wb, sheet, sanitizeSheetName(table.label));
        } catch (err: any) {
          toast.error(`Failed to fetch ${table.label}: ${err.message ?? err}`);
        }
      }
      setProgress('Writing file…');
      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `dkt_data_export_${date}.xlsx`);
      toast.success(`Exported ${selectedTables.length} tables.`);
    } catch (err: any) {
      toast.error('Export failed. Try selecting fewer tables.');
      console.error(err);
    } finally {
      setExporting(false);
      setProgress('');
    }
  };

  const generateZippedCsvs = async () => {
    if (selectedTables.length === 0) { toast.error('Select at least one table.'); return; }
    setExporting(true);
    try {
      const zip = new JSZip();
      const metaText = [
        `Generated: ${new Date().toISOString()}`,
        `By user: ${user?.email || 'unknown'}`,
        `Source: SuperQuoter 3000 / DKT`,
        ``,
        `Tables included:`,
        ...selectedTables.map(t => `  - ${t.id} (${rowCounts[t.id] ?? 0} rows) → ${t.id}.csv`),
      ].join('\n');
      zip.file('_meta.txt', metaText);

      for (const table of selectedTables) {
        setProgress(`Fetching ${table.label}…`);
        try {
          const rows = await fetchTable(table.id);
          const sheet = rows.length > 0
            ? XLSX.utils.json_to_sheet(rows)
            : XLSX.utils.aoa_to_sheet([['(no rows)']]);
          const csv = XLSX.utils.sheet_to_csv(sheet);
          zip.file(`${table.id}.csv`, csv);
        } catch (err: any) {
          zip.file(`_errors/${table.id}.error.txt`, `Failed: ${err.message ?? err}`);
        }
      }

      setProgress('Zipping…');
      const blob = await zip.generateAsync({ type: 'blob' });
      const date = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dkt_data_export_${date}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${selectedTables.length} tables as CSVs.`);
    } catch (err: any) {
      toast.error('Export failed. Try selecting fewer tables.');
      console.error(err);
    } finally {
      setExporting(false);
      setProgress('');
    }
  };

  const showLargeWarning = totalRows > 100_000;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Data Export</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Download a snapshot of any tables in the system as a multi-sheet XLSX workbook.
          Each selected table becomes one sheet. Snapshots are point-in-time — they don't update after download.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={selectAll} disabled={exporting}>Select all</Button>
        <Button size="sm" variant="outline" onClick={selectCommon} disabled={exporting}>Select common</Button>
        <Button size="sm" variant="outline" onClick={clearAll} disabled={exporting}>Clear selection</Button>
      </div>

      <div className="space-y-5">
        {GROUP_ORDER.map(group => {
          const items = EXPORT_TABLES.filter(t => t.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">{group}</h3>
              <div className="border rounded-md divide-y">
                {items.map(t => {
                  const count = rowCounts[t.id];
                  const inaccessible = count === null;
                  return (
                    <label
                      key={t.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selected.has(t.id)}
                        onCheckedChange={() => toggle(t.id)}
                        disabled={exporting || inaccessible}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{t.label}</div>
                        {t.description && (
                          <div className="text-xs text-muted-foreground">{t.description}</div>
                        )}
                        <div className="text-[10px] text-muted-foreground font-mono">{t.id}</div>
                      </div>
                      {inaccessible ? (
                        <span title="Table inaccessible" className="flex items-center text-muted-foreground">
                          <AlertTriangle className="h-3.5 w-3.5 mr-1" /> —
                        </span>
                      ) : (
                        <Badge variant="secondary" className="font-mono">
                          {count === undefined ? '…' : count.toLocaleString()}
                        </Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t pt-4 space-y-3 sticky bottom-0 bg-background">
        <div className="text-sm text-muted-foreground">
          Selected: <span className="font-semibold text-foreground">{selectedTables.length}</span> tables ·
          approximately <span className="font-semibold text-foreground">{totalRows.toLocaleString()}</span> rows
        </div>
        {showLargeWarning && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Large export (~{totalRows.toLocaleString()} rows). Browser may pause for 10-30s while assembling.
              Consider zipped CSVs for very large exports.
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={generateXlsx} disabled={exporting || selectedTables.length === 0}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Download as XLSX
          </Button>
          <Button variant="outline" onClick={generateZippedCsvs} disabled={exporting || selectedTables.length === 0}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Download as zipped CSVs
          </Button>
          {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
        </div>
      </div>
    </div>
  );
}
