/* Correctifs de données, appliqués une seule fois par navigateur (identifiants gardés dans settings.patches).
   Chaque correctif vérifie d'abord qu'il s'applique bien aux données 2026-2027 ; sinon il ne touche à rien. */
window.PATCHES = [{
  id: '2026-11-08-a',
  label: 'Géométrie dans l’espace faite (2MV), statistique, évaluations CAP, formations des 10 et 17 nov.',
  apply(S, h) {
    const { E, uid, norm, bump } = h;
    const byOrder = (a, b) => a.order - b.order;
    const seq2 = S.sequences.filter(q => q.classId === 'c2mv').sort(byOrder);
    const stats = seq2.find(q => norm(q.title) === norm('Statistique à une variable'));
    if (!stats || !S.initial.c2mv) return false;

    // 1. 2MV — séquence 1 « Géométrie dans l'espace » : faite et évaluée (21 sept. → vacances de la Toussaint)
    let geo = seq2.find(q => norm(q.title).startsWith('geometriedanslespace'));
    if (!geo) {
      seq2.forEach(q => { q.order++; });
      geo = { id: uid(), classId: 'c2mv', title: "Géométrie dans l'espace", convUrl: '', order: 0 };
      S.sequences.push(geo);
      S.classes.find(c => c.id === 'c2mv').startDate = '2026-09-21';
      bump();
      const n = (E.plan().classHours.c2mv || []).filter(x => x.date < '2026-11-02').length;
      for (let j = 0; j < n; j++) S.seances.push({
        id: uid(), sequenceId: geo.id, order: j, prepared: true,
        title: j === n - 1 ? "Évaluation : géométrie dans l'espace" : `Géométrie dans l'espace — séance ${j + 1}`,
        kind: j === n - 1 ? 'evaluation' : 'cours',
      });
    }

    // 2. 2MV — statistique : séances telles que faites / prévues
    const titles = ['Médiane et quartiles', 'Moyenne et écart type', 'Boîte à moustaches et comparaison de deux séries', 'Exercices de révision', 'Évaluation de statistique'];
    const ss = S.seances.filter(s => s.sequenceId === stats.id).sort(byOrder);
    ss.forEach((s, i) => { if (titles[i]) s.title = titles[i]; });
    if (ss[2]) ss[2].kind = 'cours';
    if (ss[3]) ss[3].kind = 'revision';
    if (ss[4]) ss[4].kind = 'evaluation';

    // 3. Absences pour formation : mardi 10 nov. après-midi, mardi 17 nov. ; co-interventions maintenues
    S.events = S.events.filter(ev => !(ev.type === 'sanscours' && ev.start === '2026-11-17'));
    S.events.push(
      { id: uid(), type: 'formation', label: 'Formation', start: '2026-11-10', end: '2026-11-10', startTime: '13:30', endTime: '18:00', keepCoint: true, classIds: [], noClass: true },
      { id: uid(), type: 'formation', label: 'Formation', start: '2026-11-17', end: '2026-11-17', startTime: '', endTime: '', keepCoint: true, classIds: [], noClass: true });

    // 4. CAP — évaluation du chapitre 1 le mardi 10 nov. au matin, pendant la co-intervention (1re heure)
    const coint = S.slots.find(s => s.type === 'coint' && s.day === 2 && s.weeks === '1' && s.classIds.includes('ccap1m'));
    if (coint) { const k = `${coint.id}@2026-11-10#0`; S.occ[k] = { ...(S.occ[k] || {}), counts: true }; }
    const met1 = S.sequences.filter(q => q.classId === 'ccap1m').sort(byOrder)[0];
    const metEval = met1 && S.seances.find(s => s.sequenceId === met1.id && s.kind === 'evaluation');
    const metTitle = 'Évaluation : pourcentages, proportionnalité et non-proportionnalité (30 min)';
    if (metEval) metEval.title = metTitle;

    // 5. 2MV — tout ce qui était prévu jusqu'au vendredi 6 nov. est réalisé
    bump();
    for (const [hid, o] of Object.entries(E.plan().occ))
      if (o.classId === 'c2mv' && o.seanceId && !o.status && hid.split('@')[1].split('#')[0] <= '2026-11-06')
        S.occ[hid] = { ...(S.occ[hid] || {}), status: 'realisee' };

    // 6. Progression initiale figée : ajout de la séquence 1 et des titres corrigés
    bump();
    const p = E.plan(), ini = S.initial.c2mv;
    if (!ini.sequences.some(q => norm(q.title).startsWith('geometriedanslespace'))) {
      const seances = S.seances.filter(s => s.sequenceId === geo.id).sort(byOrder).map(s => ({ title: s.title, date: (p.seance[s.id] || {}).firstDate || null }));
      ini.sequences.unshift({ title: geo.title, hours: seances.length, start: seances[0] && seances[0].date, end: seances.length ? seances[seances.length - 1].date : null, seances });
    }
    const iq = ini.sequences.find(q => norm(q.title) === norm(stats.title));
    if (iq) iq.seances.forEach((s, i) => { if (titles[i]) s.title = titles[i]; });
    ini.capacity = (p.perClass.c2mv || {}).capacity || ini.capacity;
    ini.text = h.iniText(ini);
    const im = S.initial.ccap1m;
    if (im && im.sequences[0] && im.sequences[0].seances[0]) { im.sequences[0].seances[0].title = metTitle; im.text = h.iniText(im); }
    return true;
  },
}, {
  id: '2026-11-08-b',
  label: 'Cours depuis le 21 sept. ; séances déjà faites en 2MV et en CAP',
  apply(S, h) {
    const { E, uid, norm, bump } = h;
    const byOrder = (a, b) => a.order - b.order;
    const seqsOf = cid => S.sequences.filter(q => q.classId === cid).sort(byOrder);
    const geo = seqsOf('c2mv').find(q => norm(q.title).startsWith('geometriedanslespace'));
    const stats = seqsOf('c2mv').find(q => norm(q.title) === norm('Statistique à une variable'));
    if (!geo || !stats || !S.initial.c2mv) return false;
    const setSeances = (seq, list) => {
      S.seances = S.seances.filter(s => s.sequenceId !== seq.id);
      list.forEach(([title, kind], j) => S.seances.push({ id: uid(), sequenceId: seq.id, title, kind, prepared: true, order: j }));
    };
    const iniSeq = (q, p) => {
      const se = S.seances.filter(s => s.sequenceId === q.id).sort(byOrder).map(s => ({ title: s.title, date: (p.seance[s.id] || {}).firstDate || null }));
      return { title: q.title, hours: se.length, start: se[0] ? se[0].date : null, end: se.length ? se[se.length - 1].date : null, seances: se };
    };
    const dateOf = hid => hid.split('@')[1].split('#')[0];

    // Les cours ont commencé le 21 septembre
    S.settings.rentree = '2026-09-21';

    // 2MV — géométrie dans l'espace (21 sept. → 6 oct.), statistique depuis le 12 oct.
    setSeances(geo, [['Reconnaître les figures et les solides usuels', 'cours'], ['Calculer des périmètres et des aires', 'cours'],
      ['Agrandissements et réductions', 'cours'], ['Exercices de révision', 'revision'], ["Évaluation : géométrie dans l'espace", 'evaluation']]);
    const slots2 = new Set(S.slots.filter(s => s.classIds.includes('c2mv')).map(s => s.id));
    for (const k of Object.keys(S.occ)) {
      if (slots2.has(k.split('@')[0]) && dateOf(k) < '2026-11-07' && S.occ[k].status) { delete S.occ[k].status; if (!Object.keys(S.occ[k]).length) delete S.occ[k]; }
    }
    const done2 = {
      '2026-09-21': 'realisee', '2026-09-22': 'non_terminee', '2026-09-28': 'realisee', '2026-09-29': 'realisee', '2026-10-05': 'realisee', '2026-10-06': 'realisee',
      '2026-10-12': 'non_terminee', '2026-10-13': 'non_terminee', '2026-11-02': 'realisee', '2026-11-03': 'realisee', '2026-11-06': 'realisee',
    };
    bump();
    for (const [hid, o] of Object.entries(E.plan().occ))
      if (o.classId === 'c2mv' && o.seanceId && done2[dateOf(hid)]) S.occ[hid] = { ...(S.occ[hid] || {}), status: done2[dateOf(hid)] };

    // CAP — depuis le 2 nov. : proportionnalité, échelles, révision, puis interro mardi 10 en co-intervention
    const ap = (day, weeks, cid) => S.slots.find(s => s.type === 'ap' && s.day === day && s.weeks === weeks && s.classIds.includes(cid));
    for (const [sl, d] of [[ap(2, '2', 'ccap1m'), '2026-11-03'], [ap(5, '2', 'ccap1m'), '2026-11-06']])
      if (sl) { const k = `${sl.id}@${d}#0`; S.occ[k] = { ...(S.occ[k] || {}), counts: true }; }
    const capList = [['Proportionnalité', 'cours'], ['Échelles', 'cours'], ['Exercices de révision : proportionnalité et échelles', 'revision'],
      ['Évaluation : pourcentages, proportionnalité et non-proportionnalité (30 min)', 'evaluation']];
    for (const cid of ['ccap1p', 'ccap1m']) {
      const q1 = seqsOf(cid)[0]; if (!q1) continue;
      setSeances(q1, capList);
      S.classes.find(c => c.id === cid).startDate = '2026-11-02';
    }
    bump();
    for (const [hid, o] of Object.entries(E.plan().occ))
      if ((o.classId === 'ccap1p' || o.classId === 'ccap1m') && o.seanceId && !o.status && dateOf(hid) <= '2026-11-06') S.occ[hid] = { ...(S.occ[hid] || {}), status: 'realisee' };

    // Progressions initiales figées : séances passées telles qu'elles ont eu lieu
    bump();
    const p = E.plan();
    const ini2 = S.initial.c2mv;
    for (const q of [geo, stats]) { const i = ini2.sequences.findIndex(x => norm(x.title) === norm(q.title)); if (i >= 0) ini2.sequences[i] = iniSeq(q, p); }
    ini2.capacity = (p.perClass.c2mv || {}).capacity || ini2.capacity; ini2.text = h.iniText(ini2);
    for (const cid of ['ccap1p', 'ccap1m']) {
      const ini = S.initial[cid], q1 = seqsOf(cid)[0];
      if (!ini || !q1) continue;
      ini.sequences[0] = iniSeq(q1, p);
      ini.capacity = (p.perClass[cid] || {}).capacity || ini.capacity; ini.text = h.iniText(ini);
    }
    return true;
  },
}, {
  id: '2026-11-08-c',
  label: 'Séances à venir des CAP : « à préparer »',
  apply(S) {
    let n = 0;
    for (const cid of ['ccap1p', 'ccap1m']) {
      const q1 = S.sequences.filter(q => q.classId === cid).sort((a, b) => a.order - b.order)[0];
      if (!q1) continue;
      for (const s of S.seances) if (s.sequenceId === q1.id && (s.kind === 'revision' || s.kind === 'evaluation')) { s.prepared = false; n++; }
    }
    return n > 0;
  },
}, {
  id: '2026-11-08-d',
  label: 'Plus de cours « libres » : la marge est en fin d’année',
  apply(S) {
    let n = 0;
    for (const [k, r] of Object.entries(S.occ)) if (r.reserved) {
      delete r.reserved; delete r.imp; n++;
      if (!Object.keys(r).length) delete S.occ[k];
    }
    for (const [k, v] of Object.entries(S.notes || {})) if (/^s[ée]ance libre/i.test(v)) { delete S.notes[k]; n++; }
    return n > 0;
  },
}, {
  id: '2026-11-08-e',
  label: 'Progressions 1MV Maths et 1MV PC',
  apply(S, h) {
    const { E, uid, norm, bump } = h;
    const m = S.classes.find(c => c.id === 'c1mvm'), pc = S.classes.find(c => c.id === 'c1mvpc');
    if (!m || !pc || S.initial.c1mvm || S.initial.c1mvpc) return false;
    if (S.sequences.some(q => q.classId === 'c1mvm' || q.classId === 'c1mvpc')) return false;
    const C = 'cours', R = 'revision', V = 'evaluation';
    const build = (cid, seqs) => seqs.forEach(([title, list], i) => {
      const q = { id: uid(), classId: cid, title, convUrl: '', order: i };
      S.sequences.push(q);
      list.forEach(([t, kind], j) => S.seances.push({ id: uid(), sequenceId: q.id, title: t, kind: kind || C, prepared: false, order: j }));
    });

    build('c1mvm', [
      ['Probabilités', [['Probabilité d’un événement, événement contraire'], ['Réunion et intersection d’événements'], ['Tableaux croisés et probabilité conditionnelle'], ['Évaluation de probabilités', V]]],
      ['Géométrie dans l’espace', [['Solides usuels : aires et volumes'], ['Exploiter la représentation d’un solide ou d’un assemblage'], ['Section d’un solide par un plan : découverte'],
        ['Section d’un solide par un plan : construire'], ['Représenter un solide avec GeoGebra 3D (salle informatique)'], ['Sections avec GeoGebra'], ['Section passant par des points donnés'],
        ['Exercices de révision', R], ['Évaluation : géométrie dans l’espace', V]]],
      ['Statistique à deux variables', [['Nuage de points avec un outil numérique'], ['Droite d’ajustement par les moindres carrés'], ['Interpoler et extrapoler'],
        ['Coefficient de détermination R²'], ['Corrélation et causalité : exercices d’atelier'], ['Exercices de révision', R], ['Évaluation : statistique à deux variables', V]]],
      ['Fonctions polynômes de degré 2', [['Parabole : nombre de solutions de f(x) = 0'], ['Forme factorisée : signe de a, sommet, axe de symétrie'], ['Tester une racine, factoriser'],
        ['Signe d’un polynôme factorisé, deuxième racine'], ['Exercices de révision', R], ['Évaluation : polynômes de degré 2', V]]],
      ['Fonction dérivée et étude des variations', [['Sécantes et tangente, nombre dérivé (GeoGebra)'], ['Tracer une tangente, équation réduite'], ['Dérivées à connaître, dériver un polynôme de degré 2'],
        ['Signe de f′ et tableau de variations'], ['Extremum local et global'], ['Fonction inverse'], ['Exercices de révision', R], ['Évaluation : dérivée et variations', V]]],
      ['Suites numériques', [['Notation u(n), générer des termes'], ['Sens de variation d’une suite'], ['Suite arithmétique : premier terme et raison'],
        ['Terme de rang n, nuage de points (n ; un)'], ['Sens de variation d’une suite arithmétique'], ['Somme de termes (tableur, Python)'], ['Exercices de révision', R], ['Évaluation de CCF : suites numériques', V]]],
      ['Résolution graphique d’équations et d’inéquations', [['Résoudre f(x) = g(x) graphiquement ou à l’outil numérique'], ['Inéquation f(x) ⩾ g(x), balayage'], ['Révision et évaluation courte', V]]],
      ['Vecteurs du plan', [['Vecteur : direction, sens, norme ; vecteurs égaux, opposés'], ['Somme de vecteurs, produit par un réel, colinéarité'], ['Coordonnées d’un vecteur'],
        ['Norme ; alignement et parallélisme'], ['Exercices de révision', R], ['Évaluation : vecteurs du plan', V]]],
      ['Trigonométrie', [['Cercle trigonométrique, radians'], ['Cosinus, sinus, fonction sinus'], ['Révision et évaluation courte', V]]],
    ]);
    build('c1mvpc', [
      ['Ondes électromagnétiques', [['Le spectre électromagnétique'], ['Longueur d’onde : λ = c / f'], ['Le visible ; sources et détecteurs de la vie courante'], ['Bilan : conversions, écriture scientifique (devoir maison)']]],
      ['Pression et force pressante', [['Force pressante et pression'], ['Mesurer une pression'], ['TP — Loi de Boyle-Mariotte'], ['Révision et évaluation courte', V]]],
      ['Énergie électrique : puissance, énergie et transport', [['Puissance d’un appareil'], ['Énergie électrique'], ['Du réseau à la prise'], ['Le transformateur et la sécurité'], ['Exercices de révision', R], ['Évaluation : énergie électrique', V]]],
      ['Combustion et transferts thermiques', [['Combustion d’un hydrocarbure'], ['Équation de combustion et CO2'], ['Les trois modes de transfert thermique'], ['Révision et évaluation courte', V]]],
      ['Vitesse et accélération', [['Mesurer une vitesse et une accélération'], ['Nature d’un mouvement'], ['Révision et évaluation courte', V]]],
      ['Moment d’une force et équilibre', [['Le moment d’une force'], ['TP — Équilibre d’un solide autour d’un axe'], ['Centre de gravité et basculement'], ['Exercices de révision', R], ['Évaluation : moment d’une force', V]]],
      ['Solutions aqueuses', [['Préparer une solution'], ['TP — Titrage'], ['Révision et évaluation courte', V]]],
      ['Force d’Archimède', [['Mesurer la poussée d’Archimède'], ['Flotter ou couler'], ['Révision et évaluation courte', V]]],
    ]);
    m.startDate = '2026-09-21'; pc.startDate = '2026-09-28';

    // Stages des 1MV
    S.events.push(
      { id: uid(), type: 'pfmp', label: 'Stage 1MV', start: '2026-11-02', end: '2026-11-28', classIds: ['c1mvm', 'c1mvpc'], noClass: true },
      { id: uid(), type: 'pfmp', label: 'Stage 1MV', start: '2027-06-07', end: '2027-07-03', classIds: ['c1mvm', 'c1mvpc'], noClass: true });

    // Co-intervention du vendredi (S2) : heure de maths du programme
    const ci = S.slots.find(s => s.type === 'coint' && s.day === 5 && s.semester === 'S2' && s.classIds.includes('c1mvm'));
    if (ci) { ci.classIds = ['c1mvm']; ci.classLabel = '1MV'; ci.counts = true; }

    // Déjà fait avant le stage
    bump();
    const dateOf = hid => hid.split('@')[1].split('#')[0];
    const doneM = { '2026-10-06': 'non_terminee' }, donePC = { '2026-09-29': 'non_terminee' };
    for (const [hid, o] of Object.entries(E.plan().occ)) {
      const d = dateOf(hid);
      if (!o.seanceId || d > '2026-10-16') continue;
      if (o.classId === 'c1mvm') S.occ[hid] = { ...(S.occ[hid] || {}), status: doneM[d] || 'realisee' };
      if (o.classId === 'c1mvpc') S.occ[hid] = { ...(S.occ[hid] || {}), status: donePC[d] || 'realisee' };
    }

    // Progressions initiales figées (dates calculées sur l'emploi du temps)
    bump();
    const p = E.plan();
    for (const c of [m, pc]) {
      const seqs = S.sequences.filter(q => q.classId === c.id).sort((a, b) => a.order - b.order).map(q => {
        const se = S.seances.filter(s => s.sequenceId === q.id).sort((a, b) => a.order - b.order).map(s => ({ title: s.title, date: (p.seance[s.id] || {}).firstDate || null }));
        return { title: q.title, hours: se.length, start: se[0] && se[0].date, end: se.length ? se[se.length - 1].date : null, seances: se };
      });
      const ini = { importedAt: '2026-11-08', source: c.id === 'c1mvm' ? 'Progression_annuelle_Maths_1MV_2026-2027.docx' : 'Plan_des_seances_PC_1MV_2026-2027.docx', capacity: (p.perClass[c.id] || {}).capacity || 0, sequences: seqs };
      ini.text = h.iniText(ini);
      S.initial[c.id] = ini;
    }
    return true;
  },
}, {
  id: '2026-11-08-f',
  label: 'Titres « Révision : thème » et « Évaluation : thème »',
  apply(S, h) {
    const lc = t => /^(Pythagore|Thalès|Archimède)/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
    const rename = (s, seqTitle) => {
      const theme = lc(seqTitle);
      if (s.kind === 'revision' || /^(exercices? de )?r[ée]vision\b(?!.*[ée]valuation)/i.test(s.title)) return `Révision : ${theme}`;
      if (s.kind !== 'evaluation') return s.title;
      if (/r[ée]vision et [ée]valuation/i.test(s.title)) return `Révision et évaluation : ${theme}`;
      if (/ccf/i.test(s.title)) return `Évaluation de CCF : ${theme}`;
      if (/^[ée]valuation\s*:\s*\S/i.test(s.title) && !/^[ée]valuation\s*:\s*(g[ée]om[ée]trie dans|statistique|polyn|d[ée]riv|vecteurs|[ée]nergie|moment)/i.test(s.title)) return s.title; // thème précis déjà donné
      return `Évaluation : ${theme}`;
    };
    let n = 0;
    for (const q of S.sequences) {
      const ss = S.seances.filter(s => s.sequenceId === q.id).sort((a, b) => a.order - b.order);
      const ini = S.initial[q.classId], iq = ini && ini.sequences.find(x => x.title === q.title);
      ss.forEach((s, i) => {
        const t = rename(s, q.title);
        if (t !== s.title) { s.title = t; n++; }
        if (iq && iq.seances[i]) iq.seances[i].title = s.title;
      });
    }
    for (const ini of Object.values(S.initial)) if (ini && ini.sequences) ini.text = h.iniText(ini);
    return n > 0;
  },
}, {
  id: '2026-11-08-g',
  label: 'Majuscule : Pythagore',
  apply(S, h) {
    let n = 0;
    const fix = o => { if (/: pythagore/.test(o.title)) { o.title = o.title.replace(': pythagore', ': Pythagore'); n++; } };
    S.seances.forEach(fix);
    for (const ini of Object.values(S.initial)) if (ini && ini.sequences) { ini.sequences.forEach(q => q.seances.forEach(fix)); ini.text = h.iniText(ini); }
    return n > 0;
  },
}, {
  id: '2026-11-08-h',
  label: 'CAP : séquence 1 depuis le 21 septembre',
  apply(S, h) {
    const { E, uid, norm, bump } = h;
    const byOrder = (a, b) => a.order - b.order;
    const caps = ['ccap1p', 'ccap1m'];
    const firstSeq = cid => S.sequences.filter(q => q.classId === cid).sort(byOrder)[0];
    if (!caps.every(cid => firstSeq(cid) && norm(firstSeq(cid).title).startsWith('proportionnalite'))) return false;
    const dateOf = hid => hid.split('@')[1].split('#')[0];
    // Statuts des cours CAP avant le 7 nov. : on repart de zéro
    const capSlots = new Set([...S.slots, ...S.extras].filter(s => s.classIds.some(c => caps.includes(c))).map(s => s.id));
    for (const k of Object.keys(S.occ)) if (capSlots.has(k.split('@')[0]) && dateOf(k) < '2026-11-07' && S.occ[k].status) {
      delete S.occ[k].status; if (!Object.keys(S.occ[k]).length) delete S.occ[k];
    }
    // Séquence 1 : pourcentages, produit en croix, proportionnalité, échelles, puis révision et évaluation
    const titles = ['Pourcentages', 'Produit en croix', 'Proportionnalité', 'Échelles'];
    for (const cid of caps) {
      const q = firstSeq(cid);
      const keep = S.seances.filter(s => s.sequenceId === q.id && (s.kind === 'revision' || s.kind === 'evaluation')).sort(byOrder);
      S.seances = S.seances.filter(s => s.sequenceId !== q.id || keep.includes(s));
      titles.forEach((t, j) => S.seances.push({ id: uid(), sequenceId: q.id, title: t, kind: 'cours', prepared: true, order: j }));
      keep.forEach((s, j) => { s.order = titles.length + j; });
      S.classes.find(c => c.id === cid).startDate = '2026-09-21';
    }
    // Heures déjà faites : réparties sur les 4 notions ; révision des métalliers le vendredi 6 nov. (2e heure)
    bump();
    const p = E.plan();
    const before = { ccap1p: x => x.date < '2026-11-09', ccap1m: x => x.date < '2026-11-06' || (x.date === '2026-11-06' && x.start < '14:25') };
    for (const cid of caps) {
      const hrs = (p.classHours[cid] || []).filter(x => !(S.occ[x.id] && S.occ[x.id].cancelled));
      const done = hrs.filter(before[cid]);
      const k = done.length, base = Math.floor(k / titles.length), extra = k % titles.length;
      let i = 0;
      for (let j = 0; j < titles.length; j++) {
        const n = base + (j < extra ? 1 : 0);
        for (let m = 0; m < n; m++, i++) S.occ[done[i].id] = { ...(S.occ[done[i].id] || {}), status: m === n - 1 ? 'realisee' : 'non_terminee' };
      }
      if (cid === 'ccap1m') { const rev = hrs.find(x => x.date === '2026-11-06' && x.start >= '14:25'); if (rev) S.occ[rev.id] = { ...(S.occ[rev.id] || {}), status: 'realisee' }; }
    }
    // Progression initiale figée : séquence 1 telle qu'elle a eu lieu
    bump();
    const p2 = E.plan();
    for (const cid of caps) {
      const ini = S.initial[cid], q = firstSeq(cid);
      if (!ini) continue;
      const se = S.seances.filter(s => s.sequenceId === q.id).sort(byOrder).map(s => ({ title: s.title, date: (p2.seance[s.id] || {}).firstDate || null }));
      ini.sequences[0] = { title: q.title, hours: se.length, start: se[0] && se[0].date, end: se.length ? se[se.length - 1].date : null, seances: se };
      ini.capacity = (p2.perClass[cid] || {}).capacity || ini.capacity;
      ini.text = h.iniText(ini);
    }
    return true;
  },
}];
