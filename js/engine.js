/* Moteur de calendrier — sans IA, déterministe.
   Dates manipulées en chaînes "AAAA-MM-JJ" (heure locale). */
(function (global) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const weekday = s => { const w = parseISO(s).getDay(); return w === 0 ? 7 : w; }; // 1 = lundi
  const mondayOf = s => addDays(s, 1 - weekday(s));
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const today = () => iso(new Date());
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(new Date(y, month - 1, day));
  }
  function feriesOf(y) {
    const e = easter(y);
    return [
      [y + '-01-01', "Jour de l'an"], [addDays(e, 1), 'Lundi de Pâques'], [y + '-05-01', 'Fête du travail'],
      [y + '-05-08', 'Victoire 1945'], [addDays(e, 39), 'Ascension'], [addDays(e, 50), 'Lundi de Pentecôte'],
      [y + '-07-14', 'Fête nationale'], [y + '-08-15', 'Assomption'], [y + '-11-01', 'Toussaint'],
      [y + '-11-11', 'Armistice'], [y + '-12-25', 'Noël'],
    ];
  }

  // Calendrier officiel zone B 2026-2027 (data.education.gouv.fr), utilisé si le chargement en ligne échoue.
  const FALLBACK_HOLIDAYS = {
    '2026-2027': [
      { label: 'Vacances de la Toussaint', start: '2026-10-17', end: '2026-11-01' },
      { label: 'Vacances de Noël', start: '2026-12-19', end: '2027-01-03' },
      { label: "Vacances d'Hiver", start: '2027-02-20', end: '2027-03-07' },
      { label: 'Vacances de Printemps', start: '2027-04-17', end: '2027-05-02' },
      { label: "Pont de l'Ascension", start: '2027-05-07', end: '2027-05-07' },
      { label: "Vacances d'Été", start: '2027-07-03', end: '2027-08-31' },
    ],
  };

  const parisDate = s => new Date(s).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

  async function fetchHolidays(zone, year) {
    const where = encodeURIComponent(`zones="Zone ${zone}" and annee_scolaire="${year}"`);
    const url = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=${where}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const seen = new Map();
    for (const r of data.results || []) {
      const start = parisDate(r.start_date), endRaw = parisDate(r.end_date);
      // end_date = jour de reprise ; pour un pont d'un jour, début = fin.
      const end = endRaw > start ? addDays(endRaw, -1) : start;
      const key = r.description + start;
      if (!seen.has(key)) seen.set(key, { label: r.description, start, end });
    }
    const list = [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
    if (!list.length) throw new Error('Aucune donnée');
    return list;
  }

  const STATUS = {
    realisee: { label: 'Réalisée', icon: '✓' },
    non_terminee: { label: 'Non terminée', icon: '◐' },
    reportee: { label: 'Reportée', icon: '↷' },
    non_realisee: { label: 'Non réalisée', icon: '✕' },
  };
  const SEANCE_STATUS = {
    a_preparer: 'À préparer', preparee: 'Préparée', realisee: 'Réalisée',
    non_terminee: 'Non terminée', reportee: 'Reportée', non_realisee: 'Non réalisée', retiree: 'Retirée',
  };
  // Types de créneau. Seuls les cours génèrent une séance (sauf réglage contraire, créneau par créneau).
  const SLOT_TYPES = { cours: 'Cours', ap: 'AP', coint: 'Co-intervention', hors: 'Hors progression' };

  // Lecture tolérante des créneaux (anciennes versions : classId unique, pas de type)
  const slotClassIds = s => Array.isArray(s.classIds) ? s.classIds : (s.classId ? [s.classId] : []);
  const slotType = s => s.type || (slotClassIds(s).length ? 'cours' : 'hors');
  const slotCounts = s => s.counts != null ? !!s.counts : slotType(s) === 'cours';

  /* Le moteur travaille sur l'état S (voir app.js). Les résultats sont mis en cache
     tant que S._rev ne change pas. */
  function Engine(getState) {
    // Cache valable pour un état donné ET une révision donnée (l'état peut être remplacé entièrement :
    // données récupérées en ligne, sauvegarde restaurée…)
    let cacheRev = -1, cache = null, cacheSt = null;
    const S = () => getState();

    function holidayLabel(date) {
      const st = S();
      for (const h of st.holidays) if (date >= h.start && date <= h.end) return h.label;
      const y = Number(date.slice(0, 4));
      for (const [d, l] of feriesOf(y)) if (d === date) return l;
      return null;
    }
    // Jour sans cours pour tout le monde (vacances, férié, hors année, événement global)
    function dayOff(date) {
      const st = S();
      if (date < st.settings.rentree || date > st.settings.finAnnee) return 'Hors année scolaire';
      const h = holidayLabel(date);
      if (h) return h;
      for (const ev of st.events) if (ev.noClass && !partial(ev) && !ev.classIds.length && date >= ev.start && date <= ev.end) return ev.label;
      return null;
    }
    // Absence partielle : seulement certaines heures, ou co-interventions maintenues
    const partial = ev => !!(ev.startTime || ev.keepCoint);
    function classBlocked(date, classId) {
      for (const ev of S().events)
        if (ev.noClass && !partial(ev) && ev.classIds.includes(classId) && date >= ev.start && date <= ev.end) return ev.label;
      return null;
    }
    function partialBlock(date, src, classIds, type) {
      for (const ev of S().events) {
        if (!ev.noClass || !partial(ev) || date < ev.start || date > ev.end) continue;
        if (ev.classIds.length && !classIds.some(c => ev.classIds.includes(c))) continue;
        if (ev.keepCoint && type === 'coint') continue;
        if (ev.startTime && ev.endTime && !(toMin(src.start) < toMin(ev.endTime) && toMin(src.end) > toMin(ev.startTime))) continue;
        return ev;
      }
      return null;
    }
    function eventsOn(date) {
      return S().events.filter(ev => date >= ev.start && date <= ev.end);
    }

    /* Semaines Q1 / Q2 : on part du repère le plus proche (avant la semaine demandée),
       puis on alterne. Les semaines de vacances comptent ou non selon le réglage.
       « Forcer cette semaine » ajoute un repère. */
    const weekCache = new Map();
    let wcRev = -1, wcSt = null;
    function isSchoolWeek(monday) {
      for (let i = 0; i < 5; i++) if (!holidayLabel(addDays(monday, i))) return true;
      return false;
    }
    function anchors() {
      const st = S();
      const list = (st.settings.weekAnchors || []).filter(a => a && a.monday).map(a => ({ monday: mondayOf(a.monday), type: Number(a.type) === 2 ? 2 : 1 }));
      if (!list.length) list.push({ monday: mondayOf(st.settings.rentree), type: 1 });
      return list.sort((a, b) => a.monday.localeCompare(b.monday));
    }
    function weekType(date) {
      const st = S();
      if (wcRev !== st._rev || wcSt !== st) { weekCache.clear(); wcRev = st._rev; wcSt = st; }
      const m = mondayOf(date);
      if (weekCache.has(m)) return weekCache.get(m);
      const list = anchors();
      let a = list[0];
      for (const x of list) if (x.monday <= m) a = x;
      let n = 0;
      if (!st.settings.skipVacations) n = Math.round((parseISO(m) - parseISO(a.monday)) / (7 * 86400000));
      else if (m >= a.monday) { for (let w = a.monday; w < m; w = addDays(w, 7)) if (isSchoolWeek(w)) n++; }
      else { for (let w = m; w < a.monday; w = addDays(w, 7)) if (isSchoolWeek(w)) n--; }
      const t = ((n % 2) + 2) % 2 === 0 ? a.type : 3 - a.type;
      weekCache.set(m, t);
      return t;
    }
    const weekLabel = t => 'Q' + t;
    function semesterOf(date) {
      const s2 = S().settings.s2Start;
      return s2 && date >= s2 ? 'S2' : 'S1';
    }

    function makeBlock(src, date, extra) {
      const st = S();
      const classIds = slotClassIds(src), type = slotType(src), counts = slotCounts(src);
      const a = toMin(src.start), b = toMin(src.end);
      const n = type === 'hors' ? 1 : Math.max(1, Math.round((b - a) / 55));
      const step = (b - a) / n, hours = [];
      for (let i = 0; i < n; i++) {
        const id = `${src.id}@${date}#${i}`, rec = st.occ[id];
        hours.push({
          id, date, start: fromMin(Math.round(a + i * step)), end: fromMin(Math.round(a + (i + 1) * step)),
          counts: classIds.length > 0 && (rec && rec.counts != null ? !!rec.counts : counts), defaultCounts: counts,
        });
      }
      const pbEv = partialBlock(date, src, classIds, type), pb = pbEv ? pbEv.label : null;
      const blocked = pb || (classIds.length && classIds.every(c => classBlocked(date, c)) ? classBlocked(date, classIds[0]) : null);
      const bid = `${src.id}@${date}`;
      return {
        id: bid, srcId: src.id, extra: !!extra, date, start: src.start, end: src.end, type, counts,
        classIds, classId: classIds[0] || null, classLabel: src.classLabel || '', label: src.label || '',
        group: src.group || '', colleague: src.colleague || '', semester: src.semester || '',
        note: (st.notes && st.notes[bid]) || '', blocked, partialBlocked: !!pb, blockedBy: pbEv || null, hours,
      };
    }

    // Créneaux d'un jour donné
    function blocksOn(date) {
      const st = S();
      const out = [];
      if (!dayOff(date)) {
        const wd = weekday(date), wt = weekType(date), sem = semesterOf(date);
        for (const sl of st.slots) {
          if (sl.day !== wd) continue;
          if (sl.weeks !== '12' && sl.weeks !== String(wt)) continue;
          if (sl.semester && sl.semester !== sem) continue;
          out.push(makeBlock(sl, date, false));
        }
      }
      for (const ex of st.extras) if (ex.date === date) out.push(makeBlock(ex, date, true));
      return out.sort((x, y) => toMin(x.start) - toMin(y.start));
    }

    /* Demi-groupes d'une classe (ex. 2MV1, 2MV2). Chaque groupe suit la progression
       à son rythme ; un cours en classe entière fait avancer tous les groupes. */
    function tracksOf(classId) {
      const g = new Set();
      for (const s of [...S().slots, ...S().extras]) {
        const ids = slotClassIds(s);
        if (ids.length === 1 && ids[0] === classId && s.group) g.add(s.group);
      }
      return g.size ? [...g].sort() : [''];
    }

    /* Placement des séances : pour chaque classe (et chaque groupe), les séances, dans
       l'ordre de la bibliothèque, occupent les heures de cours dans l'ordre chronologique.
       - réalisée : séance terminée, on passe à la suivante
       - non terminée : l'heure compte, la séance continue au cours suivant
       - reportée : l'heure est perdue, la séance passe au cours suivant
       - non réalisée : la séance est abandonnée, on passe à la suivante
       - annulé : le cours n'a pas lieu, aucune séance
       - libre : cours gardé en réserve (marge), aucune séance */
    function runTrack(st, c, list, hours, t, nm) {
      const occ = {}, seance = {};
      let p = 0;
      const stats = { total: hours.length, done: 0, future: 0, lost: 0, unvalidated: 0, free: 0, reserved: 0, reservedFuture: 0 };
      stats.capacity = hours.filter(h => !(st.occ[h.id] && st.occ[h.id].cancelled)).length;
      stats.capacityFromToday = hours.filter(h => h.date >= t && !(st.occ[h.id] && st.occ[h.id].cancelled)).length;
      for (const h of hours) {
        const rec = st.occ[h.id] || {};
        const past = h.date < t || (h.date === t && toMin(h.end) <= nm);
        if (rec.cancelled) { occ[h.id] = { cancelled: true, classId: c.id }; stats.lost++; continue; }
        if (rec.reserved) { occ[h.id] = { reserved: true, classId: c.id, past }; stats.reserved++; if (!past) stats.reservedFuture++; continue; }
        const s = list[p];
        if (!s) { occ[h.id] = { free: true, classId: c.id, past }; if (!past) stats.free++; continue; }
        const info = (seance[s.id] ||= { occ: [], started: false, status: null, date: null, start: null });
        const o = { seanceId: s.id, classId: c.id, status: rec.status || null, cont: info.started, past };
        occ[h.id] = o;
        info.occ.push(h.id);
        if (!info.firstDate) info.firstDate = h.date;
        info.date = h.date; info.start = h.start;
        switch (rec.status) {
          case 'realisee': info.status = 'realisee'; p++; stats.done++; break;
          case 'non_terminee': info.status = 'non_terminee'; info.started = true; stats.done++; break;
          case 'reportee': if (!info.started) info.status = 'reportee'; stats.lost++; break;
          case 'non_realisee': info.status = 'non_realisee'; p++; stats.lost++; break;
          default:
            p++;
            if (past) stats.unvalidated++; else stats.future++;
        }
      }
      for (let i = p; i < list.length; i++) if (!seance[list[i].id]) seance[list[i].id] = { occ: [], unplaced: true, status: null };
      stats.seances = list.length;
      stats.seancesDone = list.filter(s => seance[s.id] && seance[s.id].status === 'realisee').length;
      stats.unplaced = list.length - p;
      stats.remainingSeances = list.filter(s => { const i = seance[s.id]; return !i || !i.status || i.status === 'non_terminee' || i.status === 'reportee'; }).length;
      stats.availableHours = stats.future + stats.unvalidated + stats.free + stats.reservedFuture;
      stats.margin = stats.availableHours - stats.remainingSeances;
      return { occ, seance, stats, hours };
    }

    function plan() {
      const st = S();
      if (cache && cacheRev === st._rev && cacheSt === st) return cache;
      const hoursByClass = {};
      for (let d = st.settings.rentree; d <= st.settings.finAnnee; d = addDays(d, 1)) {
        for (const b of blocksOn(d)) {
          if (b.partialBlocked) continue;
          for (const cid of b.classIds) {
            if (classBlocked(d, cid)) continue;
            for (const h of b.hours) if (h.counts) (hoursByClass[cid] ||= []).push({ ...h, group: b.group });
          }
        }
      }
      const occ = {}, seance = {}, perClass = {}, classHours = {};
      const t = today(), nm = nowMin();
      for (const c of st.classes) {
        const list = orderedSeances(c.id).filter(s => !s.skipped);
        const hours = (hoursByClass[c.id] || []).filter(h => h.date >= (c.startDate || st.settings.rentree));
        hours.sort((a, b) => a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start));
        const tracks = tracksOf(c.id);
        const res = tracks.map(g => ({ group: g, ...runTrack(st, c, list, tracks.length > 1 ? hours.filter(h => !h.group || h.group === g) : hours, t, nm) }));
        // Fusion des groupes
        for (const r of res) {
          for (const [hid, o] of Object.entries(r.occ)) {
            const cur = occ[hid];
            if (!cur) { occ[hid] = { ...o, group: r.group }; continue; }
            if (cur.classId !== c.id) { // heure partagée par plusieurs classes (ex. co-intervention CAP)
              if (!o.seanceId) continue;
              if (!cur.seanceId) { occ[hid] = { ...o, group: r.group }; continue; }
              cur.multi = cur.multi || [{ classId: cur.classId, seanceId: cur.seanceId, cont: cur.cont }];
              if (!cur.multi.some(m => m.classId === c.id)) cur.multi.push({ classId: c.id, seanceId: o.seanceId, cont: o.cont });
              continue;
            }
            if (cur.seanceId === o.seanceId && !!cur.cont === !!o.cont) continue;
            cur.split = cur.split || [{ group: cur.group, seanceId: cur.seanceId, cont: cur.cont, status: cur.status }];
            cur.split.push({ group: r.group, seanceId: o.seanceId, cont: o.cont, status: o.status });
          }
        }
        for (const s of list) {
          const infos = res.map(r => r.seance[s.id]).filter(Boolean);
          if (infos.length === 1) { seance[s.id] = infos[0]; continue; }
          const placed = infos.filter(i => !i.unplaced);
          const sts = infos.map(i => i.status || null);
          const last = placed.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))[placed.length - 1];
          seance[s.id] = {
            occ: infos.flatMap(i => i.occ), started: infos.some(i => i.started),
            status: sts.every(x => x === sts[0]) ? sts[0] : (sts.find(x => x !== 'realisee') ?? null),
            firstDate: placed.map(i => i.firstDate).sort()[0] || null, date: last ? last.date : null, start: last ? last.start : null,
            unplaced: !placed.length, partial: placed.length && placed.length < infos.length,
          };
        }
        // La classe est jugée sur son groupe le plus en difficulté
        const worst = res.slice().sort((a, b) => b.stats.unplaced - a.stats.unplaced || a.stats.margin - b.stats.margin || a.stats.seancesDone - b.stats.seancesDone)[0];
        perClass[c.id] = { ...worst.stats, tracks: res.length > 1 ? res.map(r => ({ group: r.group, ...r.stats })) : null, worstGroup: worst.group };
        classHours[c.id] = worst.hours;
      }
      cache = { occ, seance, perClass, classHours };
      cacheRev = st._rev; cacheSt = st;
      return cache;
    }

    function orderedSequences(classId) {
      return S().sequences.filter(q => q.classId === classId).sort((a, b) => a.order - b.order);
    }
    function orderedSeancesOf(seqId) {
      return S().seances.filter(s => s.sequenceId === seqId).sort((a, b) => a.order - b.order);
    }
    function orderedSeances(classId) {
      return orderedSequences(classId).flatMap(q => orderedSeancesOf(q.id));
    }
    function seanceStatus(s) {
      if (s.skipped) return 'retiree';
      const info = plan().seance[s.id];
      if (info && info.status) return info.status;
      return s.prepared ? 'preparee' : 'a_preparer';
    }
    function unvalidatedList() {
      const p = plan(), out = [];
      for (const [id, o] of Object.entries(p.occ)) if (o.seanceId && o.past && !o.status) out.push(id);
      const key = id => id.split('@')[1];
      return out.sort((a, b) => key(a).localeCompare(key(b)));
    }

    /* Projection « à vide » : la n-ième séance tombe sur la n-ième heure de cours de la classe
       (sans tenir compte des validations ; cours annulés et cours libres exclus). */
    function projectDates(classId, count) {
      const st = S();
      const hours = (plan().classHours[classId] || []).filter(h => !(st.occ[h.id] && (st.occ[h.id].cancelled || st.occ[h.id].reserved)));
      return Array.from({ length: count }, (_, i) => hours[i] ? hours[i].date : null);
    }
    function upcoming(classId, n) {
      const p = plan(), t = today(), out = [];
      for (const h of p.classHours[classId] || []) {
        if (h.date < t) continue;
        const o = p.occ[h.id];
        if (o && o.seanceId && !o.status && !o.past) out.push({ hour: h, occ: o });
        if (out.length >= n) break;
      }
      return out;
    }
    // Comparaison progression effective / initiale pour une classe
    function compare(classId) {
      const st = S(), p = plan(), stats = p.perClass[classId];
      if (!stats) return null;
      const t = today();
      const seqs = orderedSequences(classId);
      const finished = s => { if (s.skipped) return true; const i = p.seance[s.id]; return i && (i.status === 'realisee' || i.status === 'non_realisee'); };
      const seqDone = seqs.filter(q => { const ss = orderedSeancesOf(q.id); return ss.length && ss.every(finished); }).length;
      const ini = st.initial && st.initial[classId];
      let expected = null, delta = null, plannedHours = null, expectedSeq = null;
      if (ini) {
        const all = ini.sequences.flatMap(q => q.seances);
        plannedHours = all.length;
        expected = all.filter(s => s.date && s.date < t).length;
        expectedSeq = ini.sequences.filter(q => q.end && q.end < t).length;
        delta = stats.seancesDone - expected;
      }
      return { ...stats, seqTotal: seqs.length, seqDone, expected, expectedSeq, delta, plannedHours, initial: ini || null };
    }
    function sequenceSpan(seqId) {
      const p = plan(); let start = null, end = null;
      for (const s of orderedSeancesOf(seqId)) {
        const i = p.seance[s.id];
        if (!i || !i.firstDate) continue;
        if (!start || i.firstDate < start) start = i.firstDate;
        if (!end || i.date > end) end = i.date;
      }
      return { start, end };
    }

    return {
      projectDates, upcoming, compare, sequenceSpan, tracksOf, semesterOf, weekLabel, anchors,
      plan, blocksOn, dayOff, classBlocked, eventsOn, weekType, holidayLabel,
      orderedSequences, orderedSeancesOf, orderedSeances, seanceStatus, unvalidatedList,
    };
  }

  global.PE = {
    pad, iso, parseISO, addDays, weekday, mondayOf, toMin, fromMin, today, nowMin,
    feriesOf, fetchHolidays, FALLBACK_HOLIDAYS, STATUS, SEANCE_STATUS, SLOT_TYPES,
    slotClassIds, slotType, slotCounts, Engine,
  };
})(window);
