// Project export utilities: Excel, Summary PDF, Customer Quote PDF
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ExportProduct {
  name: string;
  sku: string | null;
  quantity: number;
  unit_cbm: number;
  total_cbm: number;
  unit_cost_inr: number;
  unit_cost_usd: number;
  unit_price_usd: number;
  total_cost_usd: number;
  total_revenue_usd: number;
  total_profit_usd: number;
  gpm: number;
  npm: number;
  target_price_usd: number | null;
  remaining_to_target_inr: number | null;
  total_direct_mh: number;
  total_cogs: number;
  total_direct_oh: number;
  total_indirect_oh: number;
  total_shipping: number;
  review_count: number;
  markup_percent: number;
  // Product details for full export
  width_inch?: number;
  depth_inch?: number;
  height_inch?: number;
  weight_kg?: number;
  finishing_difficulty?: string;
  cbm_done?: boolean;
  cogs_done?: boolean;
  overhead_done?: boolean;
  shipping_done?: boolean;
  revenue_done?: boolean;
}

export interface ExportAggregates {
  skuCount: number;
  totalQty: number;
  totalCbm: number;
  totalCost: number;
  totalRevenue: number;
  totalProfit: number;
  weightedGpm: number;
  weightedNpm: number;
  totalMh: number;
  totalReview: number;
  fullyCosted: number;
  bCogs: number;
  bDoh: number;
  bIoh: number;
  bShip: number;
  bTotal: number;
}

export interface ExportContext {
  projectName: string;
  customerName?: string;
  products: ExportProduct[];
  aggregates: ExportAggregates;
  exchangeRate: number;
  quoteTitle?: string;
  quoteNotes?: string;
  quoteValidityDays?: number;
  quoteCurrency?: string;
  showCbm?: boolean;
  showDimensions?: boolean;
  showWeight?: boolean;
  showSku?: boolean;
}

// ============================================================
// Export to Excel
// ============================================================

export function exportToExcel(ctx: ExportContext) {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = ctx.products.map(p => ({
    'Product': p.name,
    'SKU': p.sku || '',
    'Qty': p.quantity,
    'Unit CBM': Number(p.unit_cbm.toFixed(4)),
    'Total CBM': Number(p.total_cbm.toFixed(2)),
    'Unit Cost (₹)': Number(p.unit_cost_inr.toFixed(2)),
    'Unit Cost ($)': Number(p.unit_cost_usd.toFixed(2)),
    'Unit Price ($)': Number(p.unit_price_usd.toFixed(2)),
    'Markup %': Number((p.markup_percent * 100).toFixed(1)),
    'Total Cost ($)': Number(p.total_cost_usd.toFixed(2)),
    'Total Revenue ($)': Number(p.total_revenue_usd.toFixed(2)),
    'Total Profit ($)': Number(p.total_profit_usd.toFixed(2)),
    'GPM %': Number((p.gpm * 100).toFixed(1)),
    'NPM %': Number((p.npm * 100).toFixed(1)),
    'Target Price ($)': p.target_price_usd ?? '',
    'Remaining to Target (₹)': p.remaining_to_target_inr != null ? Number(p.remaining_to_target_inr.toFixed(2)) : '',
    'Direct MH': Number(p.total_direct_mh.toFixed(1)),
    'COGS (₹)': Number(p.total_cogs.toFixed(2)),
    'Direct OH (₹)': Number(p.total_direct_oh.toFixed(2)),
    'Indirect OH (₹)': Number(p.total_indirect_oh.toFixed(2)),
    'Shipping (₹)': Number(p.total_shipping.toFixed(2)),
    'Reviews': p.review_count,
  }));

  // Add totals row
  const agg = ctx.aggregates;
  summaryData.push({
    'Product': 'TOTALS',
    'SKU': `${agg.skuCount} SKUs`,
    'Qty': agg.totalQty,
    'Unit CBM': 0,
    'Total CBM': Number(agg.totalCbm.toFixed(2)),
    'Unit Cost (₹)': 0,
    'Unit Cost ($)': 0,
    'Unit Price ($)': 0,
    'Markup %': 0,
    'Total Cost ($)': Number(agg.totalCost.toFixed(2)),
    'Total Revenue ($)': Number(agg.totalRevenue.toFixed(2)),
    'Total Profit ($)': Number(agg.totalProfit.toFixed(2)),
    'GPM %': Number((agg.weightedGpm * 100).toFixed(1)),
    'NPM %': Number((agg.weightedNpm * 100).toFixed(1)),
    'Target Price ($)': '',
    'Remaining to Target (₹)': '',
    'Direct MH': Number(agg.totalMh.toFixed(1)),
    'COGS (₹)': Number(agg.bCogs.toFixed(2)),
    'Direct OH (₹)': Number(agg.bDoh.toFixed(2)),
    'Indirect OH (₹)': Number(agg.bIoh.toFixed(2)),
    'Shipping (₹)': Number(agg.bShip.toFixed(2)),
    'Reviews': agg.totalReview,
  });

  const ws = XLSX.utils.json_to_sheet(summaryData);

  // Set column widths
  ws['!cols'] = [
    { wch: 25 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
    { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 20 },
    { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Summary');

  // Container sheet
  const containerData = [
    { 'Container': '20ft', 'Capacity (CBM)': 33, 'Used (CBM)': Number(agg.totalCbm.toFixed(2)), 'Fill %': Number(((agg.totalCbm / 33) * 100).toFixed(1)) },
    { 'Container': '40ft', 'Capacity (CBM)': 67, 'Used (CBM)': Number(agg.totalCbm.toFixed(2)), 'Fill %': Number(((agg.totalCbm / 67) * 100).toFixed(1)) },
    { 'Container': '40ft HC', 'Capacity (CBM)': 76, 'Used (CBM)': Number(agg.totalCbm.toFixed(2)), 'Fill %': Number(((agg.totalCbm / 76) * 100).toFixed(1)) },
  ];
  const ws2 = XLSX.utils.json_to_sheet(containerData);
  ws2['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Container Fill');

  // Cost breakdown sheet
  const breakdownData = [
    { 'Category': 'COGS', 'Total (₹)': Number(agg.bCogs.toFixed(2)), '% of Total': agg.bTotal > 0 ? Number(((agg.bCogs / agg.bTotal) * 100).toFixed(1)) : 0 },
    { 'Category': 'Direct Overhead', 'Total (₹)': Number(agg.bDoh.toFixed(2)), '% of Total': agg.bTotal > 0 ? Number(((agg.bDoh / agg.bTotal) * 100).toFixed(1)) : 0 },
    { 'Category': 'Indirect Overhead', 'Total (₹)': Number(agg.bIoh.toFixed(2)), '% of Total': agg.bTotal > 0 ? Number(((agg.bIoh / agg.bTotal) * 100).toFixed(1)) : 0 },
    { 'Category': 'Shipping', 'Total (₹)': Number(agg.bShip.toFixed(2)), '% of Total': agg.bTotal > 0 ? Number(((agg.bShip / agg.bTotal) * 100).toFixed(1)) : 0 },
    { 'Category': 'TOTAL', 'Total (₹)': Number(agg.bTotal.toFixed(2)), '% of Total': 100 },
  ];
  const ws3 = XLSX.utils.json_to_sheet(breakdownData);
  ws3['!cols'] = [{ wch: 18 }, { wch: 15 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Cost Breakdown');

  const filename = `${ctx.projectName.replace(/[^a-zA-Z0-9]/g, '_')}_export.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ============================================================
// Summary PDF (Internal — shows costs, margins, everything)
// ============================================================

export function downloadSummaryPDF(ctx: ExportContext) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const agg = ctx.aggregates;

  // Title
  doc.setFontSize(14);
  doc.text(ctx.projectName, 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Internal Cost Summary • ${new Date().toLocaleDateString()} • ${agg.skuCount} SKUs`, 14, 21);
  if (ctx.customerName) doc.text(`Customer: ${ctx.customerName}`, 14, 26);
  doc.setTextColor(0);

  // Aggregate cards row
  const cardY = ctx.customerName ? 30 : 26;
  doc.setFontSize(7);
  doc.setTextColor(100);
  const cards = [
    { label: 'Total CBM', value: agg.totalCbm.toFixed(2) },
    { label: 'Total Cost ($)', value: `$${agg.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` },
    { label: 'Total Revenue ($)', value: `$${agg.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` },
    { label: 'Total Profit ($)', value: `$${agg.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` },
    { label: 'GPM', value: `${(agg.weightedGpm * 100).toFixed(1)}%` },
    { label: 'NPM', value: `${(agg.weightedNpm * 100).toFixed(1)}%` },
    { label: 'Man-Hours', value: agg.totalMh.toFixed(0) },
    { label: 'Progress', value: `${agg.fullyCosted}/${ctx.products.length}` },
  ];
  const cardW = (pageW - 28) / cards.length;
  cards.forEach((c, i) => {
    const x = 14 + i * cardW;
    doc.setFontSize(6);
    doc.setTextColor(120);
    doc.text(c.label, x, cardY);
    doc.setFontSize(9);
    doc.setTextColor(0);
    doc.text(c.value, x, cardY + 4);
  });

  // Container fill
  doc.setFontSize(6);
  doc.setTextColor(120);
  const containerText = `Container: ${((agg.totalCbm / 33) * 100).toFixed(0)}% 20ft | ${((agg.totalCbm / 67) * 100).toFixed(0)}% 40ft | ${((agg.totalCbm / 76) * 100).toFixed(0)}% 40ft HC`;
  doc.text(containerText, 14, cardY + 9);

  // Products table
  const tableY = cardY + 13;
  const tableHeaders = ['Product', 'SKU', 'Qty', 'Unit CBM', 'Total CBM', 'Cost (₹)', 'Cost ($)', 'Price ($)', 'Total Cost ($)', 'Total Rev ($)', 'Profit ($)', 'GPM%', 'NPM%', 'Target ($)'];

  const tableData = ctx.products.map(p => [
    p.name,
    p.sku || '—',
    p.quantity.toString(),
    p.unit_cbm.toFixed(4),
    p.total_cbm.toFixed(2),
    `₹${p.unit_cost_inr.toFixed(0)}`,
    `$${p.unit_cost_usd.toFixed(2)}`,
    `$${p.unit_price_usd.toFixed(2)}`,
    `$${p.total_cost_usd.toFixed(0)}`,
    `$${p.total_revenue_usd.toFixed(0)}`,
    `$${p.total_profit_usd.toFixed(0)}`,
    `${(p.gpm * 100).toFixed(1)}%`,
    `${(p.npm * 100).toFixed(1)}%`,
    p.target_price_usd ? `$${p.target_price_usd.toFixed(2)}` : '—',
  ]);

  // Totals row
  tableData.push([
    'TOTALS', `${agg.skuCount} SKUs`, agg.totalQty.toString(), '', agg.totalCbm.toFixed(2),
    '', '', '', `$${agg.totalCost.toFixed(0)}`, `$${agg.totalRevenue.toFixed(0)}`,
    `$${agg.totalProfit.toFixed(0)}`, `${(agg.weightedGpm * 100).toFixed(1)}%`, `${(agg.weightedNpm * 100).toFixed(1)}%`, '',
  ]);

  autoTable(doc, {
    startY: tableY,
    head: [tableHeaders],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 6.5, cellPadding: 1.5, font: 'helvetica' },
    headStyles: { fillColor: [41, 65, 94], fontSize: 6, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 35 },
      2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
      5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
      8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' },
      11: { halign: 'right' }, 12: { halign: 'right' }, 13: { halign: 'right' },
    },
    didParseCell: (data) => {
      // Bold totals row
      if (data.row.index === tableData.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [240, 240, 240];
      }
    },
  });

  // Cost breakdown on same page if fits, else new page
  const finalY = (doc as any).lastAutoTable?.finalY || tableY + 50;
  if (finalY + 30 > doc.internal.pageSize.getHeight()) doc.addPage();
  const breakdownY = finalY + 8 > doc.internal.pageSize.getHeight() ? 15 : finalY + 8;

  doc.setFontSize(8);
  doc.setTextColor(0);
  doc.text('Cost Breakdown', 14, breakdownY);

  autoTable(doc, {
    startY: breakdownY + 3,
    head: [['Category', 'Total (₹)', '% of Total']],
    body: [
      ['COGS', `₹${agg.bCogs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, agg.bTotal > 0 ? `${((agg.bCogs / agg.bTotal) * 100).toFixed(1)}%` : '—'],
      ['Direct Overhead', `₹${agg.bDoh.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, agg.bTotal > 0 ? `${((agg.bDoh / agg.bTotal) * 100).toFixed(1)}%` : '—'],
      ['Indirect Overhead', `₹${agg.bIoh.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, agg.bTotal > 0 ? `${((agg.bIoh / agg.bTotal) * 100).toFixed(1)}%` : '—'],
      ['Shipping', `₹${agg.bShip.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, agg.bTotal > 0 ? `${((agg.bShip / agg.bTotal) * 100).toFixed(1)}%` : '—'],
      ['TOTAL', `₹${agg.bTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, '100%'],
    ],
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [41, 65, 94], fontSize: 6.5 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    tableWidth: 100,
    didParseCell: (data) => {
      if (data.row.index === 4) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [240, 240, 240];
      }
    },
  });

  const filename = `${ctx.projectName.replace(/[^a-zA-Z0-9]/g, '_')}_summary.pdf`;
  doc.save(filename);
}

// ============================================================
// Customer Quote PDF (No costs, margins, vendor info)
// ============================================================

export function generateCustomerQuotePDF(ctx: ExportContext) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const currency = ctx.quoteCurrency || 'USD';
  const symbol = currency === 'INR' ? '₹' : '$';

  // Header
  doc.setFontSize(16);
  doc.text(ctx.quoteTitle || `${ctx.projectName} — Price List`, 14, 20);

  doc.setFontSize(9);
  doc.setTextColor(100);
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text(dateStr, 14, 27);
  if (ctx.customerName) doc.text(`Prepared for: ${ctx.customerName}`, 14, 32);
  doc.setTextColor(0);

  const startY = ctx.customerName ? 38 : 33;

  // Build columns dynamically based on settings
  const headers: string[] = [];
  const colKeys: string[] = [];

  headers.push('Product');
  colKeys.push('name');

  if (ctx.showSku !== false) { headers.push('SKU'); colKeys.push('sku'); }
  
  headers.push('Qty');
  colKeys.push('qty');

  if (ctx.showDimensions) { headers.push('Dimensions'); colKeys.push('dims'); }
  if (ctx.showWeight) { headers.push('Weight (kg)'); colKeys.push('weight'); }
  if (ctx.showCbm !== false) { headers.push('Unit CBM'); colKeys.push('cbm'); }

  headers.push(`Unit Price (${symbol})`);
  colKeys.push('price');

  headers.push(`Total (${symbol})`);
  colKeys.push('total');

  const tableData = ctx.products.map(p => {
    const row: string[] = [];
    colKeys.forEach(k => {
      switch (k) {
        case 'name': row.push(p.name); break;
        case 'sku': row.push(p.sku || '—'); break;
        case 'qty': row.push(p.quantity.toString()); break;
        case 'dims': row.push(p.width_inch ? `${p.width_inch}×${p.depth_inch}×${p.height_inch}"` : '—'); break;
        case 'weight': row.push(p.weight_kg ? p.weight_kg.toFixed(1) : '—'); break;
        case 'cbm': row.push(p.unit_cbm.toFixed(4)); break;
        case 'price': {
          const val = currency === 'INR' ? p.unit_price_usd * ctx.exchangeRate : p.unit_price_usd;
          row.push(`${symbol}${val.toFixed(2)}`);
          break;
        }
        case 'total': {
          const val = currency === 'INR' ? p.unit_price_usd * ctx.exchangeRate * p.quantity : p.unit_price_usd * p.quantity;
          row.push(`${symbol}${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
          break;
        }
      }
    });
    return row;
  });

  // Grand total row
  const grandTotal = ctx.products.reduce((s, p) => {
    const val = currency === 'INR' ? p.unit_price_usd * ctx.exchangeRate * p.quantity : p.unit_price_usd * p.quantity;
    return s + val;
  }, 0);
  const totalRow = colKeys.map((k, i) => {
    if (i === 0) return 'TOTAL';
    if (k === 'qty') return ctx.aggregates.totalQty.toString();
    if (k === 'total') return `${symbol}${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (k === 'cbm') return ctx.aggregates.totalCbm.toFixed(2);
    return '';
  });
  tableData.push(totalRow);

  // Align numeric columns right
  const colStyles: Record<number, any> = {};
  colKeys.forEach((k, i) => {
    if (['qty', 'cbm', 'weight', 'price', 'total'].includes(k)) {
      colStyles[i] = { halign: 'right' as const };
    }
  });
  colStyles[0] = { cellWidth: 40 };

  autoTable(doc, {
    startY,
    head: [headers],
    body: tableData,
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [41, 65, 94], fontSize: 7.5, fontStyle: 'bold' },
    columnStyles: colStyles,
    didParseCell: (data) => {
      if (data.row.index === tableData.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [230, 236, 242];
      }
    },
  });

  // Notes / Terms
  const finalY = (doc as any).lastAutoTable?.finalY || startY + 50;
  let notesY = finalY + 10;

  if (ctx.quoteValidityDays) {
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`Quote valid for ${ctx.quoteValidityDays} days from date of issue.`, 14, notesY);
    notesY += 6;
  }

  if (ctx.quoteNotes) {
    doc.setFontSize(7.5);
    doc.setTextColor(80);
    const lines = doc.splitTextToSize(ctx.quoteNotes, pageW - 28);
    doc.text(lines, 14, notesY);
  }

  // Footer with exchange rate
  if (currency === 'INR') {
    doc.setFontSize(6.5);
    doc.setTextColor(150);
    doc.text(`Exchange rate: ₹${ctx.exchangeRate}/USD`, 14, doc.internal.pageSize.getHeight() - 10);
  }

  const filename = `${ctx.projectName.replace(/[^a-zA-Z0-9]/g, '_')}_quote.pdf`;
  doc.save(filename);
}
