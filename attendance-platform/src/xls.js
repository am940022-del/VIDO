'use strict';
/*
 * قارئ ملفات Excel القديمة (.xls، صيغة BIFF8 — Excel 97-2003)، مثل الملفات التي تصدّرها
 * أنظمة الوزارات (Crystal Reports). يقرأ الورقة الأولى فقط ويعيد الصفوف كنصوص.
 * يقرأ القيم فقط ولا ينفذ أي معادلات أو وحدات ماكرو.
 */
const CFB = require('cfb');

const R = {
  BOF: 0x809, EOF: 0x0a, BOUNDSHEET: 0x85, SST: 0xfc, CONTINUE: 0x3c,
  LABELSST: 0xfd, LABEL: 0x204, RSTRING: 0xd6, RK: 0x27e, MULRK: 0xbd, NUMBER: 0x203,
  FORMULA: 0x06, STRING: 0x207, BOOLERR: 0x205,
};

function records(buf) {
  const out = [];
  let o = 0;
  while (o + 4 <= buf.length) {
    const type = buf.readUInt16LE(o);
    const len = buf.readUInt16LE(o + 2);
    if (o + 4 + len > buf.length) break;
    out.push({ type, pos: o, data: buf.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  return out;
}

/** قراءة تتابعية عبر سجل SST وسجلات CONTINUE التي تليه */
class ChunkReader {
  constructor(chunks) { this.chunks = chunks; this.ci = 0; this.o = 0; }
  get cur() { return this.chunks[this.ci]; }
  ensure() {
    while (this.ci < this.chunks.length && this.o >= this.cur.length) { this.ci++; this.o = 0; }
    if (this.ci >= this.chunks.length) throw new Error('نهاية غير متوقعة لملف xls');
  }
  u8() { this.ensure(); return this.cur[this.o++]; }
  u16() { return this.u8() | (this.u8() << 8); }
  u32() { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n) { while (n > 0) { this.ensure(); const k = Math.min(n, this.cur.length - this.o); this.o += k; n -= k; } }
  /** أحرف نص قد تمتد عبر CONTINUE؛ كل CONTINUE يبدأ ببايت يحدد هل الأحرف 8 أو 16 بت */
  chars(count, high) {
    let s = '';
    while (count > 0) {
      if (this.o >= this.cur.length) {
        this.ci++; this.o = 0;
        if (this.ci >= this.chunks.length) throw new Error('نهاية غير متوقعة لملف xls');
        high = this.cur[this.o++] & 1;
      }
      const avail = Math.floor((this.cur.length - this.o) / (high ? 2 : 1));
      const n = Math.min(count, avail);
      if (n === 0) { this.o = this.cur.length; continue; }
      if (high) { s += this.cur.toString('utf16le', this.o, this.o + n * 2); this.o += n * 2; }
      else { s += this.cur.toString('latin1', this.o, this.o + n); this.o += n; }
      count -= n;
    }
    return s;
  }
  unicodeString() {
    const cch = this.u16();
    const flags = this.u8();
    const runs = flags & 8 ? this.u16() : 0;
    const ext = flags & 4 ? this.u32() : 0;
    const s = this.chars(cch, flags & 1);
    this.skip(runs * 4 + ext);
    return s;
  }
}

/** نص Unicode داخل سجل واحد (LABEL/STRING) */
function inlineString(d, o, wide = true) {
  const cch = wide ? d.readUInt16LE(o) : d[o];
  o += wide ? 2 : 1;
  const high = d[o] & 1;
  o += 1;
  return high ? d.toString('utf16le', o, o + cch * 2) : d.toString('latin1', o, o + cch);
}

function rkValue(rk) {
  let v;
  if (rk & 2) v = rk >> 2; // عدد صحيح بإشارة
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(0, 0);
    b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    v = b.readDoubleLE(0);
  }
  return rk & 1 ? v / 100 : v;
}

function numText(n) {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e10) / 1e10);
}

/** يعيد صفوف الورقة الأولى: مصفوفة من مصفوفات نصوص */
function readXls(buffer) {
  const cfb = CFB.read(buffer, { type: 'buffer' });
  const entry = CFB.find(cfb, 'Workbook') || CFB.find(cfb, 'Book');
  if (!entry || !entry.content) throw new Error('ملف xls غير صالح');
  const buf = Buffer.from(entry.content);
  const recs = records(buf);
  if (!recs.length || recs[0].type !== R.BOF || recs[0].data.readUInt16LE(0) !== 0x600) {
    throw new Error('صيغة xls قديمة جداً غير مدعومة. احفظ الملف بصيغة xlsx ثم ارفعه.');
  }

  // ---- جدول النصوص المشتركة وموقع الورقة الأولى ----
  let sst = [];
  let sheetPos = null;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === R.BOUNDSHEET && sheetPos === null && r.data[5] === 0) sheetPos = r.data.readUInt32LE(0); // ورقة عادية
    if (r.type === R.SST) {
      const chunks = [r.data];
      for (let j = i + 1; j < recs.length && recs[j].type === R.CONTINUE; j++) chunks.push(recs[j].data);
      const rd = new ChunkReader(chunks);
      rd.u32();
      const unique = rd.u32();
      sst = [];
      for (let k = 0; k < unique; k++) sst.push(rd.unicodeString());
    }
    if (r.type === R.EOF) break;
  }
  if (sheetPos === null) throw new Error('لا توجد ورقة في الملف');

  // ---- خلايا الورقة ----
  const rows = [];
  const set = (row, col, v) => {
    if (row > 100000 || col > 1000) return;
    (rows[row] ||= [])[col] = String(v);
  };
  let start = recs.findIndex((r) => r.pos === sheetPos);
  if (start < 0) throw new Error('ملف xls غير صالح');
  let pendingFormula = null;
  for (let i = start + 1; i < recs.length; i++) {
    const { type, data: d } = recs[i];
    if (type === R.EOF || type === R.BOF) break;
    if (d.length < 6 && type !== R.STRING) continue;
    switch (type) {
      case R.LABELSST: set(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? ''); break;
      case R.LABEL: case R.RSTRING: set(d.readUInt16LE(0), d.readUInt16LE(2), inlineString(d, 6)); break;
      case R.RK: set(d.readUInt16LE(0), d.readUInt16LE(2), numText(rkValue(d.readInt32LE(6)))); break;
      case R.NUMBER: set(d.readUInt16LE(0), d.readUInt16LE(2), numText(d.readDoubleLE(6))); break;
      case R.MULRK: {
        const row = d.readUInt16LE(0), first = d.readUInt16LE(2);
        const n = (d.length - 6) / 6;
        for (let k = 0; k < n; k++) set(row, first + k, numText(rkValue(d.readInt32LE(4 + k * 6 + 2))));
        break;
      }
      case R.BOOLERR: if (d[7] === 0) set(d.readUInt16LE(0), d.readUInt16LE(2), d[6] ? 'TRUE' : 'FALSE'); break;
      case R.FORMULA: {
        const row = d.readUInt16LE(0), col = d.readUInt16LE(2);
        if (d.readUInt16LE(12) === 0xffff) {
          if (d[6] === 0) pendingFormula = { row, col }; // النتيجة نص في سجل STRING التالي
          else if (d[6] === 1) set(row, col, d[8] ? 'TRUE' : 'FALSE');
        } else set(row, col, numText(d.readDoubleLE(6)));
        break;
      }
      case R.STRING:
        if (pendingFormula) { set(pendingFormula.row, pendingFormula.col, inlineString(d, 0)); pendingFormula = null; }
        break;
      default:
    }
  }
  return Array.from(rows, (r) => (r ? Array.from(r, (v) => v ?? '') : []));
}

const isXls = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0;

module.exports = { readXls, isXls };
