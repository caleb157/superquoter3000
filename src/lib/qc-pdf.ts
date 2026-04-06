import jsPDF from 'jspdf';
import 'jspdf-autotable';

interface QCRow {
  label: string;
  text_content?: string | null;
  photo_urls?: any[];
}

interface QCSection {
  name: string;
  rows: QCRow[];
}

interface QCGuideData {
  title: string;
  sections: QCSection[];
}

export async function generateQCPdf(guide: QCGuideData): Promise<jsPDF> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const colWidths = { label: 45, content: 115, check: 20 };
  let y = margin;

  // Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(guide.title, margin, y + 6);
  y += 14;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, y);
  y += 8;

  for (const section of guide.sections) {
    // Check space for section header
    if (y > 270) {
      doc.addPage();
      y = margin;
    }

    // Section header — full width
    doc.setFillColor(230, 230, 230);
    doc.rect(margin, y, pageWidth - margin * 2, 7, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(section.name.toUpperCase(), margin + 2, y + 5);
    y += 9;

    for (const row of section.rows) {
      const photos = (row.photo_urls || []) as string[];
      const hasPhotos = photos.length > 0;
      const textLines = row.text_content ? doc.splitTextToSize(row.text_content, colWidths.content - 4) : [];
      
      // Calculate row height
      const photoRows = Math.ceil(photos.length / 3);
      const photoHeight = hasPhotos ? photoRows * 22 : 0;
      const textHeight = textLines.length * 4;
      const rowHeight = Math.max(8, photoHeight + textHeight + 4);

      if (y + rowHeight > 280) {
        doc.addPage();
        y = margin;
      }

      // Draw row borders
      doc.setDrawColor(200, 200, 200);
      doc.rect(margin, y, colWidths.label, rowHeight);
      doc.rect(margin + colWidths.label, y, colWidths.content, rowHeight);
      doc.rect(margin + colWidths.label + colWidths.content, y, colWidths.check, rowHeight);

      // Label column
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      const labelLines = doc.splitTextToSize(row.label, colWidths.label - 4);
      doc.text(labelLines, margin + 2, y + 5);

      // Content column — text
      doc.setFont('helvetica', 'normal');
      if (textLines.length > 0) {
        doc.text(textLines, margin + colWidths.label + 2, y + 5);
      }

      // Photos — load and embed
      if (hasPhotos) {
        let px = margin + colWidths.label + 2;
        let py = y + textHeight + 2;
        for (let i = 0; i < photos.length && i < 6; i++) {
          try {
            // For photos that are URLs, we'll try to embed them
            const url = typeof photos[i] === 'string' ? photos[i] : (photos[i] as any)?.url;
            if (url) {
              // jsPDF addImage from URL requires base64 — skip for now, show placeholder
              doc.setFontSize(6);
              doc.setTextColor(100, 100, 100);
              doc.text(`[Photo ${i + 1}]`, px, py + 10);
              doc.setTextColor(0, 0, 0);
            }
          } catch {
            // skip
          }
          px += 36;
          if ((i + 1) % 3 === 0) {
            px = margin + colWidths.label + 2;
            py += 22;
          }
        }
      }

      // Checkbox column — draw empty checkbox
      const checkX = margin + colWidths.label + colWidths.content + (colWidths.check / 2) - 3;
      const checkY = y + (rowHeight / 2) - 3;
      doc.rect(checkX, checkY, 6, 6);

      y += rowHeight;
    }

    y += 4;
  }

  // Signature lines
  if (y > 250) {
    doc.addPage();
    y = margin;
  }
  y += 10;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Inspected by: _________________________  Date: _______________', margin, y);
  y += 10;
  doc.text('Approved by: _________________________  Date: _______________', margin, y);

  return doc;
}
