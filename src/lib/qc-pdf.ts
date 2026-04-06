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

// Fetch image as base64 data URL
async function fetchImageAsBase64(url: string): Promise<{ dataUrl: string; format: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        // Detect format from mime type
        const mime = blob.type || 'image/jpeg';
        const format = mime.includes('png') ? 'PNG' : 'JPEG';
        resolve({ dataUrl, format });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Pre-load all images in parallel
async function preloadImages(sections: QCSection[]): Promise<Map<string, { dataUrl: string; format: string }>> {
  const cache = new Map<string, { dataUrl: string; format: string }>();
  const urls = new Set<string>();

  for (const section of sections) {
    for (const row of section.rows) {
      for (const photo of row.photo_urls || []) {
        const url = typeof photo === 'string' ? photo : photo?.url;
        if (url) urls.add(url);
      }
    }
  }

  const results = await Promise.all(
    Array.from(urls).map(async (url) => {
      const result = await fetchImageAsBase64(url);
      return { url, result };
    })
  );

  for (const { url, result } of results) {
    if (result) cache.set(url, result);
  }

  return cache;
}

export async function generateQCPdf(guide: QCGuideData): Promise<jsPDF> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const colWidths = { label: 45, content: 115, check: 20 };
  const photoSize = 45;
  const photosPerRow = 2;
  const photoGap = 3;
  let y = margin;

  // Pre-load all images
  const imageCache = await preloadImages(guide.sections);

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
    if (y > 270) {
      doc.addPage();
      y = margin;
    }

    // Section header
    doc.setFillColor(230, 230, 230);
    doc.rect(margin, y, pageWidth - margin * 2, 7, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(section.name.toUpperCase(), margin + 2, y + 5);
    y += 9;

    for (const row of section.rows) {
      const photos = (row.photo_urls || []) as any[];
      const resolvedPhotos: { dataUrl: string; format: string }[] = [];
      for (const photo of photos) {
        const url = typeof photo === 'string' ? photo : photo?.url;
        if (url && imageCache.has(url)) {
          resolvedPhotos.push(imageCache.get(url)!);
        }
      }

      const textLines = row.text_content ? doc.splitTextToSize(row.text_content, colWidths.content - 4) : [];
      const textHeight = textLines.length * 4;

      // Photo grid dimensions
      const photoGridRows = Math.ceil(resolvedPhotos.length / photosPerRow);
      const photoHeight = resolvedPhotos.length > 0 ? photoGridRows * (photoSize + photoGap) + 2 : 0;

      const rowHeight = Math.max(8, textHeight + photoHeight + 4);

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

      // Content column — photos
      if (resolvedPhotos.length > 0) {
        let px = margin + colWidths.label + 2;
        let py = y + textHeight + 2;
        for (let i = 0; i < resolvedPhotos.length; i++) {
          try {
            doc.addImage(
              resolvedPhotos[i].dataUrl,
              resolvedPhotos[i].format,
              px, py,
              photoSize, photoSize
            );
          } catch {
            // If image fails to embed, show placeholder
            doc.setFontSize(6);
            doc.setTextColor(100, 100, 100);
            doc.text(`[Photo ${i + 1}]`, px + 2, py + 10);
            doc.setTextColor(0, 0, 0);
          }
          px += photoSize + photoGap;
          if ((i + 1) % photosPerRow === 0) {
            px = margin + colWidths.label + 2;
            py += photoSize + photoGap;
          }
        }
      }

      // Checkbox column
      const checkX = margin + colWidths.label + colWidths.content + (colWidths.check / 2) - 3;
      const checkY = y + (rowHeight / 2) - 3;
      doc.rect(checkX, checkY, 6, 6);

      y += rowHeight;
    }

    y += 4;
  }

  // Signature lines
  if (y > 240) {
    doc.addPage();
    y = margin;
  }
  y += 10;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Inspected by:', margin, y);
  doc.line(margin + 28, y, margin + 88, y);
  doc.text('Date:', margin + 95, y);
  doc.line(margin + 108, y, margin + 148, y);
  y += 12;
  doc.text('Approved by:', margin, y);
  doc.line(margin + 28, y, margin + 88, y);
  doc.text('Date:', margin + 95, y);
  doc.line(margin + 108, y, margin + 148, y);

  return doc;
}
