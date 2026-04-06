// Default sections and rows for a new QC guide

export interface DefaultRow {
  label: string;
  text_content?: string;
}

export interface DefaultSection {
  name: string;
  rows: DefaultRow[];
}

export const DEFAULT_SECTIONS: DefaultSection[] = [
  {
    name: 'Dimensions',
    rows: [
      { label: 'Size', text_content: '' },
    ],
  },
  {
    name: 'Wood Quality',
    rows: [
      { label: 'Approved woods', text_content: '' },
      { label: 'Wood moisture', text_content: '5–12%' },
      { label: 'No bug holes' },
      { label: 'No end cracks' },
      { label: 'No unfilled cracks or knots' },
      { label: 'No cracks >1mm thick' },
      { label: 'No knots >25mm' },
      { label: 'Approved fillers only', text_content: '' },
      { label: 'Filler color must match surrounding wood' },
    ],
  },
  {
    name: 'Surface',
    rows: [
      { label: 'Wood smooth — no holes or tear-out' },
      { label: 'No protruding nails or screws' },
    ],
  },
  {
    name: 'Joints',
    rows: [
      { label: 'Joint smooth (no height difference between pieces)' },
      { label: 'No visible glue at joint' },
      { label: 'Non-mechanical joint filler <1mm' },
    ],
  },
  {
    name: 'Function',
    rows: [
      { label: 'Function check', text_content: '' },
    ],
  },
  {
    name: 'Wood Finish',
    rows: [
      { label: 'No scratches/dents/marks' },
      { label: 'Filler color matching' },
      { label: 'No clouding or cracking in sealer/lacquer' },
      { label: 'Wood color reference photo', text_content: '' },
    ],
  },
  {
    name: 'Packaging QC',
    rows: [
      { label: 'Packing list', text_content: 'Product, Paper Inserts/Cards, Accessories/Hardware' },
      { label: 'Wrapping', text_content: 'Corrugate 2 Ply + Bubble Wrap' },
      { label: 'Cushion/Foam' },
      { label: 'Inner Carton Box Size', text_content: '' },
      { label: 'Box Ply', text_content: '3 or 5 ply' },
      { label: 'Labeling IC', text_content: 'One side, SKU label' },
      { label: 'Silica packet', text_content: '2g' },
      { label: 'Master Carton units per carton', text_content: '' },
      { label: 'Master Carton ply', text_content: '7 ply' },
      { label: 'MC moisture protection', text_content: 'Silica 2g' },
      { label: 'MC labeling', text_content: 'SKU on both sides' },
      { label: 'Standard shipping label both sides', text_content: 'Customer SKU#, Customer PO#, Invoice No, Description, Qty in Carton, Net Weight, Gross Weight, Size, Country of Origin, Carton No ___ out of ___, Consignee, Shipper' },
    ],
  },
];
