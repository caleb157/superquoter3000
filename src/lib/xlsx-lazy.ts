// The spreadsheet library is large (about 140 KB zipped) and only needed when a file is
// actually read or written, so it is downloaded at that moment rather than with every
// page that has an Export or Import button.
let lib: Promise<typeof import('xlsx')> | null = null;

export function loadXlsx(): Promise<typeof import('xlsx')> {
  lib ??= import('xlsx').catch((e) => { lib = null; throw e; });
  return lib;
}
