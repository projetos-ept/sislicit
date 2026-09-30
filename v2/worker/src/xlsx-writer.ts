// Gerador de .xlsx sem dependências externas.
//
// Por quê: a lib `xlsx` (SheetJS) na versão gratuita (Community Edition)
// só escreve dados — cores, fontes e bordas na escrita de células são
// recurso exclusivo da versão paga (Pro). Isso produzia planilhas "capadas"
// (sem cor de categoria, sem cabeçalho destacado, sem total formatado).
// Este módulo monta o pacote OOXML (.xlsx é um .zip com XMLs) na mão,
// com controle total do estilo — inclusive as mesmas cores de categoria
// já usadas na tela (cat_cor / cat_cor_borda / cat_cor_texto).

// ── ZIP (método "stored", sem compressão — simples e sempre válido) ────────────

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crc32Table();

function crc32(buf: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u16(arr: number[], v: number) { arr.push(v & 0xFF, (v >>> 8) & 0xFF); }
function u32(arr: number[], v: number) { arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); }

export function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const localEntries: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const lh: number[] = [];
    u32(lh, 0x04034b50); u16(lh, 20); u16(lh, 0); u16(lh, 0); u16(lh, 0); u16(lh, 0x21);
    u32(lh, crc); u32(lh, size); u32(lh, size); u16(lh, nameBytes.length); u16(lh, 0);
    const localHeader = new Uint8Array(lh);
    const localEntry = new Uint8Array(localHeader.length + nameBytes.length + f.data.length);
    localEntry.set(localHeader, 0);
    localEntry.set(nameBytes, localHeader.length);
    localEntry.set(f.data, localHeader.length + nameBytes.length);
    localEntries.push(localEntry);

    const ch: number[] = [];
    u32(ch, 0x02014b50); u16(ch, 20); u16(ch, 20); u16(ch, 0); u16(ch, 0); u16(ch, 0); u16(ch, 0x21);
    u32(ch, crc); u32(ch, size); u32(ch, size); u16(ch, nameBytes.length); u16(ch, 0); u16(ch, 0);
    u16(ch, 0); u16(ch, 0); u32(ch, 0); u32(ch, offset);
    const centralHeader = new Uint8Array(ch);
    const centralEntry = new Uint8Array(centralHeader.length + nameBytes.length);
    centralEntry.set(centralHeader, 0);
    centralEntry.set(nameBytes, centralHeader.length);
    centralEntries.push(centralEntry);

    offset += localEntry.length;
  }

  const centralStart = offset;
  const centralSize = centralEntries.reduce((s, c) => s + c.length, 0);

  const end: number[] = [];
  u32(end, 0x06054b50); u16(end, 0); u16(end, 0);
  u16(end, files.length); u16(end, files.length);
  u32(end, centralSize); u32(end, centralStart); u16(end, 0);

  const out = new Uint8Array(offset + centralSize + end.length);
  let pos = 0;
  for (const p of localEntries) { out.set(p, pos); pos += p.length; }
  for (const p of centralEntries) { out.set(p, pos); pos += p.length; }
  out.set(new Uint8Array(end), pos);
  return out;
}

// ── Folha de estilos (fontes/preenchimentos/bordas deduplicados) ───────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class StyleSheet {
  private fonts: string[] = ['<font><sz val="10"/><color rgb="FF14161F"/><name val="Calibri"/></font>'];
  private fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private fontCache = new Map<string, number>();
  private fillCache = new Map<string, number>();
  private xfCache = new Map<string, number>();
  readonly borderThin: number;
  readonly borderNone = 0;

  constructor() {
    this.borders.push('<border><left style="thin"><color rgb="FFCCCCCC"/></left><right style="thin"><color rgb="FFCCCCCC"/></right><top style="thin"><color rgb="FFCCCCCC"/></top><bottom style="thin"><color rgb="FFCCCCCC"/></bottom></border>');
    this.borderThin = 1;
  }

  font(opts: { bold?: boolean; color: string; size?: number }): number {
    const key = `${opts.bold ? 1 : 0}|${opts.color}|${opts.size ?? 10}`;
    const cached = this.fontCache.get(key);
    if (cached !== undefined) return cached;
    const idx = this.fonts.length;
    this.fonts.push(`<font>${opts.bold ? '<b val="1"/>' : ''}<sz val="${opts.size ?? 10}"/><color rgb="FF${opts.color}"/><name val="Calibri"/></font>`);
    this.fontCache.set(key, idx);
    return idx;
  }

  fill(color: string): number {
    const cached = this.fillCache.get(color);
    if (cached !== undefined) return cached;
    const idx = this.fills.length;
    this.fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor rgb="FF${color}"/></patternFill></fill>`);
    this.fillCache.set(color, idx);
    return idx;
  }

  xf(opts: { fontId?: number; fillId?: number; borderId?: number; align?: 'left' | 'right' | 'center'; valign?: 'top' | 'center'; wrap?: boolean; numFmtId?: number }): number {
    const key = JSON.stringify(opts);
    const cached = this.xfCache.get(key);
    if (cached !== undefined) return cached;
    const idx = this.xfs.length;
    const hasAlign = !!(opts.align || opts.valign || opts.wrap);
    const alignAttrs = [
      opts.align ? `horizontal="${opts.align}"` : '',
      opts.valign ? `vertical="${opts.valign}"` : '',
      opts.wrap ? 'wrapText="1"' : '',
    ].filter(Boolean).join(' ');
    const body = hasAlign ? `<alignment ${alignAttrs}/>` : '';
    this.xfs.push(
      `<xf numFmtId="${opts.numFmtId ?? 0}" fontId="${opts.fontId ?? 0}" fillId="${opts.fillId ?? 0}" borderId="${opts.borderId ?? 0}" xfId="0"${hasAlign ? ' applyAlignment="1"' : ''}${body ? `>${body}</xf>` : '/>'}`
    );
    this.xfCache.set(key, idx);
    return idx;
  }

  toXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills><borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

// ── Geração da planilha ─────────────────────────────────────────────────────────

export type ItemParaExportar = {
  n: number;
  item: string;
  descricao: string | null;
  unidade: string | null;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  cat_nome?: string | null;
  cat_cor?: string | null;
  cat_cor_borda?: string | null;
  cat_cor_texto?: string | null;
};

const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const CUR_FMT = 4; // built-in "#,##0.00", nenhuma declaração extra necessária

function colLabel(i: number, r: number) { return `${COL_LETTERS[i]}${r}`; }

export function gerarXlsxPlanilha(titulo: string, itens: ItemParaExportar[], total: number): Uint8Array {
  const st = new StyleSheet();

  const whiteBold = st.font({ bold: true, color: 'FFFFFF', size: 13 });
  const headerFont = st.font({ bold: true, color: 'FFFFFF', size: 10 });
  const headerFill = st.fill('2D3748');
  const titleFill = st.fill('1A1814');
  const totalFill = st.fill('E8F0EA');
  const totalFontLabel = st.font({ bold: true, color: '1A1814', size: 10 });
  const totalFontValor = st.font({ bold: true, color: '1A5C1A', size: 10 });
  const neutralFill = st.fill('FFFFFF');
  const neutralFont = st.font({ color: '333333', size: 10 });
  const neutralFontBold = st.font({ bold: true, color: '14161F', size: 10 });

  const sTitle = st.xf({ fontId: whiteBold, fillId: titleFill, borderId: st.borderNone, align: 'left', valign: 'center', wrap: true });
  const sHeader = st.xf({ fontId: headerFont, fillId: headerFill, borderId: st.borderThin, align: 'center', valign: 'center' });
  const sTotalLabel = st.xf({ fontId: totalFontLabel, fillId: totalFill, borderId: st.borderThin, align: 'right', valign: 'center' });
  const sTotalValor = st.xf({ fontId: totalFontValor, fillId: totalFill, borderId: st.borderThin, align: 'right', valign: 'center', numFmtId: CUR_FMT });

  // Um par de estilos (normal / negrito) por categoria, cacheado por cor.
  const catStyleCache = new Map<string, { normal: number; bold: number; fillId: number }>();
  function estiloCategoria(it: ItemParaExportar) {
    if (!it.cat_nome || !it.cat_cor) {
      const fillId = neutralFill;
      return { normal: st.xf({ fontId: neutralFont, fillId, borderId: st.borderThin, align: 'left' as const, valign: 'top' as const, wrap: true }),
                bold:   st.xf({ fontId: neutralFontBold, fillId, borderId: st.borderThin, align: 'left' as const, valign: 'top' as const, wrap: true }),
                center: st.xf({ fontId: neutralFont, fillId, borderId: st.borderThin, align: 'center' as const, valign: 'top' as const, wrap: true }),
                right:  st.xf({ fontId: neutralFont, fillId, borderId: st.borderThin, align: 'right' as const, valign: 'top' as const, wrap: true }),
                rightBold: st.xf({ fontId: neutralFontBold, fillId, borderId: st.borderThin, align: 'right' as const, valign: 'top' as const, wrap: true, numFmtId: CUR_FMT }),
                money:  st.xf({ fontId: neutralFont, fillId, borderId: st.borderThin, align: 'right' as const, valign: 'top' as const, wrap: true, numFmtId: CUR_FMT }) };
    }
    const cor = it.cat_cor.replace('#', '').toUpperCase();
    const texto = (it.cat_cor_texto ?? '#000000').replace('#', '').toUpperCase();
    const key = `${cor}|${texto}`;
    let base = catStyleCache.get(key);
    if (!base) {
      const fillId = st.fill(cor);
      base = { normal: st.font({ color: texto, size: 10 }), bold: st.font({ bold: true, color: texto, size: 10 }), fillId };
      catStyleCache.set(key, base);
    }
    return {
      normal: st.xf({ fontId: base.normal, fillId: base.fillId, borderId: st.borderThin, align: 'left', valign: 'top', wrap: true }),
      bold: st.xf({ fontId: base.bold, fillId: base.fillId, borderId: st.borderThin, align: 'left', valign: 'top', wrap: true }),
      center: st.xf({ fontId: base.normal, fillId: base.fillId, borderId: st.borderThin, align: 'center', valign: 'top', wrap: true }),
      right: st.xf({ fontId: base.normal, fillId: base.fillId, borderId: st.borderThin, align: 'right', valign: 'top', wrap: true }),
      rightBold: st.xf({ fontId: base.bold, fillId: base.fillId, borderId: st.borderThin, align: 'right', valign: 'top', wrap: true, numFmtId: CUR_FMT }),
      money: st.xf({ fontId: base.normal, fillId: base.fillId, borderId: st.borderThin, align: 'right', valign: 'top', wrap: true, numFmtId: CUR_FMT }),
    };
  }

  const headers = ['N°', 'Item', 'Descrição', 'Unidade', 'Qtd.', 'Vl. Unit. (R$)', 'Vl. Total (R$)', 'Categoria'];
  const rows: string[] = [];

  // Linha 1: título (mesclado)
  rows.push(`<row r="1" ht="28" customHeight="1"><c r="A1" s="${sTitle}" t="inlineStr"><is><t>${esc(titulo)}</t></is></c></row>`);
  // Linha 2: espaçador
  rows.push(`<row r="2" ht="6" customHeight="1"></row>`);
  // Linha 3: cabeçalho
  rows.push(`<row r="3" ht="20" customHeight="1">${headers.map((h, i) => `<c r="${colLabel(i, 3)}" s="${sHeader}" t="inlineStr"><is><t>${esc(h)}</t></is></c>`).join('')}</row>`);

  let r = 4;
  for (const it of itens) {
    const s = estiloCategoria(it);
    const cells = [
      `<c r="${colLabel(0, r)}" s="${s.center}" t="n"><v>${it.n}</v></c>`,
      `<c r="${colLabel(1, r)}" s="${s.bold}" t="inlineStr"><is><t>${esc(it.item)}</t></is></c>`,
      `<c r="${colLabel(2, r)}" s="${s.normal}" t="inlineStr"><is><t>${esc(it.descricao ?? '')}</t></is></c>`,
      `<c r="${colLabel(3, r)}" s="${s.normal}" t="inlineStr"><is><t>${esc(it.unidade ?? '')}</t></is></c>`,
      `<c r="${colLabel(4, r)}" s="${s.right}" t="n"><v>${it.quantidade}</v></c>`,
      `<c r="${colLabel(5, r)}" s="${s.money}" t="n"><v>${it.valor_unitario}</v></c>`,
      `<c r="${colLabel(6, r)}" s="${s.rightBold}" t="n"><v>${it.valor_total}</v></c>`,
      `<c r="${colLabel(7, r)}" s="${s.normal}" t="inlineStr"><is><t>${esc(it.cat_nome ?? '')}</t></is></c>`,
    ].join('');
    rows.push(`<row r="${r}" ht="40" customHeight="1">${cells}</row>`);
    r++;
  }

  const totalRow = r;
  rows.push(`<row r="${totalRow}" ht="22" customHeight="1"><c r="${colLabel(0, totalRow)}" s="${sTotalLabel}" t="inlineStr"><is><t>VALOR TOTAL GERAL</t></is></c><c r="${colLabel(6, totalRow)}" s="${sTotalValor}" t="n"><v>${total}</v></c></row>`);

  const lastRow = totalRow;
  const merges = [
    `<mergeCell ref="A1:${COL_LETTERS[7]}1"/>`,
    `<mergeCell ref="A${totalRow}:F${totalRow}"/>`,
  ];

  const cols = [6, 24, 46, 12, 10, 14, 14, 16];

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${COL_LETTERS[7]}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A1" sqref="A1"/></sheetView></sheetViews><sheetFormatPr baseColWidth="8" defaultRowHeight="15"/><cols>${cols.map((w, i) => `<col width="${w}" customWidth="1" min="${i + 1}" max="${i + 1}"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.join('')}</mergeCells><pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/></worksheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Planilha" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const enc = new TextEncoder();
  return buildZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRels) },
    { name: 'xl/styles.xml', data: enc.encode(st.toXml()) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml) },
  ]);
}
