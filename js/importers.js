/* Lecture des tableaux de séances datés (CSV ou Excel .xlsx), sans bibliothèque externe.
   Rend des lignes { date, cls, type, kind, seq, num, title, creneau }. */
(function (global) {
  'use strict';
  const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  /* ---------- ZIP (pour .xlsx) ---------- */
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
  }
  function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Fichier Excel illisible');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      files[dec.decode(u8.subarray(p + 46, p + 46 + nlen))] = { method, csize, off };
      p += 46 + nlen + elen + clen;
    }
    return {
      names: Object.keys(files),
      async text(name) {
        const f = files[name]; if (!f) return null;
        const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
        const data = u8.subarray(start, start + f.csize);
        return dec.decode(f.method === 8 ? await inflateRaw(data) : data);
      },
    };
  }
  const colIndex = letters => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  async function readXlsx(buf) {
    const z = unzip(buf), dp = new DOMParser();
    const shared = [];
    const ss = await z.text('xl/sharedStrings.xml');
    if (ss) for (const si of dp.parseFromString(ss, 'application/xml').getElementsByTagName('si'))
      shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
    const sheet = z.names.includes('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : z.names.find(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
    if (!sheet) throw new Error('Aucune feuille');
    const doc = dp.parseFromString(await z.text(sheet), 'application/xml');
    const rows = [];
    for (const r of doc.getElementsByTagName('row')) {
      const row = [];
      for (const c of r.getElementsByTagName('c')) {
        const col = colIndex((c.getAttribute('r') || '').replace(/\d+/g, ''));
        const t = c.getAttribute('t');
        let v = '';
        if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else {
          const ve = c.getElementsByTagName('v')[0];
          v = ve ? ve.textContent : '';
          if (t === 's') v = shared[Number(v)] ?? '';
          else if ((!t || t === 'n') && v !== '' && !isNaN(v)) v = Number(v);
        }
        row[col >= 0 ? col : row.length] = v;
      }
      rows.push(Array.from(row, x => x ?? ''));
    }
    return rows;
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/).find(l => l.trim()) || '';
    const delim = [';', '\t', ',', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"' && f === '') q = true;
      else if (ch === delim) { row.push(f.trim()); f = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(f.trim()); rows.push(row); row = []; f = '';
      } else f += ch;
    }
    if (f || row.length) { row.push(f.trim()); rows.push(row); }
    return rows.filter(r => r.some(x => x !== ''));
  }

  async function readFile(file) {
    if (/\.xlsx$/i.test(file.name)) return readXlsx(await file.arrayBuffer());
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    return parseCSV(text);
  }

  /* ---------- Tableau de séances ---------- */
  function toISO(v) {
    if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v))) {
      return new Date(Math.round((Number(v) - 25569) * 864e5)).toISOString().slice(0, 10); // date Excel
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : null;
  }
  function kindOf(type, seq) {
    const t = norm(type);
    if (!t) return seq ? 'cours' : 'skip';
    if (t.startsWith('eval')) return 'evaluation';
    if (t.startsWith('revision')) return 'revision';
    if (t.startsWith('seance') || t === 'cours') return 'cours';
    if (t.startsWith('accomp') || t === 'ap') return 'ap';
    if (t.includes('cointer') || t === 'coint') return 'coint';
    if (t.startsWith('libre')) return 'libre';
    return 'skip'; // férié, autre
  }
  const PROGRAM = new Set(['cours', 'revision', 'evaluation']);

  function looksLikeAgenda(rows) {
    return rows.slice(0, 10).some(r => r.some(x => norm(x) === 'date') && r.some(x => ['titre', 'sequence', 'intitule'].includes(norm(x))));
  }
  function parseAgenda(rows) {
    const hi = rows.findIndex(r => r.some(x => norm(x) === 'date'));
    if (hi < 0) return null;
    const head = rows[hi].map(norm), col = {};
    head.forEach((h, i) => {
      if (h === 'date') col.date ??= i;
      else if (h === 'classe') col.cls ??= i;
      else if (h === 'type') col.type ??= i;
      else if (h === 'sequence') col.seq ??= i;
      else if (h === 'seance') col.seance ??= i;
      else if (['n', 'no', 'num', 'numero'].includes(h)) col.num ??= i;
      else if (h === 'titre' || h === 'intitule') col.title ??= i;
      else if (h === 'creneau') col.creneau ??= i;
    });
    const out = []; let skipped = 0;
    for (const r of rows.slice(hi + 1)) {
      const date = r[col.date] !== undefined ? toISO(r[col.date]) : null;
      if (!date) { if (r.some(x => x !== '')) skipped++; continue; }
      const seq = col.seq != null ? String(r[col.seq] ?? '').trim() : '';
      const type = col.type != null ? String(r[col.type] ?? '').trim() : '';
      let num = null;
      const sv = col.seance != null ? String(r[col.seance] ?? '') : '';
      const m = sv.match(/^(\d+)\s*\/\s*\d+$/);
      if (m) num = Number(m[1]);
      else if (col.seance == null && col.num != null && /^\d+$/.test(String(r[col.num]))) num = Number(r[col.num]);
      const kind = kindOf(type, seq);
      if (kind === 'skip') { skipped++; continue; }
      out.push({
        date, cls: col.cls != null ? String(r[col.cls] ?? '').trim() : '', type, kind,
        program: PROGRAM.has(kind) && !!seq, seq, num,
        title: col.title != null ? String(r[col.title] ?? '').trim() : '', creneau: col.creneau != null ? String(r[col.creneau] ?? '') : '',
      });
    }
    return { rows: out, hasClass: col.cls != null, skipped };
  }

  global.IMP = { readFile, parseCSV, parseAgenda, looksLikeAgenda, readXlsx };
})(window);
