/* Pilotage pédagogique — interface (version 3). */
(function () {
  'use strict';
  const { iso, parseISO, addDays, weekday, mondayOf, toMin, today, STATUS, SEANCE_STATUS, SLOT_TYPES } = PE;
  const KEY = 'pedago.v3', OLD_KEY = 'pedago.v1';
  let SY = null; // synchronisation en ligne (js/sync.js)
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const clone = o => JSON.parse(JSON.stringify(o));
  const COLORS = ['#2f6fb0', '#c0612b', '#2e8b57', '#8a4fb5', '#b03a5b', '#3a8a8f', '#9a7b1c', '#5a6b7d'];
  const DAYS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const EVENT_TYPES = { pfmp: 'PFMP', examen: 'Examen', formation: 'Absence / formation', pedago: 'Journée pédagogique', sanscours: 'Journée sans cours', autre: 'Autre' };
  const evWhen = ev => `${ev.startTime ? ` ${hm(ev.startTime)}–${hm(ev.endTime)}` : ''}${ev.keepCoint ? ' (co-int. maintenue)' : ''}${ev.makeUp ? ' (à rattraper)' : ''}`;
  const KINDS = { cours: 'Cours', revision: 'Révision', evaluation: 'Évaluation' };
  const hm = t => t ? `${Number(t.slice(0, 2))}h${t.slice(3, 5)}` : '';
  const addYear = d => d ? `${Number(d.slice(0, 4)) + 1}${d.slice(4)}` : d;

  /* ---------- État ---------- */
  function defaultState() {
    return {
      version: 3,
      settings: {
        rentree: '2026-09-01', finAnnee: '2027-07-02', zone: 'B',
        weekAnchors: [{ monday: '2026-11-09', type: 1 }], skipVacations: true, s2Start: '2027-02-01',
        lastExport: null, reminderSnooze: null, holidaysYear: '2026-2027', holidaysSource: 'intégré', holidaysLoadedAt: null,
      },
      classes: [
        { id: 'c2mv', short: '2MV', classe: 'Seconde bac pro MV', matiere: 'Mathématiques', projectUrl: '', startDate: '' },
        { id: 'c1mvm', short: '1MV Maths', classe: 'Première bac pro MV', matiere: 'Mathématiques', projectUrl: '', startDate: '' },
        { id: 'c1mvpc', short: '1MV PC', classe: 'Première bac pro MV', matiere: 'Physique-chimie', projectUrl: '', startDate: '' },
        { id: 'ccap1p', short: 'CAP1 Peint', classe: 'CAP1 Peinture', matiere: 'Mathématiques', projectUrl: '', startDate: '' },
        { id: 'ccap1m', short: 'CAP1 Mét', classe: 'CAP1 Métal', matiere: 'Mathématiques', projectUrl: '', startDate: '' },
      ],
      sequences: [], seances: [], slots: [], extras: [], events: [],
      holidays: PE.FALLBACK_HOLIDAYS['2026-2027'].map(h => ({ ...h })),
      occ: {},          // par heure de cours : statut, annulé, compte comme séance, libre…
      notes: {},        // par créneau daté : contenu (AP, co-intervention, cours libre)
      initial: {},      // copie figée de la progression initiale, par classe
      evaluations: [], exercises: [], quizzes: [], prompts: {}, archives: [],
    };
  }
  function fixSlot(s) {
    if (!Array.isArray(s.classIds)) s.classIds = s.classId ? [s.classId] : [];
    delete s.classId;
    s.type = s.type || (s.classIds.length ? 'cours' : 'hors');
    for (const k of ['group', 'colleague', 'semester', 'label', 'classLabel']) s[k] = s[k] || '';
    if (s.weeks == null) s.weeks = '12';
    return s;
  }
  function iniText(ini) {
    return ini.sequences.map((q, i) => [`SÉQUENCE | ${i + 1} | ${q.title} | ${q.hours}`, ...q.seances.map((x, j) => `${j + 1} | ${x.title} | ${x.date || ''}`)].join('\n')).join('\n');
  }
  function migrate(s) {
    const d = defaultState();
    const hadAnchors = s.settings && Array.isArray(s.settings.weekAnchors);
    s.settings = { ...d.settings, ...(s.settings || {}) };
    if (!hadAnchors && s.settings.week1Ref) s.settings.weekAnchors = [{ monday: mondayOf(s.settings.week1Ref), type: 1 }];
    delete s.settings.week1Ref;
    for (const k of ['classes', 'sequences', 'seances', 'slots', 'extras', 'events', 'holidays', 'evaluations', 'exercises', 'quizzes', 'archives']) if (!Array.isArray(s[k])) s[k] = d[k];
    for (const k of ['occ', 'initial', 'notes', 'prompts', 'homework']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
    s.slots.forEach(fixSlot); s.extras.forEach(fixSlot);
    for (const ini of Object.values(s.initial)) if (ini && !ini.text && Array.isArray(ini.sequences)) ini.text = iniText(ini);
    s.version = 3;
    s._rev = 1;
    return s;
  }
  // Application vide (nouveau navigateur, nouvel appareil) : on part des données de départ (donnees/depart.js)
  const isEmpty = s => !s.slots.length && !s.seances.length;
  const fromDepart = () => window.DEPART ? migrate(clone(window.DEPART)) : null;
  function load() {
    let s = null;
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
      if (raw) s = migrate(JSON.parse(raw));
    } catch (e) { /* ignore */ }
    if ((!s || isEmpty(s)) && window.DEPART) { s = fromDepart(); s._seeded = true; }
    return s || migrate(defaultState());
  }
  let S = load();
  const seeded = !!S._seeded; delete S._seeded;
  const E = PE.Engine(() => S);
  /* Sauvegardes automatiques sur l'appareil : une par jour, et avant chaque remplacement des données
     (récupération en ligne, restauration, effacement). On garde les 8 dernières. */
  const BK = 'pedago.backups';
  function snapshots() { try { return JSON.parse(localStorage.getItem(BK)) || []; } catch (e) { return []; } }
  function snapshot(reason, force) {
    if (isEmpty(S)) return;
    const list = snapshots(), day = today();
    if (!force && list.some(b => b.day === day && b.reason === 'début de journée')) return;
    const { _rev, archives, ...rest } = S;
    list.unshift({ id: uid(), at: new Date().toISOString(), day, reason, data: rest });
    while (list.length > 8) list.pop();
    for (let i = 0; i < 4; i++) { try { localStorage.setItem(BK, JSON.stringify(list)); return; } catch (e) { list.pop(); } }
  }
  snapshot('début de journée');

  // Correctifs de données (donnees/correctifs.js), une seule fois par navigateur
  function applyPatches() {
    const done = S.settings.patches || (S.settings.patches = []);
    const applied = [];
    for (const p of window.PATCHES || []) {
      if (done.includes(p.id)) continue;
      try { if (p.apply(S, { E, uid, norm, iniText, addDays, bump: () => { S._rev++; } })) applied.push(p.label); }
      catch (e) { console.error('Correctif ' + p.id, e); }
      done.push(p.id);
    }
    return applied;
  }
  const patched = applyPatches();
  SY = PSync({
    getData: () => { const { _rev, ...rest } = S; return rest; },
    onRecovery: () => openModal(newPwdModal),
    setData: d => { snapshot('avant récupération en ligne', true); S = migrate(d); const p = applyPatches(); persist(true); render(); drawModal(); toast(p.length ? 'Données récupérées en ligne et mises à jour : ' + p.join(' ; ') : 'Données récupérées en ligne.'); return p.length > 0; },
    isEmpty: () => isEmpty(S),
    onStatus: () => renderSyncBtn(),
    ask: q => confirm(q),
  });
  if (seeded || patched.length) setTimeout(() => {
    if (seeded) persist(); else { persist(true); SY.changed(true); }
    toast(seeded ? 'Emploi du temps et progressions 2026-2027 chargés.' : 'Données mises à jour : ' + patched.join(' ; '));
  }, 0);

  function persist(fromSync) {
    S._rev++;
    try { const { _rev, ...rest } = S; localStorage.setItem(KEY, JSON.stringify(rest)); }
    catch (e) { toast("Impossible d'enregistrer sur cet appareil."); }
    if (SY && !fromSync) SY.changed();
  }
  // save() : enregistre et redessine ; commit() : enregistre sans redessiner (édition de champ)
  function save() { persist(); render(); drawModal(); }
  function commit() { persist(); renderTabs(); }

  /* ---------- Interface ---------- */
  const isPhone = () => matchMedia('(max-width: 720px)').matches;
  const UI = {
    tab: 'agenda', view: isPhone() ? 'day' : 'week', date: today(), libClass: null, progSub: 'effective', progClass: null,
    edtPreview: null, monthSel: today(), iniPreview: null, iniReimport: false, reorg: null, tplKey: 'seance',
  };
  if (weekday(UI.date) === 7 || (weekday(UI.date) === 6 && !hasSaturday())) UI.date = addDays(UI.date, 8 - weekday(UI.date));

  const classById = id => S.classes.find(c => c.id === id);
  const seqById = id => S.sequences.find(q => q.id === id);
  const seanceById = id => S.seances.find(s => s.id === id);
  const classColor = id => COLORS[Math.max(0, S.classes.findIndex(c => c.id === id)) % COLORS.length];
  const blockColor = b => b.classIds.length ? classColor(b.classIds[0]) : '#8a94a6';
  const seqNum = q => E.orderedSequences(q.classId).findIndex(x => x.id === q.id) + 1;
  // Seules les séances de cours sont numérotées : 1, 2, 3, puis « Exercices de révision », puis l'évaluation
  const unnumbered = s => s.kind === 'evaluation' || isRevision(s);
  const seanceNum = s => unnumbered(s) ? '' : E.orderedSeancesOf(s.sequenceId).filter(x => !unnumbered(x)).findIndex(x => x.id === s.id) + 1;
  const blockNames = b => b.classLabel || b.classIds.map(id => classById(id)?.short).filter(Boolean).join(' + ');
  function hasSaturday() { return (S.slots || []).some(s => s.day === 6) || (S.extras || []).some(x => weekday(x.date) === 6); }
  const findSrc = id => S.slots.find(x => x.id === id) || S.extras.find(x => x.id === id);

  const fmt = (d, o) => parseISO(d).toLocaleDateString('fr-FR', o || { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtLong = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const head = c => `Classe : ${c.short} (${c.classe}) — ${c.matiere}`;
  const P = (key, vars) => PROMPTS.render(key, vars, S.prompts);

  function hourInfo(id) {
    const [src, rest] = id.split('@'); const [date, idx] = rest.split('#');
    const b = E.blocksOn(date).find(x => x.srcId === src);
    return b ? { block: b, hour: b.hours[Number(idx)], date } : null;
  }

  async function copy(text, what, where) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) { /* ignore */ }
      ta.remove();
    }
    toast((what || 'Prompt') + ' copié — collez-le dans ' + (where || 'Claude') + '.');
  }

  let toastTimer = null, undoFn = null;
  function toast(msg, undo) {
    const t = document.getElementById('toast');
    undoFn = undo || null;
    t.innerHTML = esc(msg) + (undo ? ' <button data-a="undo">Annuler</button>' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; undoFn = null; }, undo ? 6000 : 3000);
  }

  let modalFn = null;
  function openModal(fn) { modalFn = fn; drawModal(); }
  function closeModal() { modalFn = null; drawModal(); }
  function drawModal() {
    const m = document.getElementById('modal');
    const html = modalFn ? modalFn() : null;
    if (html == null) { modalFn = null; m.hidden = true; m.innerHTML = ''; document.body.classList.remove('noscroll'); return; }
    m.hidden = false; document.body.classList.add('noscroll');
    m.innerHTML = `<div class="mbox" role="dialog" aria-modal="true"><button class="mclose" data-a="closeModal" aria-label="Fermer">×</button>${html}</div>`;
  }

  /* ---------- Connexion et synchronisation ---------- */
  const SYNC_LABEL = { local: '', deconnecte: '☁ Se connecter', ok: '☁ ✓', envoi: '☁ …', attente: '☁ …', erreur: '☁ ⚠' };
  const SYNC_TITLE = { deconnecte: 'Se connecter pour retrouver ses données sur tous ses appareils', ok: 'Données à jour en ligne', envoi: 'Synchronisation en cours', attente: 'Envoi en ligne dans quelques secondes', erreur: 'Problème de synchronisation' };
  function renderSyncBtn() {
    const b = document.getElementById('syncBtn'); if (!b || !SY) return;
    b.hidden = !SY.enabled;
    b.textContent = SYNC_LABEL[SY.status] || '';
    b.title = SYNC_TITLE[SY.status] || '';
    b.className = 'syncbtn s-' + SY.status;
    if (modalFn === syncModal) drawModal();
  }
  function syncModal() {
    if (!SY || !SY.enabled) return `<h2>Données en ligne</h2><p>La synchronisation n'est pas encore configurée.</p>`;
    if (!SY.user) return `<h2>Connexion</h2>
      <p class="small muted">Connectez-vous pour retrouver vos données sur l'ordinateur, le téléphone et la tablette.</p>
      <form class="form" data-form="login">
        <label>Adresse e-mail <input type="email" name="email" autocomplete="username" required></label>
        <label>Mot de passe <input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
        <div class="row"><button type="submit" value="in">Se connecter</button><button type="submit" class="ghost" value="up">Créer mon compte</button></div>
        <p class="small"><a href="#" data-a="forgotPwd">Mot de passe oublié ?</a></p>
      </form>${SY.error ? `<p class="bad small">${esc(SY.error)}</p>` : ''}`;
    return `<h2>Données en ligne</h2>
      <p>Connecté : <b>${esc(SY.user.email)}</b></p>
      <p>${{ ok: '✓ Tout est à jour en ligne.', envoi: 'Synchronisation en cours…', attente: 'Envoi dans quelques secondes…', erreur: '⚠ La dernière synchronisation a échoué (pas de réseau ?). Vos données restent sur l\'appareil ; nouvel essai automatique.' }[SY.status] || ''}</p>
      ${SY.error ? `<p class="bad small">${esc(SY.error)}</p>` : ''}
      <div class="row"><button data-a="syncNow">Synchroniser maintenant</button><button class="ghost" data-a="signOut">Se déconnecter</button></div>`;
  }

  /* ---------- À faire : prochaines séances à préparer, toutes classes ---------- */
  function renderTodo() {
    const p = E.plan(), t = today(), rows = [];
    for (const c of S.classes) for (const s of E.orderedSeances(c.id)) {
      const i = p.seance[s.id];
      if (s.skipped || s.prepared || !i || !i.firstDate || i.firstDate < t || i.status) continue;
      rows.push({ c, s, date: i.firstDate });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const list = rows.slice(0, 25);
    return `<section class="card"><h2>À préparer</h2>
      <p class="small muted">Les prochaines séances pas encore préparées, toutes classes confondues.</p>
      ${list.length ? `<ul class="plain">${list.map(r => `<li style="--cc:${classColor(r.c.id)}"><b>${esc(fmt(r.date))}</b> · <b>${esc(r.c.short)}</b> · <a href="#" data-a="openSeance" data-id="${r.s.id}">${seanceLabel(r.s, false)}</a>
        <span class="row"><button class="ghost small" data-a="copySeance" data-id="${r.s.id}">Copier le prompt</button><button class="ghost small" data-a="markPrepared" data-id="${r.s.id}">☐ Préparée</button></span></li>`).join('')}</ul>` : '<p class="muted">Tout est préparé.</p>'}
      ${rows.length > list.length ? `<p class="small muted">… et ${rows.length - list.length} autres plus tard.</p>` : ''}</section>` + evalBoard();
  }
  // Suivi des évaluations : celles passées pas encore bouclées, puis les prochaines
  function evalBoard() {
    const p = E.plan(), t = today(), rows = [];
    for (const c of S.classes) for (const s of E.orderedSeances(c.id)) {
      const i = p.seance[s.id];
      if (s.kind !== 'evaluation' || s.skipped || !i || !i.date) continue;
      rows.push({ c, s, date: i.date, past: i.date < t });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const pending = rows.filter(r => r.past && !(r.s.corrected && r.s.graded));
    const next = rows.filter(r => !r.past).slice(0, 10);
    const box = (s, f, label) => `<label class="check small"><input type="checkbox" data-c="evalFlag" data-id="${s.id}" data-f="${f}" ${s[f] ? 'checked' : ''}> ${label}</label>`;
    const line = r => `<li style="--cc:${classColor(r.c.id)}"><b>${esc(fmt(r.date))}</b> · <b>${esc(r.c.short)}</b> · <a href="#" data-a="openSeance" data-id="${r.s.id}">${seanceTitle(r.s)}</a>
      <span class="row">${box(r.s, 'prepared', 'Sujet prêt')}${r.past ? box(r.s, 'corrected', 'Copies corrigées') + box(r.s, 'graded', 'Notes saisies') : ''}</span></li>`;
    return `<section class="card"><h2>Évaluations</h2>
      ${pending.length ? `<h3>À boucler (${pending.length})</h3><ul class="plain">${pending.map(line).join('')}</ul>` : ''}
      <h3>À venir</h3>${next.length ? `<ul class="plain">${next.map(line).join('')}</ul>` : '<p class="muted small">Aucune évaluation à venir.</p>'}</section>`;
  }
  function newPwdModal() {
    return `<h2>Nouveau mot de passe</h2>
      <form class="form" data-form="newpwd">
        <label>Nouveau mot de passe <input type="password" name="password" autocomplete="new-password" minlength="6" required></label>
        <div class="row"><button type="submit">Enregistrer</button></div>
      </form>`;
  }

  /* ---------- Rendu principal ---------- */
  function renderTabs() {
    const n = E.unvalidatedList().length;
    const tabs = [['agenda', 'Agenda', '▦'], ['afaire', 'À faire', '✔'], ['progression', 'Progression', '↗'], ['bibliotheque', 'Bibliothèque', '❐'], ['reglages', 'Réglages', '⚙']];
    document.getElementById('tabs').innerHTML = tabs.map(([k, l, i]) =>
      `<button data-a="tab" data-tab="${k}" class="${UI.tab === k ? 'on' : ''}" ${UI.tab === k ? 'aria-current="page"' : ''}><span class="ti" aria-hidden="true">${i}</span><span class="tl">${l}</span>${k === 'agenda' && n ? `<span class="badge">${n}</span>` : ''}</button>`).join('');
  }
  let lastPhone = isPhone();
  function render() {
    lastPhone = isPhone();
    renderTabs();
    const fn = { agenda: renderAgenda, afaire: renderTodo, progression: renderProgression, bibliotheque: renderLibrary, reglages: renderSettings }[UI.tab];
    document.getElementById('view').innerHTML = fn();
  }

  function reminderBanner() {
    const hasData = S.slots.length || S.seances.length;
    if (!hasData) return '';
    const last = S.settings.lastExport, snooze = S.settings.reminderSnooze, t = today();
    if (snooze && snooze > t) return '';
    if (last && addDays(last, 30) > t) return '';
    return `<div class="banner">Pensez à exporter vos données (dernier export : ${last ? fmt(last) : 'jamais'}).
      <button data-a="export">Exporter</button><button class="ghost" data-a="snooze">Plus tard</button></div>`;
  }

  /* ---------- Agenda ---------- */
  function renderAgenda() {
    const unv = E.unvalidatedList();
    const v = UI.view, week = v === 'week';
    const wt = E.weekType(UI.date), other = 3 - wt;
    const title = {
      week: `Semaine du ${fmt(mondayOf(UI.date), { day: 'numeric', month: 'long' })}`,
      day: fmtLong(UI.date),
      month: fmt(UI.date, { month: 'long', year: 'numeric' }),
      year: `Année ${S.settings.rentree.slice(0, 4)}-${S.settings.finAnnee.slice(0, 4)}`,
    }[v];
    let h = reminderBanner() + dashboard();
    if (!S.slots.length && !S.extras.length)
      h += `<div class="card notice">Aucun emploi du temps pour l'instant. <button data-a="goto" data-tab="reglages" data-sec="sec-edt">Importer l'emploi du temps</button></div>`;
    else if (!S.seances.length)
      h += `<div class="card notice">Aucune séance dans la bibliothèque : les créneaux s'affichent sans titre. <button data-a="goto" data-tab="progression">Importer une progression</button></div>`;
    h += `<div class="toolbar">
      <div class="seg" role="group" aria-label="Vue">
        ${[['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ['year', 'Année']].map(([k, l]) => `<button data-a="view" data-v="${k}" class="${v === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      ${v !== 'year' ? `<div class="navbtns">
        <button data-a="step" data-n="-1" aria-label="Précédent">‹</button>
        <button data-a="today">Aujourd'hui</button>
        <button data-a="step" data-n="1" aria-label="Suivant">›</button>
      </div>` : ''}
      <div class="ttl">${v === 'day' || week ? `<span class="qpill q${wt}" title="Semaine ${E.weekLabel(wt)}">${E.weekLabel(wt)}</span>` : ''}<strong>${esc(title)}</strong>
        ${v === 'day' || week ? `<span class="semtag">${E.semesterOf(UI.date)}</span>
        <button class="pill" data-a="switchWeek" title="Aller à la prochaine semaine ${E.weekLabel(other)}">→ ${E.weekLabel(other)}</button>
        <button class="pill" data-a="forceWeek" title="Dire si cette semaine est Q1 ou Q2">Corriger</button>` : ''}</div>
      ${unv.length ? `<button class="warnbtn" data-a="unvalidated">À valider (${unv.length})</button>` : ''}    </div>`;
    h += `<div id="swipe">${{ day: dayView, week: weekView, month: monthView, year: yearView }[v]()}</div>`;
    return h;
  }

  function statusButtons(hid, compact) {
    return `<div class="val">${Object.entries(STATUS).map(([k, v]) =>
      `<button class="vb vb-${k}" data-a="validate" data-h="${hid}" data-s="${k}" title="${v.label}" aria-label="${v.label}">${v.icon}${compact ? '' : ' ' + v.label}</button>`).join('')}</div>`;
  }
  const kindTag = () => '';
  const numTxt = s => unnumbered(s) ? s.title : `${seanceNum(s)}. ${s.title}`;
  const isRevision = s => s.kind === 'revision' || /^(exercices? de )?r[ée]vision/i.test(s.title);
  const seanceTitle = s => s.kind === 'evaluation' ? `<b class="evalt">${esc(s.title)}</b>` : isRevision(s) ? `<b>${esc(s.title)}</b>` : esc(s.title);
  const seanceLabel = (s, cont) => `${unnumbered(s) ? '' : seanceNum(s) + '. '}${seanceTitle(s)}${cont ? ' (suite)' : ''}`;
  function hourHtml(h, compact) {
    const o = E.plan().occ[h.id];
    if (!o) return `<div class="hr muted">—</div>`;
    if (o.cancelled) {
      const mv = S.occ[h.id] && S.occ[h.id].moved;
      return `<div class="hr muted"><span class="strike">${mv ? 'Cours déplacé' : 'Cours annulé'}</span>${mv ? ` → ${esc(fmt(mv))}` : ''}</div>`;
    }
    if (o.reserved) return `<div class="hr muted"><a href="#" class="sl" data-a="hourMenu" data-h="${h.id}">Cours libre (marge)</a></div>`;
    if (o.free) return `<div class="hr muted">Pas de séance prévue</div>`;
    const s = seanceById(o.seanceId);
    let label = seanceLabel(s, o.cont);
    if (o.multi) label = o.multi.map(x => { const sx = seanceById(x.seanceId); return sx ? `<span class="grp">${esc(classById(x.classId)?.short)}</span> ${seanceLabel(sx, x.cont)}` : ''; }).join('<br>');
    else if (o.split) label = o.split.map(x => { const sx = seanceById(x.seanceId); return sx ? `<span class="grp">${esc(x.group)}</span> ${seanceLabel(sx, x.cont)}` : ''; }).join('<br>');
    let st = '';
    if (o.status) st = `<button class="st st-${o.status}" data-a="hourMenu" data-h="${h.id}" title="${STATUS[o.status].label} — modifier">${STATUS[o.status].icon}${compact ? '' : ' ' + STATUS[o.status].label}</button>`;
    else if (o.past) st = statusButtons(h.id, compact);
    const doc = s.docUrl && !o.multi && !o.split ? `<a class="doclink" href="${esc(s.docUrl)}" target="_blank" rel="noopener" title="Ouvrir la fiche">📎</a>` : '';
    return `<div class="hr ${o.past && !o.status ? 'pending' : ''}"><a href="#" class="sl" data-a="openSeance" data-id="${s.id}">${label}</a>${doc}${st}</div>`;
  }
  function blockHtml(b, compact, style) {
    const css = ` style="--cc:${blockColor(b)};${style || ''}"`;
    const names = blockNames(b);
    const typ = b.type === 'ap' ? '<span class="ty ty-ap">AP</span>' : b.type === 'coint' ? '<span class="ty ty-coint">Co-int.</span>' : '';
    if (b.type === 'hors' && !b.classIds.length)
      return `<div class="blk hors"${css} data-a="block" data-id="${b.id}"><div class="bh"><span>${hm(b.start)}–${hm(b.end)}</span> ${esc(b.label || names || 'Hors progression')}</div>${b.note ? `<div class="note">${esc(b.note)}</div>` : ''}</div>`;
    const grp = b.group ? ` · ${esc(b.group)}` : '';
    const coll = b.colleague ? ` · ${esc(b.colleague)}` : '';
    let inner = `<div class="bh" data-a="block" data-id="${b.id}"><span>${hm(b.start)}–${hm(b.end)}</span> ${typ}<b>${esc(names || b.label)}</b>${grp}${coll}${b.extra ? ' · ponctuel' : ''}<span class="more" aria-hidden="true">⋯</span></div>`;
    if (b.blocked) inner += `<div class="hr blk-why">${esc(b.blocked)}</div>`;
    else {
      inner += b.hours.filter(x => x.counts).map(x => hourHtml(x, compact)).join('');
      // AP : la transformer en heure de maths (ou revenir à l'AP) en un clic
      if (b.type === 'ap' && b.classIds.length === 1) inner += `<div class="apsw">${b.hours.map(x => {
        if (S.occ[x.id] && S.occ[x.id].cancelled) return '';
        return x.counts ? `<button class="mini" data-a="toggleCounts" data-h="${x.id}" title="Rendre cette heure à l'accompagnement">↩ Remettre en AP</button>`
          : `<button class="mini" data-a="toggleCounts" data-h="${x.id}" title="Faire une heure de maths (séance de progression) à la place de l'AP">→ Faire des maths</button>`;
      }).join('')}</div>`;
      if (b.note) inner += `<div class="note" data-a="block" data-id="${b.id}">${esc(b.note)}</div>`;
    }
    return `<div class="blk t-${b.type}${b.blocked ? ' off' : ''}"${css}>${inner}</div>`;
  }
  function dayBadges(d) {
    const off = E.dayOff(d);
    let h = off && off !== 'Hors année scolaire' ? `<span class="tag off">${esc(off)}</span>` : '';
    // Stages, examens, absences : pas d'étiquette, les cours concernés sont hachurés en rouge
    for (const ev of E.eventsOn(d)) {
      if (ev.noClass) continue;
      const cls = ev.classIds.length ? ' · ' + ev.classIds.map(id => classById(id)?.short).filter(Boolean).join(', ') : '';
      h += `<span class="tag ev-${ev.type}">${esc(ev.label || EVENT_TYPES[ev.type])}${esc(evWhen(ev))}${esc(cls)}</span>`;
    }
    for (const ev of S.evaluations.filter(x => x.date === d)) {
      const q = seqById(ev.sequenceId); const c = q && classById(q.classId);
      if (c) h += `<a href="#" class="tag ev-examen" data-a="evalForm" data-id="${ev.id}">Évaluation · ${esc(c.short)}</a>`;
    }
    return h;
  }

  function weekView() {
    const mon = mondayOf(UI.date);
    const n = hasSaturday() ? 6 : 5;
    const days = Array.from({ length: n }, (_, i) => addDays(mon, i));
    const t = today();
    if (isPhone()) {
      // Téléphone : la semaine en liste, jour par jour
      return `<div class="wlist">${days.map(d => {
        const bs = E.blocksOn(d), off = E.dayOff(d);
        return `<section class="wday ${d === t ? 'today' : ''}"><h3><a href="#" data-a="gotoDay" data-d="${d}">${esc(fmt(d, { weekday: 'long', day: 'numeric', month: 'short' }))}</a> ${dayBadges(d)}</h3>
          ${bs.length ? `<div class="daylist">${bs.map(b => blockHtml(b, false)).join('')}</div>` : `<div class="muted small">${esc(off || 'Pas de cours')}</div>`}</section>`;
      }).join('')}</div>`;
    }
    const blocks = days.map(d => E.blocksOn(d));
    let lo = 8 * 60, hi = 17 * 60;
    for (const bs of blocks) for (const b of bs) { lo = Math.min(lo, toMin(b.start)); hi = Math.max(hi, toMin(b.end)); }
    lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
    const PPM = 1.5, H = (hi - lo) * PPM;
    let h = `<div class="week" style="--cols:${n}"><div class="wh"></div>`;
    days.forEach(d => { h += `<div class="wh ${d === t ? 'today' : ''}"><a href="#" data-a="gotoDay" data-d="${d}">${esc(fmt(d))}</a>${dayBadges(d)}</div>`; });
    h += `<div class="gut" style="height:${H}px">`;
    for (let m = lo; m < hi; m += 60) h += `<span style="top:${(m - lo) * PPM}px">${m / 60}h</span>`;
    h += `</div>`;
    days.forEach((d, i) => {
      const off = E.dayOff(d);
      h += `<div class="col ${d === t ? 'today' : ''} ${off ? 'offday' : ''}" style="height:${H}px">`;
      for (let m = lo + 60; m < hi; m += 60) h += `<i class="hl" style="top:${(m - lo) * PPM}px"></i>`;
      // créneaux simultanés (ex. AP Q1 / Q2 n'existent pas la même semaine, mais deux cours ponctuels oui) : côte à côte
      const bs = blocks[i];
      bs.forEach((b, j) => {
        const top = (toMin(b.start) - lo) * PPM, ht = Math.max(28, (toMin(b.end) - toMin(b.start)) * PPM - 2);
        const lane = bs.filter((x, k) => k < j && toMin(x.end) > toMin(b.start) && toMin(x.start) < toMin(b.end)).length;
        const lanes = 1 + bs.filter((x, k) => k !== j && toMin(x.end) > toMin(b.start) && toMin(x.start) < toMin(b.end)).length;
        const side = lanes > 1 ? `left:calc(${(lane / lanes) * 100}% + 2px);right:auto;width:calc(${100 / lanes}% - 4px);` : '';
        h += blockHtml(b, true, `top:${top}px;height:${ht}px;${side}`);
      });
      h += `</div>`;
    });
    return h + `</div>`;
  }

  function dayView() {
    const d = UI.date;
    const off = E.dayOff(d);
    const bs = E.blocksOn(d);
    let h = `<div class="dayhead">${dayBadges(d)}</div>`;
    if (!bs.length) h += `<div class="empty">${off ? esc(off) : 'Pas de cours ce jour.'}</div>`;
    h += `<div class="daylist">${bs.map(b => blockHtml(b, false)).join('')}</div>`;
    h += `<p class="hint phone-only">Glissez vers la gauche ou la droite pour changer de jour.</p>`;
    return h;
  }

  /* ---------- Tableau de bord ---------- */
  function deltaText(delta, unv) {
    if (delta == null) return '';
    const tip = 'title="Comparaison avec la progression figée, à la date d\'aujourd\'hui : séances faites − séances qui devaient être faites."';
    if (delta === 0) return `<span class="dl ok" ${tip}>à jour sur le plan</span>`;
    if (delta > 0) return `<span class="dl ok" ${tip}>${delta} h d'avance sur le plan</span>`;
    const pend = Math.min(unv || 0, -delta);
    if (pend === -delta) return `<span class="dl warn">${pend} cours à valider</span>`;
    return `<span class="dl bad">${-delta} h de retard${pend ? `, dont ${pend} à valider` : ''}</span>`;
  }
  function dashboard() {
    if (!S.classes.length || (!S.slots.length && !S.extras.length) || !S.seances.length) return '';
    let open = !isPhone();
    try { const v = localStorage.getItem('pedago.ui.dash'); if (v != null) open = v === '1'; } catch (e) { /* ignore */ }
    const cards = S.classes.map(c => {
      const k = E.compare(c.id);
      if (!k || !k.seances) return '';
      const planned = k.plannedHours != null ? k.plannedHours : k.seances;
      const up = E.upcoming(c.id, 2);
      return `<div class="dc" style="--cc:${classColor(c.id)}">
        <div class="dch"><b>${esc(c.short)}</b>${deltaText(k.delta, k.unvalidated)}</div>
        <div class="dcn"><b>Programme : ${k.seances} h</b> · fait ${k.seances - k.remainingSeances} · <b>reste ${k.remainingSeances} h</b> · séquences ${k.seqDone} / ${k.seqTotal}</div>
        ${futureSplit(c.id, k)}
        ${k.margin < 0 || k.unplaced ? `<a href="#" class="dcn threat" data-a="threat" data-id="${c.id}">⚠ Programme menacé : ${k.unplaced ? `${k.unplaced} séance(s) sans créneau` : `il manque ${-k.margin} h`}${k.tracks ? ` (${esc(k.worstGroup)})` : ''} — voir</a>` : ''}
        ${up.map(u => { const s = seanceById(u.occ.seanceId); return `<a href="#" class="dcu" data-a="openSeance" data-id="${s.id}">${esc(fmt(u.hour.date))} · ${esc(numTxt(s))}</a>`; }).join('')}
      </div>`;
    }).join('');
    if (!cards.trim()) return '';
    return `<details class="dash" id="dash" ${open ? 'open' : ''}><summary>Tableau de bord</summary><div class="dcards">${cards}</div></details>`;
  }

  /* ---------- Vue mois ---------- */
  function hourShort(h) {
    const o = E.plan().occ[h.id];
    if (!o) return '';
    if (o.cancelled) return '<s>annulé</s>';
    if (o.reserved) return 'libre';
    if (!o.seanceId) return '';
    const s = seanceById(o.seanceId);
    return `${o.status ? STATUS[o.status].icon + ' ' : ''}${seanceLabel(s, false)}`;
  }
  function monthView() {
    const ym = UI.date.slice(0, 7), t = today();
    const n = hasSaturday() ? 6 : 5;
    let wk = mondayOf(ym + '-01');
    let h = `<div class="month" style="--cols:${n}"><div class="mhd"></div>`;
    for (let i = 0; i < n; i++) h += `<div class="mhd">${DAYS[i + 1].slice(0, 3)}.</div>`;
    while (wk.slice(0, 7) <= ym) {
      const wt = E.weekType(wk);
      h += `<div class="mwk q${wt}" title="Semaine ${E.weekLabel(wt)}">${E.weekLabel(wt)}</div>`;
      for (let i = 0; i < n; i++) {
        const d = addDays(wk, i), inM = d.slice(0, 7) === ym;
        const off = E.dayOff(d), bs = inM ? E.blocksOn(d).filter(b => b.classIds.length) : [];
        const lines = bs.map(b => {
          const txt = b.blocked ? esc(b.blocked) : (b.hours.filter(x => x.counts).map(hourShort).filter(Boolean).join(' / ') || (b.type === 'ap' ? 'AP' : b.type === 'coint' ? 'co-int.' : ''));
          return `<div class="ml" style="--cc:${blockColor(b)}"><b>${esc(blockNames(b))}</b> ${txt}</div>`;
        }).join('');
        const dots = bs.filter(b => b.hours.some(x => x.counts)).map(b => `<i style="--cc:${blockColor(b)}"></i>`).join('');
        h += `<button class="mc ${inM ? '' : 'out'} ${off ? 'off' : ''} ${d === t ? 'today' : ''} ${d === UI.monthSel ? 'sel' : ''}" data-a="monthDay" data-d="${d}">
          <span class="mn">${Number(d.slice(8))}</span>${inM ? dayBadges(d) : ''}
          <span class="mlines">${lines}</span><span class="mdots">${dots}</span></button>`;
      }
      wk = addDays(wk, 7);
    }
    h += `</div>`;
    if (UI.monthSel && UI.monthSel.slice(0, 7) === ym) {
      const bs = E.blocksOn(UI.monthSel);
      h += `<div class="mdetail phone-only"><h3>${esc(fmtLong(UI.monthSel))} · ${E.weekLabel(E.weekType(UI.monthSel))}</h3>
        ${!bs.length ? `<div class="empty">${esc(E.dayOff(UI.monthSel) || 'Pas de cours ce jour.')}</div>` : `<div class="daylist">${bs.map(b => blockHtml(b, false)).join('')}</div>`}</div>`;
    }
    return h;
  }

  /* ---------- Vue année ---------- */
  function yearView() {
    const a = S.settings.rentree, b = S.settings.finAnnee;
    const span = (parseISO(b) - parseISO(a)) / 86400000 + 1;
    const x = d => Math.max(0, Math.min(100, ((parseISO(d < a ? a : d) - parseISO(a)) / 86400000) / span * 100));
    const w = (s, e) => Math.max(0.4, x(addDays(e, 1)) - x(s));
    let months = '';
    for (let d = parseISO(a.slice(0, 8) + '01'); iso(d) <= b; d.setMonth(d.getMonth() + 1)) {
      const s = iso(d);
      months += `<span style="left:${x(s)}%">${d.toLocaleDateString('fr-FR', { month: 'short' })}</span>`;
    }
    const bands = S.holidays.filter(v => v.end >= a && v.start <= b)
      .map(v => `<i class="band" style="left:${x(v.start)}%;width:${w(v.start, v.end)}%" title="${esc(v.label)}"></i>`).join('');
    const globalEv = S.events.filter(ev => !ev.classIds.length && ev.noClass)
      .map(ev => `<i class="band ev" style="left:${x(ev.start)}%;width:${w(ev.start, ev.end)}%" title="${esc(ev.label)}"></i>`).join('');
    const t = today();
    const todayLine = t >= a && t <= b ? `<i class="tline" style="left:${x(t)}%"></i>` : '';
    let rows = '';
    for (const c of S.classes) {
      const col = classColor(c.id);
      const evs = S.events.filter(ev => ev.classIds.includes(c.id))
        .map(ev => `<i class="cev ev-${ev.type}" style="left:${x(ev.start)}%;width:${w(ev.start, ev.end)}%" title="${esc(ev.label)} : ${esc(fmt(ev.start))} → ${esc(fmt(ev.end))}">${esc(EVENT_TYPES[ev.type])}</i>`).join('');
      const seqs = E.orderedSequences(c.id).map((q, i) => {
        const sp = E.sequenceSpan(q.id);
        if (!sp.start) return '';
        return `<a href="#" class="ybar" data-a="yearSeq" data-id="${q.id}" style="left:${x(sp.start)}%;width:${w(sp.start, sp.end)}%" title="Séquence ${i + 1} – ${esc(q.title)} : ${esc(fmt(sp.start))} → ${esc(fmt(sp.end))}">S${i + 1} ${esc(q.title)}</a>`;
      }).join('');
      const ini = S.initial[c.id];
      const iniBars = ini ? ini.sequences.filter(q => q.start).map((q, i) =>
        `<i class="ibar" style="left:${x(q.start)}%;width:${w(q.start, q.end)}%" title="Prévu — S${i + 1} ${esc(q.title)} : ${esc(fmt(q.start))} → ${esc(fmt(q.end))}"></i>`).join('') : '';
      rows += `<div class="yrow" style="--cc:${col}"><div class="ylab">${esc(c.short)}</div><div class="ytrack">${evs}${seqs}${iniBars}</div></div>`;
    }
    return `<div class="yearwrap"><div class="year">
      <div class="yrow yhead"><div class="ylab"></div><div class="ytrack ymonths">${months}</div></div>
      <div class="ybody"><div class="ybands">${bands}${globalEv}${todayLine}</div>${rows}</div>
    </div></div>
    <p class="small muted legend"><span class="lg l1"></span> séquences (déroulé effectif et prévisions) <span class="lg l2"></span> progression initiale figée <span class="lg l3"></span> vacances <span class="lg l4"></span> PFMP / examens</p>`;
  }

  function stepDate(n) {
    if (UI.view === 'year') return;
    if (UI.view === 'week') { UI.date = addDays(UI.date, 7 * n); }
    else if (UI.view === 'month') {
      const d = parseISO(UI.date.slice(0, 8) + '01'); d.setMonth(d.getMonth() + n);
      UI.date = iso(d); UI.monthSel = UI.date;
    } else {
      let d = UI.date;
      do { d = addDays(d, n); } while (weekday(d) === 7 || (weekday(d) === 6 && !hasSaturday()));
      UI.date = d;
    }
    render();
  }

  function setOcc(hid, fn) {
    const rec = { ...(S.occ[hid] || {}) };
    fn(rec);
    if (Object.keys(rec).filter(k => k !== 'imp').length) S.occ[hid] = rec; else delete S.occ[hid];
  }
  function setStatus(hid, status) {
    const prev = S.occ[hid] ? { ...S.occ[hid] } : null;
    setOcc(hid, r => { if (status) r.status = status; else delete r.status; });
    save();
    if (status) toast(STATUS[status].label, () => { if (prev) S.occ[hid] = prev; else delete S.occ[hid]; save(); });
  }
  function setCancelled(hids, cancelled) {
    for (const id of hids) setOcc(id, r => { if (cancelled) { r.cancelled = true; delete r.status; } else { delete r.cancelled; delete r.moved; } });
    save();
  }

  function hourToggles(x, b) {
    if (!b.classIds.length || b.blocked) return '';
    const rec = S.occ[x.id] || {};
    let h = '';
    if (!x.defaultCounts) h += `<button class="ghost small" data-a="toggleCounts" data-h="${x.id}">${x.counts ? 'Ne plus en faire une séance' : 'Faire une séance de progression ici'}</button>`;
    else if (S.occ[x.id] && S.occ[x.id].counts === false) h += `<button class="ghost small" data-a="toggleCounts" data-h="${x.id}">Remettre une séance</button>`;
    if (x.counts && !rec.cancelled && rec.reserved) h += `<button class="ghost small" data-a="toggleReserved" data-h="${x.id}">Remettre une séance</button>`;
    // Fixer une séance précise sur cette heure (sinon : la suivante dans l'ordre de la progression)
    let pin = '';
    if (x.counts && !rec.cancelled && b.classIds.length === 1) {
      const opts = E.orderedSequences(b.classIds[0]).map(q => `<optgroup label="Séq. ${seqNum(q)} – ${esc(q.title)}">${E.orderedSeancesOf(q.id).filter(s => !s.skipped).map(s => `<option value="${s.id}" ${rec.pin === s.id ? 'selected' : ''}>${esc(numTxt(s))}</option>`).join('')}</optgroup>`).join('');
      pin = `<label class="field small">Séance de cette heure <select data-c="pin" data-h="${x.id}"><option value="">Automatique (suite de la progression)</option>${opts}</select></label>`;
    }
    return (h ? `<div class="row">${h}</div>` : '') + pin;
  }
  function hourModal(hid) {
    return () => {
      const info = hourInfo(hid); if (!info) return null;
      const o = E.plan().occ[hid] || {};
      const b = info.block;
      const s = o.seanceId ? seanceById(o.seanceId) : null;
      let h = `<h2>${esc(blockNames(b))} · ${esc(fmt(info.date))} ${hm(info.hour.start)}–${hm(info.hour.end)}</h2>`;
      if (s) h += `<p><a href="#" data-a="openSeance" data-id="${s.id}">${seanceLabel(s, o.cont)}</a></p>`;
      if (o.cancelled) h += `<p class="muted">Ce cours est annulé.</p><button data-a="cancelHours" data-ids="${hid}" data-v="0">Rétablir le cours</button>`;
      else {
        if (o.reserved) h += `<p class="muted">Cours gardé libre : aucune séance de progression (marge, reprise, exercices).</p>`;
        else h += `<p class="muted">Statut : ${o.status ? STATUS[o.status].label : 'non validé'}</p>`;
        if (s) h += statusButtons(hid, false) + (o.status ? `<p><button class="ghost" data-a="validate" data-h="${hid}" data-s="">Effacer la validation</button></p>` : '');
        h += hourToggles(info.hour, b);
        h += `<p><button class="ghost" data-a="cancelHours" data-ids="${hid}" data-v="1">Annuler ce cours (n'a pas lieu)</button></p>`;
      }
      return h;
    };
  }
  function blockModal(bid) {
    return () => {
      const [src, date] = bid.split('@');
      const b = E.blocksOn(date).find(x => x.srcId === src); if (!b) return null;
      const typeLabel = SLOT_TYPES[b.type] || '';
      let h = `<h2>${esc(blockNames(b) || b.label || 'Hors progression')}</h2>
        <p class="muted">${esc(fmtLong(date))} · ${hm(b.start)}–${hm(b.end)} · ${esc(typeLabel)}${b.group ? ' · ' + esc(b.group) : ''}${b.colleague ? ' · avec ' + esc(b.colleague) : ''} · ${E.weekLabel(E.weekType(date))}</p>`;
      if (b.classIds.length && !b.blocked) {
        h += b.hours.map(x => `<div class="mh"><div class="muted small">${hm(x.start)}–${hm(x.end)}${x.counts ? '' : ' · pas de séance de progression'}</div>${x.counts ? hourHtml(x, false) : ''}${hourToggles(x, b)}</div>`).join('');
        const ids = b.hours.map(x => x.id).join(',');
        const allCancelled = b.hours.every(x => S.occ[x.id] && S.occ[x.id].cancelled);
        h += `<p class="row"><button class="ghost" data-a="cancelHours" data-ids="${ids}" data-v="${allCancelled ? 0 : 1}">${allCancelled ? 'Rétablir le cours' : 'Annuler ce cours'}</button></p>`;
        if (!allCancelled) h += `<details class="edit"><summary>Déplacer ce cours</summary>
          <form class="form" data-form="move" data-id="${b.id}">
            <label>Nouvelle date <input type="date" name="date" value="${date}" required></label>
            <label>Début <input type="time" name="start" value="${b.start}" required></label>
            <label>Fin <input type="time" name="end" value="${b.end}" required></label>
            <div class="row"><button type="submit">Déplacer</button></div>
          </form><p class="small muted">Le cours d'origine est marqué « déplacé » et un cours ponctuel est créé à la nouvelle date ; les séances suivent l'ordre chronologique.</p></details>`;
      } else if (b.blocked) h += `<p>${esc(b.blocked)} : pas de cours.</p>`;
      h += `<label class="field">Contenu / note de ce cours <textarea rows="2" data-c="note" data-id="${b.id}" placeholder="Ex. : Produit en croix pas à pas">${esc(b.note)}</textarea></label>`;
      if (b.classIds.length) h += `<label class="field">Travail donné aux élèves <textarea rows="2" data-c="homework" data-id="${b.id}" placeholder="Ex. : finir l'exercice 3">${esc(S.homework[b.id] || '')}</textarea></label>
        <div class="row"><button class="ghost" data-a="copyCahier" data-id="${b.id}">Copier pour le cahier de textes (Pronote)</button></div>`;
      if (b.extra) h += `<p><button class="danger" data-a="delExtra" data-id="${b.srcId}">Supprimer ce cours ponctuel</button></p>`;
      else h += `<p class="small muted">Créneau récurrent de l'emploi du temps — modifiable dans Réglages.</p>`;
      return h;
    };
  }
  function unvalidatedModal() {
    const ids = E.unvalidatedList();
    if (!ids.length) return `<h2>Tout est validé</h2><p>Aucun cours passé en attente.</p>`;
    const allBtn = `<div class="row"><button data-a="validateAll">✓ Tout marquer « réalisé » (${ids.length})</button></div>
      <p class="small muted">Puis corrigez seulement les exceptions. Pour ne plus avoir à valider : Réglages → Démarrage → « Réalisé par défaut ».</p>`;
    const rows = ids.map(id => ({ id, info: hourInfo(id), o: E.plan().occ[id] })).filter(r => r.info)
      .sort((a, b) => a.info.date.localeCompare(b.info.date) || toMin(a.info.hour.start) - toMin(b.info.hour.start));
    return `<h2>Cours à valider (${rows.length})</h2>` + allBtn + rows.map(r => {
      const s = seanceById(r.o.seanceId), b = r.info.block;
      return `<div class="urow" style="--cc:${blockColor(b)}"><div><b>${esc(blockNames(b))}</b>${b.group ? ' · ' + esc(b.group) : ''} · ${esc(fmt(r.info.date))} ${hm(r.info.hour.start)}<br>${seanceLabel(s, r.o.cont)}</div>${statusButtons(r.id, false)}</div>`;
    }).join('');
  }
  function forceWeekModal() {
    const m = mondayOf(UI.date), cur = E.weekType(m);
    return `<h2>Semaine du ${esc(fmt(m, { day: 'numeric', month: 'long' }))}</h2>
      <p>L'application la compte en <b>${E.weekLabel(cur)}</b>. Cette semaine est :</p>
      <div class="row"><button class="${cur === 1 ? '' : 'ghost'} big" data-a="setWeek" data-t="1">Q1</button><button class="${cur === 2 ? '' : 'ghost'} big" data-a="setWeek" data-t="2">Q2</button></div>
      <p class="small muted">L'alternance repart de cette semaine pour les suivantes. Les repères se gèrent dans Réglages → Semaines Q1 / Q2.</p>`;
  }

  /* ---------- Bibliothèque ---------- */
  function classChips(cur, action) {
    return `<div class="chips">${S.classes.map(c => `<button class="chip ${c.id === cur ? 'on' : ''}" style="--cc:${classColor(c.id)}" data-a="${action}" data-id="${c.id}">${esc(c.short)}</button>`).join('')}</div>`;
  }
  function seanceDateText(s) {
    if (s.skipped) return 'retirée';
    const info = E.plan().seance[s.id];
    if (!info || info.unplaced || !info.date) return 'pas de créneau';
    return info.firstDate && info.firstDate !== info.date ? `${fmt(info.firstDate)} → ${fmt(info.date)}` : fmt(info.date);
  }
  function chip(status) { return `<span class="schip s-${status}">${SEANCE_STATUS[status]}</span>`; }
  function doneButton(s) {
    const st = E.seanceStatus(s);
    if (st === 'retiree') return '';
    const on = st === 'realisee';
    return `<button class="qdone ${on ? 'on' : ''}" data-a="doneSeance" data-id="${s.id}" aria-pressed="${on}" title="${on ? 'Annuler « réalisée »' : 'Marquer cette séance comme réalisée'}">${on ? '☑' : '☐'} Faite</button>`;
  }
  const seanceItem = s => `<li><a href="#" data-a="openSeance" data-id="${s.id}"><span class="n">${unnumbered(s) ? '' : seanceNum(s) + '.'}</span><span class="t">${seanceTitle(s)}</span><span class="d">${esc(seanceDateText(s))}</span>${chip(E.seanceStatus(s))}</a>${doneButton(s)}</li>`;
  // Marque (ou démarque) une séance comme réalisée : toutes ses heures de cours (tous les groupes)
  function toggleDone(id) {
    const s = seanceById(id), info = E.plan().seance[id];
    if (!s) return;
    if (!info || !info.occ || !info.occ.length) { toast('Cette séance n\'a pas de créneau dans l\'agenda.'); return; }
    const hids = [...new Set(info.occ)];
    const prev = Object.fromEntries(hids.map(h => [h, S.occ[h] ? { ...S.occ[h] } : null]));
    if (E.seanceStatus(s) === 'realisee') {
      for (const h of hids) if (S.occ[h] && S.occ[h].status === 'realisee') setOcc(h, r => { delete r.status; });
    } else {
      const free = hids.filter(h => !(S.occ[h] && S.occ[h].status));
      for (const h of (free.length ? free : [hids[hids.length - 1]])) setOcc(h, r => { r.status = 'realisee'; });
    }
    save();
    toast(E.seanceStatus(s) === 'realisee' ? `« ${s.title} » : réalisée` : `« ${s.title} » : plus marquée réalisée`, () => {
      for (const [h, r] of Object.entries(prev)) { if (r) S.occ[h] = r; else delete S.occ[h]; }
      save();
    });
  }

  function renderLibrary() {
    if (!classById(UI.libClass)) UI.libClass = S.classes[0] && S.classes[0].id;
    const c = classById(UI.libClass);
    if (!c) return `<div class="card notice">Aucune classe. <button data-a="goto" data-tab="reglages" data-sec="sec-classes">Ajouter une classe</button></div>`;
    const seqs = E.orderedSequences(c.id);
    let h = `<form class="row search" data-form="libSearch"><input type="search" id="libSearch" value="${esc(UI.libQuery || '')}" placeholder="Chercher une séance (Thalès, quartiles…)" aria-label="Chercher une séance">
      <button type="submit" class="ghost">Chercher</button>${UI.libQuery ? '<button type="button" class="ghost" data-a="libSearchClear">Effacer</button>' : ''}</form>`;
    if (UI.libQuery) {
      const qn = norm(UI.libQuery), hits = [];
      for (const cl of S.classes) for (const sq of E.orderedSequences(cl.id)) for (const s of E.orderedSeancesOf(sq.id))
        if (norm(s.title).includes(qn) || norm(sq.title).includes(qn) || norm(s.remark || '').includes(qn)) hits.push({ cl, sq, s });
      return h + `<section class="card"><h2>${hits.length} résultat${hits.length > 1 ? 's' : ''} pour « ${esc(UI.libQuery)} »</h2>
        ${hits.length ? `<ul class="plain">${hits.slice(0, 80).map(x => `<li><b>${esc(x.cl.short)}</b> · <span class="muted">Séq. ${seqNum(x.sq)} – ${esc(x.sq.title)}</span><br><a href="#" data-a="openSeance" data-id="${x.s.id}">${seanceLabel(x.s, false)}</a> <span class="muted small">${esc(seanceDateText(x.s))}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune séance trouvée.</p>'}</section>`;
    }
    h += classChips(c.id, 'libClass');
    h += `<div class="libhead"><div><h1>${esc(c.short)}</h1><div class="muted">${esc(c.classe)} · ${esc(c.matiere)}</div></div>
      <div class="row">${c.projectUrl ? `<a class="btn ghost" href="${esc(c.projectUrl)}" target="_blank" rel="noopener">Projet Claude ↗</a>` : ''}
      <button data-a="addSeq">＋ Séquence</button><button class="ghost" data-a="bulk">Coller une liste de séances</button></div></div>`;
    if (!seqs.length) h += `<div class="empty">Aucune séquence. Ajoutez-en une, collez la liste rendue par Claude, ou importez une progression (onglet Progression).</div>`;
    seqs.forEach((q, i) => {
      const ss = E.orderedSeancesOf(q.id);
      const evals = S.evaluations.filter(x => x.sequenceId === q.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const exos = S.exercises.filter(x => x.sequenceId === q.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const quizzes = S.quizzes.filter(x => x.sequenceId === q.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      h += `<section class="card seq" style="--cc:${classColor(c.id)}">
        <div class="seqh"><h2>Séquence ${i + 1} – ${esc(q.title)}</h2>
          <div class="tools"><button class="icon" data-a="renSeq" data-id="${q.id}" title="Renommer" aria-label="Renommer">✎</button>
          <button class="icon" data-a="moveSeq" data-id="${q.id}" data-d="-1" title="Monter" aria-label="Monter">↑</button>
          <button class="icon" data-a="moveSeq" data-id="${q.id}" data-d="1" title="Descendre" aria-label="Descendre">↓</button>
          <button class="icon" data-a="delSeq" data-id="${q.id}" title="Supprimer" aria-label="Supprimer">🗑</button></div></div>
        <div class="row conv">
          ${q.convUrl ? `<a class="btn" href="${esc(q.convUrl)}" target="_blank" rel="noopener">Ouvrir la conversation de la séquence ↗</a>` : ''}
          <button class="${q.convUrl ? 'ghost' : ''}" data-a="copyStart" data-id="${q.id}">Copier le prompt de démarrage</button>
          <button class="ghost" data-a="editConv" data-id="${q.id}">${q.convUrl ? 'Modifier le lien' : 'Coller le lien de la conversation'}</button>
        </div>
        <div class="row"><button class="ghost small" data-a="copyNotions" data-id="${q.id}">Copier le prompt : notions de la séquence</button>
          <button class="ghost small" data-a="copyComp" data-id="${q.id}">Copier le prompt : compétences de la séquence</button></div>
        <ol class="slist">${ss.map(seanceItem).join('')}</ol>
        <div class="row"><button class="ghost small" data-a="addSeance" data-id="${q.id}">＋ Séance</button></div>
        <div class="extras2">
          <div><h3>Évaluations <button class="icon plus" data-a="evalForm" data-seq="${q.id}" title="Ajouter une évaluation" aria-label="Ajouter une évaluation">＋</button></h3>
            ${evals.length ? `<ul class="plain">${evals.map(ev => `<li><a href="#" data-a="evalForm" data-id="${ev.id}">${ev.type === 'fin' ? 'Fin de séquence' : 'Partielle'} · ${esc(ev.duration)}${ev.date ? ' · ' + esc(fmt(ev.date)) : ''}</a> <span class="muted small">séances ${ev.seanceIds.map(id => seanceById(id)).filter(Boolean).map(seanceNum).join(', ') || '—'}</span></li>`).join('')}</ul>` : '<p class="muted small">Aucune.</p>'}</div>
          <div><h3>Exercices en plus <button class="icon plus" data-a="exoForm" data-seq="${q.id}" title="Nouvelle série" aria-label="Nouvelle série d'exercices">＋</button></h3>
            ${exos.length ? `<ul class="plain">${exos.map((x, k) => `<li>Série ${k + 1}${x.level === 'expert' ? ' <b>expert</b>' : ''} · ${esc(fmt(x.createdAt))} <span class="muted small">séances ${x.seanceIds.map(id => seanceById(id)).filter(Boolean).map(seanceNum).join(', ') || 'toutes'}</span> <button class="icon" data-a="delExo" data-id="${x.id}" aria-label="Supprimer">🗑</button></li>`).join('')}</ul>` : '<p class="muted small">Aucune série demandée.</p>'}</div>
          <div><h3>Quiz <button class="icon plus" data-a="quizForm" data-seq="${q.id}" title="Nouveau quiz" aria-label="Nouveau quiz">＋</button></h3>
            ${quizzes.length ? `<ul class="plain">${quizzes.map((x, k) => `<li>Quiz ${k + 1} · ${esc(x.duration)} · ${esc(fmt(x.createdAt))} <span class="muted small">séances ${x.seanceIds.map(id => seanceById(id)).filter(Boolean).map(seanceNum).join(', ') || 'toutes'}</span> <button class="icon" data-a="delQuiz" data-id="${x.id}" aria-label="Supprimer">🗑</button></li>`).join('')}</ul>` : '<p class="muted small">Aucun quiz demandé.</p>'}</div>
        </div>
      </section>`;
    });
    return h;
  }

  function seanceModal(id) {
    return () => {
      const s = seanceById(id); if (!s) return null;
      const q = seqById(s.sequenceId), c = classById(q.classId);
      const info = E.plan().seance[s.id] || {};
      const status = E.seanceStatus(s);
      const lastOcc = info.occ && info.occ[info.occ.length - 1];
      const o = lastOcc ? E.plan().occ[lastOcc] : null;
      let when = s.skipped ? 'Retirée de la progression effective' : 'Pas de créneau disponible avant la fin de l\'année';
      if (!s.skipped && info.date) when = info.firstDate && info.firstDate !== info.date ? `du ${fmtLong(info.firstDate)} au ${fmtLong(info.date)}` : `${fmtLong(info.date)} à ${hm(info.start)}`;
      let h = `<div class="muted small">${esc(c.short)} · Séquence ${seqNum(q)} – ${esc(q.title)}</div>
        <h2>${seanceLabel(s, false)}</h2>
        <p>${esc(when)} · ${chip(status)} ${doneButton(s)}</p>`;
      if (o && o.past && !o.status) h += `<p class="small muted">Valider le cours :</p>${statusButtons(lastOcc, false)}`;
      else if (lastOcc) h += `<p><button class="ghost small" data-a="hourMenu" data-h="${lastOcc}">Statut du cours…</button></p>`;
      if (!['realisee', 'non_realisee', 'retiree'].includes(status))
        h += `<label class="check"><input type="checkbox" data-c="prepared" data-id="${s.id}" ${s.prepared ? 'checked' : ''}> Séance préparée</label>`;
      h += `<div class="stack">
        ${q.convUrl ? `<a class="btn" href="${esc(q.convUrl)}" target="_blank" rel="noopener">Ouvrir la conversation de la séquence ↗</a>`
          : `<div class="notice small">Pas encore de conversation pour cette séquence. <button class="ghost small" data-a="copyStart" data-id="${q.id}">Copier le prompt de démarrage</button> <button class="ghost small" data-a="editConv" data-id="${q.id}">Coller le lien</button></div>`}
        <button data-a="copySeance" data-id="${s.id}">Copier le prompt de la séance</button>
        <button class="ghost" data-a="copyCorrige" data-id="${s.id}">Copier le prompt du corrigé</button>
        ${s.docUrl ? `<a class="btn ghost" href="${esc(s.docUrl)}" target="_blank" rel="noopener">📎 Ouvrir la fiche ↗</a>` : ''}
      </div>
      <label class="field">Lien vers la fiche (Drive, ENT…) <input type="url" value="${esc(s.docUrl || '')}" data-c="seanceField" data-f="docUrl" data-id="${s.id}" placeholder="https://…"></label>
      <label class="field">Remarques pour la prochaine fois <textarea rows="2" data-c="seanceField" data-f="remark" data-id="${s.id}" placeholder="Ex. : trop long, prévoir les calculatrices…">${esc(s.remark || '')}</textarea></label>
      <details class="edit"><summary>Modifier</summary>
        <label>Titre <input type="text" value="${esc(s.title)}" data-c="seanceTitle" data-id="${s.id}"></label>
        <label>Nature <select data-c="seanceKind" data-id="${s.id}">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${(s.kind || 'cours') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="row"><button class="ghost" data-a="moveSeance" data-id="${s.id}" data-d="-1">↑ Monter</button>
        <button class="ghost" data-a="moveSeance" data-id="${s.id}" data-d="1">↓ Descendre</button>
        <button class="ghost" data-a="skipSeance" data-id="${s.id}">${s.skipped ? 'Remettre dans la progression' : 'Retirer de la progression (garder le titre)'}</button>
        <button class="danger" data-a="delSeance" data-id="${s.id}">Supprimer</button></div>
      </details>`;
      return h;
    };
  }

  function prevSeances(s) {
    return E.orderedSeancesOf(s.sequenceId).filter(x => x.order < s.order).map(x => ({ num: seanceNum(x), title: x.title, done: E.seanceStatus(x) === 'realisee' }));
  }
  function seqVars(q) {
    const c = classById(q.classId);
    const ss = E.orderedSeancesOf(q.id).filter(s => !s.skipped);
    return { entete: head(c), sequence_num: seqNum(q), sequence: q.title, seances: ss.length ? ss.map(numTxt).join('\n') : "(aucune séance saisie pour l'instant)" };
  }
  const seanceListText = ids => ids.map(id => seanceById(id)).filter(Boolean).map(numTxt).join('\n');

  function evalDefaultDate(seq, ids) {
    // le cours qui suit la dernière séance concernée
    const list = E.orderedSeances(seq.classId).filter(s => !s.skipped);
    const lastIdx = Math.max(...ids.map(id => list.findIndex(s => s.id === id)));
    const next = list[lastIdx + 1];
    const info = next && E.plan().seance[next.id];
    return (info && info.firstDate) || '';
  }
  function evalForm(id, seqId) {
    return () => {
      const ev = id ? S.evaluations.find(x => x.id === id) : null;
      const q = seqById(ev ? ev.sequenceId : seqId); if (!q) return null;
      const ss = E.orderedSeancesOf(q.id);
      const v = ev || { type: 'fin', duration: '1 h', seanceIds: ss.filter(s => s.kind !== 'evaluation').map(s => s.id), date: '' };
      const auto = ev ? '' : evalDefaultDate(q, v.seanceIds);
      return `<div class="muted small">${esc(classById(q.classId).short)} · Séquence ${seqNum(q)} – ${esc(q.title)}</div>
        <h2>${ev ? 'Évaluation' : 'Nouvelle évaluation'}</h2>
        <form class="form" data-form="eval" data-id="${id || ''}" data-seq="${q.id}">
          <fieldset><legend>Type</legend>
            <label class="check"><input type="radio" name="type" value="partielle" ${v.type === 'partielle' ? 'checked' : ''}> Évaluation partielle</label>
            <label class="check"><input type="radio" name="type" value="fin" ${v.type === 'fin' ? 'checked' : ''}> Fin de séquence</label></fieldset>
          <label>Durée <input name="duration" value="${esc(v.duration)}" list="durees" required></label>
          <datalist id="durees"><option>30 min</option><option>45 min</option><option>1 h</option><option>2 h</option></datalist>
          <label>Date (agenda) <input type="date" name="date" value="${esc(v.date || auto)}"></label>
          <fieldset><legend>Séances concernées</legend>
            ${ss.map((s, j) => `<label class="check"><input type="checkbox" name="sea" value="${s.id}" ${v.seanceIds.includes(s.id) ? 'checked' : ''}> ${esc(numTxt(s))}</label>`).join('')}</fieldset>
          <div class="row"><button type="submit" value="copy">Enregistrer et copier le prompt de l'évaluation</button><button type="submit" class="ghost" value="save">Enregistrer</button>
          ${ev ? `<button type="button" class="danger" data-a="delEval" data-id="${ev.id}">Supprimer</button>` : ''}</div>
        </form>`;
    };
  }
  // Exercices en plus (normal ou expert) et quiz : on choisit les séances concernées, puis on copie le prompt
  function exoForm(seqId, quiz) {
    return () => {
      const q = seqById(seqId); if (!q) return null;
      const ss = E.orderedSeancesOf(q.id).filter(s => s.kind !== 'evaluation' && !isRevision(s) && !s.skipped);
      const n = (quiz ? S.quizzes : S.exercises).filter(x => x.sequenceId === q.id).length + 1;
      return `<div class="muted small">${esc(classById(q.classId).short)} · Séquence ${seqNum(q)} – ${esc(q.title)}</div>
        <h2>${quiz ? `Quiz n° ${n}` : `Exercices en plus — série ${n}`}</h2>
        <form class="form" data-form="${quiz ? 'quiz' : 'exo'}" data-seq="${q.id}">
          <fieldset><legend>Séances concernées (aucune cochée = toute la séquence)</legend>
            ${ss.map(s => `<label class="check"><input type="checkbox" name="sea" value="${s.id}" ${['realisee', 'non_terminee'].includes(E.seanceStatus(s)) ? 'checked' : ''}> ${esc(numTxt(s))}</label>`).join('')}</fieldset>
          ${quiz ? `<label>Durée pour les élèves <input name="duration" value="1 h" list="durees2"></label><datalist id="durees2"><option>30 min</option><option>45 min</option><option>1 h</option></datalist>
            <div class="row"><button type="submit" value="quiz">Copier le prompt du quiz</button></div>`
          : `<div class="row"><button type="submit" value="normal">Copier le prompt (série ${n})</button><button type="submit" class="expert" value="expert">Copier le prompt niveau expert</button></div>`}
        </form>
        <p class="small muted">${quiz ? 'Questions variées, du plus facile au plus difficile, avec le barème et le corrigé en fin de document.' : 'Niveau expert : problèmes en plusieurs étapes, peu guidés, situations professionnelles, notions mélangées. Le prompt rappelle à Claude de ne pas reprendre les exercices déjà faits.'}</p>`;
    };
  }

  function bulkModal() {
    return `<h2>Coller une liste de séances</h2>
      <p class="small muted">Une ligne par séquence ou séance. Exemple :</p>
      <pre class="ex">Séquence 1 – Proportionnalité
1. Découverte de la proportionnalité
2. Tableau de proportionnalité
Séquence 2 – Statistiques
1. Lire un tableau d'effectifs</pre>
      <textarea id="bulkText" rows="10" placeholder="Collez ici…"></textarea>
      <div class="row"><button data-a="bulkGo">Ajouter à ${esc(classById(UI.libClass).short)}</button></div>`;
  }
  function parseBulk(text) {
    const out = []; let cur = null;
    for (let raw of text.split(/\r?\n/)) {
      let line = raw.trim().replace(/^[-*•]\s*/, '').replace(/\*\*/g, '');
      if (!line || /^```/.test(line)) continue;
      const m = line.match(/^(s[ée]quence|seq\.?|s)\s*\d+\s*[:.\-–—)]?\s*(.*)$/i);
      if (m && (m[1].length > 1 || /^s\d/i.test(line))) {
        const hmm = m[2].match(/\(\s*(\d+)\s*h\s*\)\s*$/i);
        cur = { title: m[2].replace(/\(\s*\d+\s*h\s*\)\s*$/i, '').trim() || line, hours: hmm ? Number(hmm[1]) : null, seances: [] };
        out.push(cur); continue;
      }
      const t = line.replace(/^(s[ée]ance\s*)?\d+\s*[.)\-–—:]?\s*/i, '').replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '').trim();
      if (!t) continue;
      if (!cur) { cur = { title: 'Séquence', seances: [] }; out.push(cur); }
      cur.seances.push(t);
    }
    return out;
  }

  function normalizeOrder(list) { list.sort((a, b) => a.order - b.order).forEach((x, i) => { x.order = i; }); }
  function move(list, id, d) {
    normalizeOrder(list);
    const i = list.findIndex(x => x.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return false;
    [list[i].order, list[j].order] = [list[j].order, list[i].order];
    return true;
  }

  /* ---------- Progression ---------- */
  function renderProgression() {
    let h = `<div class="seg sub" role="group" aria-label="Progression">
      <button data-a="progSub" data-v="initiale" class="${UI.progSub === 'initiale' ? 'on' : ''}">Progression initiale</button>
      <button data-a="progSub" data-v="effective" class="${UI.progSub === 'effective' ? 'on' : ''}">Progression effective</button>
      <button data-a="progSub" data-v="heures" class="${UI.progSub === 'heures' ? 'on' : ''}">Heures de l'année</button></div>`;
    if (UI.progSub === 'heures') return h + renderHours();
    if (!classById(UI.progClass)) UI.progClass = S.classes[0] && S.classes[0].id;
    const c = classById(UI.progClass); if (!c) return h;
    h += classChips(c.id, 'progClass');
    return h + (UI.progSub === 'initiale' ? renderInitial(c) : renderEffective(c));
  }

  /* Heures de l'année par classe (et par groupe) : cours de maths, AP, co-intervention.
     Calcul sur l'emploi du temps réel : Q1/Q2, semestres, vacances, fériés, PFMP, absences, cours annulés. */
  function hoursBreakdown(cid) {
    const tracks = E.tracksOf(cid), t = today(), nm = PE.nowMin();
    // Par type de créneau ; « …Prog » = heures d'AP / de co-intervention où une séance du programme est placée
    const res = tracks.map(g => ({ group: g, cours: [0, 0], ap: [0, 0], apProg: [0, 0], coint: [0, 0], cointProg: [0, 0] }));
    for (let d = S.settings.rentree; d <= S.settings.finAnnee; d = addDays(d, 1)) {
      for (const b of E.blocksOn(d)) {
        if (!b.classIds.includes(cid) || b.partialBlocked || E.classBlocked(d, cid)) continue;
        const cat = b.type === 'cours' ? 'cours' : b.type === 'ap' ? 'ap' : b.type === 'coint' ? 'coint' : null;
        if (!cat) continue;
        for (const x of b.hours) {
          if (S.occ[x.id] && S.occ[x.id].cancelled) continue;
          const past = d < t || (d === t && toMin(x.end) <= nm) ? 0 : 1;
          for (const r of res) if (tracks.length === 1 || !b.group || b.group === r.group) {
            r[cat][past]++;
            if (cat !== 'cours' && x.counts) r[cat + 'Prog'][past]++;
          }
        }
      }
    }
    return res;
  }
  const sum = a => a[0] + a[1];
  // Bilan de l'année d'une classe (groupe le moins avancé) : heures par type et programme
  function yearSummary(cid) {
    const k = E.compare(cid) || {};
    const rows = hoursOf(cid);
    const r = rows.find(x => x.group === k.worstGroup) || rows[0];
    const p = E.plan();
    const dates = E.orderedSeances(cid).map(s => (p.seance[s.id] || {}).date).filter(Boolean).sort();
    return {
      k, r, group: k.tracks ? k.worstGroup : '',
      total: [r.cours[0] + r.ap[0] + r.coint[0], r.cours[1] + r.ap[1] + r.coint[1]],
      apFree: r.ap[1] - r.apProg[1], cointFree: r.coint[1] - r.cointProg[1],
      lastDate: dates[dates.length - 1] || null,
    };
  }
  function yearCard(c) {
    const y = yearSummary(c.id), { k, r } = y;
    const row = (label, a, extra) => `<tr><td>${label}${extra ? `<div class="small muted">${extra}</div>` : ''}</td><td><b>${sum(a)}</b></td><td>${a[0]}</td><td>${a[1]}</td></tr>`;
    const used = (a, what) => sum(a) ? `dont ${sum(a)} h avec une séance du programme (${what})` : '';
    const m = k.margin || 0;
    return `<section class="card"><h2>L'année en heures — ${esc(c.short)}${y.group ? ` <span class="muted small">(groupe ${esc(y.group)}, le moins avancé)</span>` : ''}</h2>
      <div class="tablewrap"><table class="tbl htbl"><thead><tr><th></th><th>Année</th><th>Passées</th><th>À venir</th></tr></thead><tbody>
        ${row('<b>Cours de maths</b>', r.cours)}
        ${row('Accompagnement (AP)', r.ap, used(r.apProg, 'AP transformées en maths'))}
        ${row('Co-intervention', r.coint, used(r.cointProg, 'comptées pour le programme'))}
        <tr class="tot"><td><b>Total</b></td><td><b>${sum(y.total)}</b></td><td>${y.total[0]}</td><td>${y.total[1]}</td></tr>
      </tbody></table></div>
      <div class="tiles">
        ${tile((k.seances || 0) + ' h', 'le programme (une séance = 1 h)')}
        ${tile((k.done || 0) + ' h', 'faites')}
        ${tile((k.remainingSeances || 0) + ' h', 'reste à faire')}
        ${tile((k.availableHours || 0) + ' h', `pour le finir : ${progHours(c.id, k).text}`)}
        ${tile((m > 0 ? '+' : '') + m + ' h', m >= 0 ? 'de marge : heures libres en fin d\'année' : 'qui manquent pour finir', m < 0 ? 'bad' : '')}
      </div>
      <p class="small muted">${y.lastDate ? `Dernière séance prévue : ${esc(fmt(y.lastDate, { weekday: 'long', day: 'numeric', month: 'long' }))}. ` : ''}AP et co-intervention ne font avancer le programme que si vous y placez une séance (dans l'agenda, bouton « → Faire des maths »). Il vous reste ${y.apFree} h d'AP et ${y.cointFree} h de co-intervention sans séance prévue.</p></section>`;
  }
  const hbCache = { rev: -1, s: null, map: {} };
  function hoursOf(cid) {
    if (hbCache.rev !== S._rev || hbCache.s !== S) { hbCache.rev = S._rev; hbCache.s = S; hbCache.map = {}; }
    return hbCache.map[cid] ||= hoursBreakdown(cid);
  }
  /* D'où viennent les heures qui servent au programme : cours de maths, plus les AP et co-interventions
     où une séance est placée. Les autres AP / co-interventions sont en réserve (elles ne comptent pas). */
  function progHours(cid, k) {
    const y = yearSummary(cid), r = y.r;
    const parts = [`${r.cours[1]} de cours`];
    if (r.apProg[1]) parts.push(`${r.apProg[1]} AP`);
    if (r.cointProg[1]) parts.push(`${r.cointProg[1]} co-int.`);
    if (k.unvalidated) parts.push(`${k.unvalidated} passées à valider`);
    return { y, text: parts.join(' + ') };
  }
  function futureSplit(cid, k) {
    const { y, text } = progHours(cid, k), m = k.margin || 0;
    return `<div class="dcn">Heures pour le finir : <b>${k.availableHours} h</b> <span class="muted">(${text})</span></div>
      <div class="dcn ${m < 0 ? 'bad' : ''}" title="Heures pour finir − heures de programme restantes"><b>Marge en fin d'année : ${m > 0 ? '+' : ''}${m} h</b></div>
      <div class="dcn muted">En réserve, sans séance : ${y.apFree} h AP · ${y.cointFree} h co-int.</div>`;
  }
  // Cours de maths perdus (annulés, déplacés, absences) — pour comprendre un retard
  function lostHours(cid) {
    const c = classById(cid), out = [];
    for (let d = c.startDate || S.settings.rentree; d <= S.settings.finAnnee; d = addDays(d, 1)) {
      for (const b of E.blocksOn(d)) {
        if (!b.classIds.includes(cid)) continue;
        for (const x of b.hours) {
          if (!x.counts && !(b.partialBlocked && x.defaultCounts)) continue;
          const rec = S.occ[x.id] || {};
          const why = rec.cancelled ? (rec.moved ? `déplacé au ${fmt(rec.moved)}` : 'cours annulé') : b.partialBlocked ? b.blocked : null;
          if (why) out.push({ date: d, start: x.start, end: x.end, why, hid: x.id, block: b, makeUp: !!(b.blockedBy && b.blockedBy.makeUp) });
        }
      }
    }
    return out;
  }
  function threatModal(cid) {
    return () => {
      const c = classById(cid), k = E.compare(cid); if (!c || !k) return null;
      const p = E.plan(), t = today();
      const unplaced = E.orderedSeances(cid).filter(s => !s.skipped && (p.seance[s.id] || {}).unplaced);
      const hrs = p.classHours[cid] || [];
      const last = hrs[hrs.length - 1];
      const lastOcc = last && p.occ[last.id];
      const lastS = lastOcc && lastOcc.seanceId && seanceById(lastOcc.seanceId);
      const lost = lostHours(cid);
      const y = yearSummary(cid);
      const link = (d, txt) => `<a href="#" data-a="gotoDay" data-d="${d}">${txt || esc(fmt(d))}</a>`;
      return `<h2>${esc(c.short)} — programme menacé</h2>
        ${unplaced.length ? `<p>Ces séances n'ont plus de créneau avant la fin de l'année${k.tracks ? ` (groupe ${esc(k.worstGroup)})` : ''} :</p>
          <ul class="plain">${unplaced.map(s => `<li><a href="#" data-a="openSeance" data-id="${s.id}">Séq. ${seqNum(seqById(s.sequenceId))} · ${esc(numTxt(s))}</a></li>`).join('')}</ul>`
          : `<p>Il manque ${-k.margin} h pour faire les séances restantes.</p>`}
        ${last ? `<p>Dernière heure de maths de l'année : ${link(last.date, `${esc(fmt(last.date))} ${hm(last.start)}`)}${lastS ? ` — ${esc(numTxt(lastS))}` : ''}.</p>` : ''}
        <h3>Cours de maths perdus</h3>
        ${lost.length ? `<ul class="plain">${lost.map(x => `<li>${link(x.date)} ${hm(x.start)} — ${esc(x.why)}</li>`).join('')}</ul>` : '<p class="small muted">Aucun.</p>'}
        <h3>Pour rattraper</h3>
        <ul class="plain">
          ${y.apFree ? `<li>${y.apFree} h d'AP à venir : dans l'agenda, bouton « → Faire des maths » sur une AP.</li>` : ''}
          ${y.cointFree ? `<li>${y.cointFree} h de co-intervention à venir : même bouton, si la séance s'y prête.</li>` : ''}
        </ul>
        <div class="row"><button data-a="reorgFor" data-id="${cid}">Proposer une réorganisation</button></div>`;
    };
  }
  function renderHours() {
    const rows = [];
    for (const c of S.classes) {
      if (!S.slots.some(s => s.classIds.includes(c.id))) continue;
      const y = yearSummary(c.id), { k, r } = y, m = k.margin || 0;
      const used = sum(r.apProg) + sum(r.cointProg);
      rows.push(`<tr><td><a href="#" data-a="progClassEff" data-id="${c.id}"><b>${esc(c.short)}</b></a>${y.group ? `<div class="small muted">${esc(y.group)}</div>` : ''}</td>
        <td class="grpcol"><b>${sum(r.cours)}</b></td><td>${sum(r.ap)}</td><td>${sum(r.coint)}</td><td>${sum(y.total)}</td>
        <td class="grpcol">${k.seances ? `<b>${k.seances}</b>` : '—'}${used ? `<div class="small muted">dont ${used} en AP / co-int.</div>` : ''}</td><td>${k.seances ? k.done : '—'}</td><td>${k.seances ? k.remainingSeances : '—'}</td>
        <td class="${m < 0 ? 'bad' : ''}">${k.seances ? (m > 0 ? '+' : '') + m : '—'}</td></tr>`);
    }
    return `<section class="card"><h2>Heures de l'année ${esc(S.settings.rentree.slice(0, 4))}-${esc(S.settings.finAnnee.slice(0, 4))}</h2>
      <p class="small muted">Du ${esc(fmt(S.settings.rentree, { day: 'numeric', month: 'long' }))} au ${esc(fmt(S.settings.finAnnee, { day: 'numeric', month: 'long' }))}, d'après l'emploi du temps (Q1 / Q2, semestres), les vacances, les fériés, les stages, les examens et les absences. Classe en demi-groupes : heures vues par un élève du groupe le moins avancé.</p>
      <div class="tablewrap"><table class="tbl htbl"><thead>
        <tr><th></th><th colspan="4" class="grpcol">Heures de l'année</th><th colspan="4" class="grpcol">Programme (en heures)</th></tr>
        <tr><th>Classe</th><th class="grpcol">Maths</th><th>AP</th><th>Co-int.</th><th>Total</th><th class="grpcol">Prévu</th><th>Fait</th><th>Reste</th><th>Marge</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>
      <p class="small muted">« Prévu » : nombre de séances de la progression (une séance = 1 h). Elles se font sur les heures de maths, et sur des AP ou co-interventions seulement si vous y placez une séance. « Marge » : heures de cours qui resteront libres en fin d'année (négatif = il en manque). Le détail par classe est dans « Progression effective ».</p></section>`;
  }

  const tile = (v, l, cls) => `<div class="tile ${cls || ''}"><b>${v}</b><span>${l}</span></div>`;
  const span = (s, e) => s ? `${fmt(s)} → ${fmt(e)}` : '—';

  /* Progression initiale : prompt, collage ou fichier daté, aperçu, copie figée */
  function progressionVars(c) {
    const st = E.plan().perClass[c.id] || {};
    const f = d => fmt(d, { day: 'numeric', month: 'long', year: 'numeric' });
    const r = (s, e) => s === e ? f(s) : `du ${f(s)} au ${f(e)}`;
    const groups = st.tracks ? ` Par groupe : ${st.tracks.map(t => `${t.group} ${t.capacity} h`).join(', ')}.` : '';
    const evs = S.events.filter(ev => !ev.classIds.length || ev.classIds.includes(c.id))
      .map(ev => `- ${EVENT_TYPES[ev.type]}${ev.label && ev.label !== EVENT_TYPES[ev.type] ? ' – ' + ev.label : ''}${ev.noClass ? '' : ' (cours maintenus)'} : ${r(ev.start, ev.end)}`);
    return {
      entete: head(c),
      annee: `Année scolaire : du ${f(S.settings.rentree)} au ${f(S.settings.finAnnee)}${c.startDate ? ` (séances à partir du ${f(c.startDate)})` : ''}.`,
      heures: `Heures de cours réellement disponibles, calculées d'après l'emploi du temps (semaines Q1 et Q2, semestres, vacances, jours fériés, PFMP et périodes sans cours déjà retirés ; AP et co-intervention non comptées) : ${st.capacity || 0} h sur l'année, dont ${st.capacityFromToday || 0} h à partir d'aujourd'hui (${f(today())}).${groups}`,
      vacances: S.holidays.map(v => `- ${v.label} : ${r(v.start, v.end)}`).join('\n') || '- (aucune)',
      periodes: evs.join('\n') || '- (aucune)',
    };
  }
  function parseProgression(text) {
    if (!text.includes('|')) return parseBulk(text);
    const out = []; let cur = null;
    for (let line of text.split(/\r?\n/)) {
      line = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      if (!line || /^```/.test(line) || /^[-|:\s]+$/.test(line)) continue;
      const f = line.split('|').map(s => s.trim().replace(/\*\*/g, ''));
      const k = norm(f[0]);
      if (k.startsWith('sequence') || k === 's' || k === 'seq') {
        cur = { title: f[2] || f[1] || 'Séquence', hours: parseInt(f[3], 10) || null, seances: [] }; out.push(cur);
      } else if (/^\d+$/.test(f[0]) && f[1]) {
        if (!cur) { cur = { title: 'Séquence', hours: null, seances: [] }; out.push(cur); }
        cur.seances.push(f[1]);
      }
    }
    return out;
  }
  function datePreview(c, seqs) {
    const total = seqs.reduce((n, q) => n + q.seances.length, 0);
    const dates = E.projectDates(c.id, total);
    let i = 0;
    return seqs.map(q => {
      const seances = q.seances.map(t => ({ title: t, date: dates[i++] || null }));
      const ds = seances.map(s => s.date).filter(Boolean);
      return { title: q.title, hours: q.hours || seances.length, declared: q.hours, seances, start: ds[0] || null, end: ds[ds.length - 1] || null, missing: seances.some(s => !s.date) };
    });
  }
  function initialTable(seqs, capacity) {
    const hours = seqs.reduce((n, q) => n + q.seances.length, 0);
    const margin = capacity - hours;
    return `<div class="tiles">${tile(capacity + ' h', 'heures disponibles')}${tile(hours + ' h', 'heures des séquences')}${tile((margin > 0 ? '+' : '') + margin + ' h', 'marge sur l\'année', margin < 0 ? 'bad' : '')}${tile(seqs.length, 'séquences')}</div>
      ${margin < 0 ? `<div class="banner bad">La progression dépasse les heures disponibles de ${-margin} h : les dernières séances ne tiennent pas dans l'année.</div>` : ''}
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Séq.</th><th>Titre</th><th>Heures</th><th>Début prévu</th><th>Fin prévue</th></tr></thead><tbody>
      ${seqs.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.title)}${q.declared && q.declared !== q.seances.length ? `<div class="small bad">${q.declared} h annoncées pour ${q.seances.length} séances</div>` : ''}</td>
        <td>${q.seances.length}</td><td>${q.start ? esc(fmt(q.start)) : '—'}</td><td>${q.end ? esc(fmt(q.end)) : '—'}${q.missing ? ' <span class="bad small">hors année</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  function renderInitial(c) {
    const ini = S.initial[c.id];
    const st = E.plan().perClass[c.id] || {};
    const pv = UI.iniPreview;
    if (pv && pv.kind === 'agenda') return agendaPreviewHtml(pv);
    const promptRow = `<div class="row"><button data-a="copyProg">Copier le prompt de progression</button>
      ${c.projectUrl ? `<a class="btn ghost" href="${esc(c.projectUrl)}" target="_blank" rel="noopener">Projet Claude ${esc(c.short)} ↗</a>` : ''}</div>`;
    const fileRow = `<div class="row"><button class="ghost" data-a="agendaFile">Importer un tableau daté (CSV, Excel)…</button>
      <span class="small muted">Colonnes Date, Classe (facultatif), Type, Séquence, N° ou Séance, Titre. Un fichier peut contenir plusieurs classes.</span></div>`;
    if (!S.slots.length) return `<div class="card notice">Importez d'abord l'emploi du temps : les heures disponibles en dépendent. <button data-a="goto" data-tab="reglages" data-sec="sec-edt">Emploi du temps</button></div>`;
    if (ini && !UI.iniReimport) {
      return `<section class="card"><h2>Progression initiale — ${esc(c.short)} <span class="tag">figée le ${esc(fmt(ini.importedAt))}</span></h2>
        <p class="small muted">Référence de l'année${ini.source ? ` (fichier ${esc(ini.source)})` : ''} : elle ne change pas quand vous validez ou déplacez des séances. Pour la modifier, travaillez dans la conversation Claude puis réimportez.</p>
        ${initialTable(ini.sequences, ini.capacity)}
        <details class="edit"><summary>Texte importé</summary><pre class="ex">${esc(ini.text)}</pre></details>
        ${promptRow}
        <div class="row"><button class="ghost" data-a="iniReimport">Réimporter une nouvelle version</button>
          <button class="ghost" data-a="refreeze">Figer la progression actuelle comme nouvelle référence</button></div></section>`;
    }
    const tp = pv && pv.kind === 'text' && pv.classId === c.id ? pv : null;
    return `<section class="card"><h2>${ini ? 'Nouvelle version de la progression' : 'Progression initiale'} — ${esc(c.short)}</h2>
      <ol class="steps">
        <li>Copiez le prompt (il contient les <b>${st.capacity || 0} h</b> disponibles, les vacances et les PFMP) et collez-le dans le Projet Claude de la classe.</li>
        <li>Travaillez la progression avec Claude, puis copiez le bloc de texte final — ou importez le tableau daté séance par séance.</li>
        <li>Vérifiez les dates prévues, puis validez : la progression est figée comme référence et les séances sont placées dans l'agenda.</li>
      </ol>
      ${promptRow}
      <textarea id="iniText" rows="8" placeholder="SÉQUENCE | 1 | Proportionnalité | 6&#10;1 | Découverte de la proportionnalité&#10;2 | …">${tp ? esc(tp.text) : ''}</textarea>
      <div class="row"><button data-a="iniParse">Analyser</button>${ini ? '<button class="ghost" data-a="iniCancel">Annuler</button>' : ''}</div>
      ${fileRow}
      ${tp ? (tp.seqs.length ? `<h3>Aperçu</h3>${initialTable(tp.seqs, st.capacity || 0)}
        <div class="row"><button data-a="iniApply">Valider et figer cette progression</button></div>` : '<p class="banner bad">Aucune séquence reconnue.</p>') : ''}
    </section>`;
  }

  /* ---------- Import d'un tableau daté (agenda des séances) ---------- */
  function matchClasses(raw) {
    const ids = [], unknown = [];
    for (const part of String(raw).split(/\s*\+\s*/).map(x => x.trim()).filter(Boolean)) {
      const p = norm(part);
      if (!p || p === 'hors') continue;
      let m = S.classes.filter(c => norm(c.short) === p);
      if (!m.length) m = S.classes.filter(c => norm(c.short).startsWith(p) && p.length >= 2);
      if (!m.length && p.length >= 3) m = S.classes.filter(c => norm(c.short).endsWith(p) || norm(c.classe) === p);
      if (m.length) ids.push(...m.map(c => c.id)); else unknown.push(part);
    }
    return { ids: [...new Set(ids)], unknown, multi: false };
  }
  // Retire les réglages posés par un import précédent pour cette classe
  function clearImportFlags(st, cid) {
    for (const [hid, rec] of Object.entries(st.occ)) {
      if (!rec.imp) continue;
      const src = (st.slots.find(x => x.id === hid.split('@')[0]) || st.extras.find(x => x.id === hid.split('@')[0]));
      if (src && PE.slotClassIds(src).includes(cid)) {
        delete rec.counts; delete rec.reserved; delete rec.imp;
        if (!Object.keys(rec).length) delete st.occ[hid];
      }
    }
  }
  function buildClassImport(E2, cid, rows) {
    const prog = rows.filter(r => r.program).sort((a, b) => a.date.localeCompare(b.date));
    const seqMap = new Map();
    for (const r of prog) { const k = norm(r.seq); if (!seqMap.has(k)) seqMap.set(k, { title: r.seq, items: [] }); seqMap.get(k).items.push(r); }
    const seqs = [...seqMap.values()].map(q => {
      const seances = q.items.sort((a, b) => a.date.localeCompare(b.date) || (a.num || 0) - (b.num || 0))
        .map(r => ({ title: r.title || q.title, kind: r.kind, date: r.date }));
      return { title: q.title, seances, start: seances[0].date, end: seances[seances.length - 1].date };
    });
    const dates = rows.map(r => r.date).sort();
    const first = dates[0], last = dates[dates.length - 1];
    const count = (list) => list.reduce((m, r) => { m[r.date] = (m[r.date] || 0) + 1; return m; }, {});
    const progBy = count(prog), libreBy = count(rows.filter(r => r.kind === 'libre'));
    const tracks = E2.tracksOf(cid);
    const flags = {}, extra = [], notes = {};
    let asSeance = 0, reserved = 0;
    for (let d = first; d && d <= last; d = addDays(d, 1)) {
      const bs = E2.blocksOn(d).filter(b => b.classIds.includes(cid) && !E2.classBlocked(d, cid));
      if (!bs.length) continue;
      const need = progBy[d] || 0, nl = libreBy[d] || 0;
      for (const g of tracks) {
        const hrs = bs.filter(b => tracks.length === 1 || !b.group || b.group === g).flatMap(b => b.hours.map(h => ({ h, b })));
        const isCounting = x => (flags[x.h.id] && flags[x.h.id].counts) || x.h.counts;
        let counting = hrs.filter(isCounting);
        if (counting.length < need + nl) {
          const cand = hrs.filter(x => !isCounting(x)).sort((a, b) => (a.b.type === 'ap' ? 0 : 1) - (b.b.type === 'ap' ? 0 : 1) || toMin(a.h.start) - toMin(b.h.start));
          for (const x of cand.slice(0, need + nl - counting.length)) { if (!flags[x.h.id]) asSeance++; flags[x.h.id] = { counts: true, imp: true }; }
          counting = hrs.filter(isCounting);
        }
        counting.sort((a, b) => toMin(a.h.start) - toMin(b.h.start));
        // Les « séances libres » du fichier ne sont pas gardées : la marge se retrouve en fin d'année
        counting.slice(need + nl).forEach(x => { if (!extra.includes(x.h.id)) extra.push(x.h.id); });
      }
    }
    // Contenus des AP, co-interventions et cours libres
    let unmatched = 0;
    for (const r of rows.filter(r => ['ap', 'coint'].includes(r.kind))) {
      const bs = E2.blocksOn(r.date).filter(b => b.classIds.includes(cid));
      const b = bs.find(x => x.type === r.kind && !notes[x.id]) || bs.find(x => x.type === r.kind);
      if (b) notes[b.id] = notes[b.id] && notes[b.id] !== r.title ? notes[b.id] + ' · ' + r.title : r.title;
      else unmatched++;
    }
    const text = seqs.map((q, i) => [`SÉQUENCE | ${i + 1} | ${q.title} | ${q.seances.length}`, ...q.seances.map((s, j) => `${j + 1} | ${s.title} | ${s.date}`)].join('\n')).join('\n');
    return { seqs, first, last, flags, extra, notes, text, asSeance, reserved, unmatched, nNotes: Object.keys(notes).length };
  }
  function applyAgenda(st, pv) {
    for (const [cid, imp] of Object.entries(pv.classes)) {
      const c = st.classes.find(x => x.id === cid); if (!c) continue;
      clearImportFlags(st, cid);
      const oldSeqs = st.sequences.filter(q => q.classId === cid);
      const oldIds = new Set(oldSeqs.map(q => q.id));
      const oldSeances = new Map();
      for (const s of st.seances) if (oldIds.has(s.sequenceId)) oldSeances.set(s.sequenceId + '|' + norm(s.title), s);
      st.seances = st.seances.filter(s => !oldIds.has(s.sequenceId));
      st.sequences = st.sequences.filter(q => q.classId !== cid);
      const kept = new Set();
      imp.seqs.forEach((q, i) => {
        const prev = oldSeqs.find(o => norm(o.title) === norm(q.title) && !kept.has(o.id));
        const id = prev ? prev.id : uid();
        if (prev) kept.add(prev.id);
        st.sequences.push({ id, classId: cid, title: q.title, convUrl: prev ? prev.convUrl : '', order: i });
        q.seances.forEach((s, j) => {
          const os = prev && oldSeances.get(prev.id + '|' + norm(s.title));
          st.seances.push({ id: os && !st.seances.some(x => x.id === os.id) ? os.id : uid(), sequenceId: id, title: s.title, kind: s.kind, prepared: os ? !!os.prepared : false, order: j });
        });
      });
      st.evaluations = st.evaluations.filter(x => !oldIds.has(x.sequenceId) || kept.has(x.sequenceId));
      st.exercises = st.exercises.filter(x => !oldIds.has(x.sequenceId) || kept.has(x.sequenceId));
      c.startDate = imp.first;
      for (const [hid, f] of Object.entries(imp.flags)) st.occ[hid] = { ...(st.occ[hid] || {}), ...f };
      for (const [bid, n] of Object.entries(imp.notes)) st.notes[bid] = n;
      if (pv.cancelExtra[cid]) for (const hid of imp.extra) st.occ[hid] = { ...(st.occ[hid] || {}), cancelled: true, imp: true };
      st.initial[cid] = {
        importedAt: today(), source: pv.fileName, text: imp.text, capacity: 0,
        sequences: imp.seqs.map(q => ({ title: q.title, hours: q.seances.length, start: q.start, end: q.end, seances: q.seances.map(s => ({ title: s.title, date: s.date })) })),
      };
    }
  }
  // Simulation : les séances tombent-elles aux dates du fichier ?
  function agendaCheck(pv) {
    const st = clone(S); st._rev = 1;
    applyAgenda(st, pv);
    const E2 = PE.Engine(() => st), p = E2.plan(), out = {};
    for (const [cid, imp] of Object.entries(pv.classes)) {
      const seqs = E2.orderedSequences(cid);
      let same = 0, total = 0; const diff = [];
      imp.seqs.forEach((q, i) => {
        const ss = seqs[i] ? E2.orderedSeancesOf(seqs[i].id) : [];
        q.seances.forEach((s, j) => {
          total++;
          const info = ss[j] && p.seance[ss[j].id];
          const got = info && info.firstDate;
          if (got === s.date) same++; else diff.push({ title: `${i + 1}.${j + 1} ${s.title}`, want: s.date, got });
        });
      });
      out[cid] = { same, total, diff, capacity: (p.perClass[cid] || {}).capacity || 0 };
    }
    return out;
  }
  function startAgendaImport(rows, fileName) {
    const parsed = IMP.parseAgenda(rows);
    if (!parsed || !parsed.rows.length) { toast('Aucune ligne datée reconnue dans ce fichier.'); return; }
    const byClass = {}, unknown = new Set();
    for (const r of parsed.rows) {
      let ids;
      if (parsed.hasClass && r.cls) { const m = matchClasses(r.cls); ids = m.ids; m.unknown.forEach(u => unknown.add(u)); }
      else ids = [UI.progClass];
      for (const id of ids) (byClass[id] ||= []).push(r);
    }
    // Ne garder que les classes qui ont des séances de programme
    for (const id of Object.keys(byClass)) if (!byClass[id].some(r => r.program)) delete byClass[id];
    if (!Object.keys(byClass).length) { toast('Aucune séance de programme reconnue dans ce fichier.'); return; }
    const st = clone(S); st._rev = 1;
    for (const cid of Object.keys(byClass)) clearImportFlags(st, cid);
    const E2 = PE.Engine(() => st);
    const classes = {};
    for (const [cid, rs] of Object.entries(byClass)) classes[cid] = buildClassImport(E2, cid, rs);
    const pv = { kind: 'agenda', fileName, classes, cancelExtra: Object.fromEntries(Object.keys(classes).map(k => [k, true])), unknown: [...unknown], skipped: parsed.skipped };
    pv.check = agendaCheck(pv);
    UI.iniPreview = pv; UI.progSub = 'initiale';
    if (!classes[UI.progClass]) UI.progClass = Object.keys(classes)[0];
    render();
  }
  function agendaPreviewHtml(pv) {
    let h = `<section class="card"><h2>Import du fichier « ${esc(pv.fileName)} »</h2>
      <p class="small muted">Chaque classe du fichier reçoit ses séquences et ses séances, dans l'ordre des dates. Les AP ou co-interventions qui portent une séance deviennent des séances de progression ; les « séances libres » du fichier ne sont pas gardées (la marge se retrouve en fin d'année) ; les contenus d'AP et de co-intervention deviennent des notes dans l'agenda.</p>`;
    if (pv.unknown.length) h += `<div class="banner">Classes inconnues ignorées : ${esc(pv.unknown.join(', '))}</div>`;
    for (const [cid, imp] of Object.entries(pv.classes)) {
      const c = classById(cid), ck = pv.check[cid];
      const nSe = imp.seqs.reduce((n, q) => n + q.seances.length, 0);
      h += `<div class="impcls" style="--cc:${classColor(cid)}"><h3>${esc(c.short)} — ${imp.seqs.length} séquences, ${nSe} séances, du ${esc(fmt(imp.first))} au ${esc(fmt(imp.last))}</h3>
        <ul class="plain small">
          <li>${ck.same === ck.total ? '✓' : '⚠'} <b>${ck.same} / ${ck.total}</b> séances tombent à la date du fichier avec votre emploi du temps.</li>
          ${imp.asSeance ? `<li>${imp.asSeance} cours d'AP ou de co-intervention deviennent des séances de progression.</li>` : ''}
          ${imp.nNotes ? `<li>${imp.nNotes} contenus d'AP / co-intervention / cours libre ajoutés en notes.</li>` : ''}
          ${imp.unmatched ? `<li class="bad">${imp.unmatched} ligne(s) d'AP ou de co-intervention sans créneau correspondant.</li>` : ''}
        </ul>
        ${imp.extra.length ? `<label class="check"><input type="checkbox" data-c="agendaCancel" data-id="${cid}" ${pv.cancelExtra[cid] ? 'checked' : ''}> Annuler les ${imp.extra.length} cours sans séance dans le fichier (stage, sortie…) : ${esc(imp.extra.slice(0, 8).map(id => fmt(id.split('@')[1].split('#')[0])).join(', '))}${imp.extra.length > 8 ? '…' : ''}</label>` : ''}
        ${ck.diff.length ? `<details class="edit"><summary>${ck.diff.length} séance(s) à une autre date</summary><ul class="plain small">${ck.diff.slice(0, 40).map(d => `<li>${esc(d.title)} : fichier ${esc(fmt(d.want))} → agenda ${d.got ? esc(fmt(d.got)) : 'sans créneau'}</li>`).join('')}</ul></details>` : ''}
        ${initialTable(imp.seqs, ck.capacity)}</div>`;
    }
    h += `<div class="row"><button data-a="agendaApply">Valider et figer (${Object.keys(pv.classes).length} classe${Object.keys(pv.classes).length > 1 ? 's' : ''})</button><button class="ghost" data-a="iniCancel">Annuler</button></div></section>`;
    return h;
  }

  /* Progression effective : déroulé réel, comparaison, réorganisation */
  function renderEffective(c) {
    const k = E.compare(c.id) || {};
    const ini = k.initial;
    let h = S.slots.some(s => s.classIds.includes(c.id)) ? yearCard(c) : '';
    // Absences marquées « à rattraper » : cours à reprogrammer
    const todo = lostHours(c.id).filter(x => x.makeUp && !S.extras.some(e => e.makeUpFor === x.hid));
    if (todo.length) h += `<section class="card"><h2>Cours à rattraper — ${esc(c.short)}</h2><ul class="plain">${todo.map(x =>
      `<li>${esc(fmt(x.date))} ${hm(x.start)}–${hm(x.end)} (${esc(x.why)}) <button class="ghost small" data-a="makeUp" data-h="${x.hid}" data-cls="${c.id}" data-type="${x.block.type}" data-s="${x.start}" data-e="${x.end}">Programmer le rattrapage</button></li>`).join('')}</ul>
      <p class="small muted">Les autres absences sont considérées comme perdues : la progression se décale et prend sur la marge.</p></section>`;
    h += `<h3>Où j'en suis aujourd'hui</h3><div class="tiles">
      ${ini ? tile(`${k.seancesDone || 0} / ${k.expected}`, "séances réalisées / prévues à ce jour") : tile(`${k.seancesDone || 0} / ${k.seances || 0}`, 'séances réalisées')}
      ${tile(`${k.seqDone || 0} / ${ini ? k.expectedSeq : k.seqTotal || 0}`, ini ? 'séquences terminées / prévues à ce jour' : 'séquences terminées')}
      ${ini ? tile(k.delta === 0 ? '0' : (k.delta > 0 ? '+' : '') + k.delta + ' h', k.delta < 0 ? 'de retard sur la progression initiale' : 'd\'avance sur la progression initiale', k.delta < 0 ? 'bad' : '') : ''}
      ${tile(k.unvalidated || 0, 'cours à valider', k.unvalidated ? 'warn' : '')}
    </div>`;
    if (k.tracks) h += `<p class="small muted">Groupes : ${k.tracks.map(t => `${esc(t.group)} ${t.done} h faites, marge ${t.margin > 0 ? '+' : ''}${t.margin} h`).join(' · ')}. Les chiffres ci-dessus sont ceux du groupe le moins avancé.</p>`;
    if (k.margin < 0 || k.unplaced) h += `<div class="banner bad">Risque de ne pas terminer : ${k.unplaced ? `${k.unplaced} séance(s) n'ont pas de créneau avant la fin de l'année` : `il manque ${-k.margin} h`}. <a href="#" class="threat" data-a="threat" data-id="${c.id}">Voir le détail</a></div>`;
    if (!ini) h += `<div class="banner">Pas encore de progression initiale figée pour ${esc(c.short)} : la comparaison avance / retard apparaîtra après l'import. <button class="ghost" data-a="progSub" data-v="initiale">Importer</button></div>`;
    h += reorgHtml(c, k);
    h += pastJournal(c);
    const seqs = E.orderedSequences(c.id);
    if (!seqs.length) h += `<div class="empty">Aucune séance pour cette classe.</div>`;
    seqs.forEach((q, i) => {
      const ss = E.orderedSeancesOf(q.id);
      const done = ss.filter(s => E.seanceStatus(s) === 'realisee').length;
      const sp = E.sequenceSpan(q.id), iq = ini && ini.sequences[i];
      h += `<section class="card seq" style="--cc:${classColor(c.id)}"><div class="seqh"><h2>Séquence ${i + 1} – ${esc(q.title)}</h2><span class="muted small">${done} / ${ss.length}</span></div>
        <p class="small muted">Effectif : ${esc(span(sp.start, sp.end))}${iq ? ` · Prévu : ${esc(span(iq.start, iq.end))}` : ''}</p>
        <ol class="slist">${ss.map(seanceItem).join('')}</ol>
        <div class="row"><button class="ghost small" data-a="addSeance" data-id="${q.id}">＋ Séance</button></div></section>`;
    });
    return h;
  }

  /* Journal des cours passés : dire, heure par heure, quelle séance a été faite et comment ça s'est passé.
     La suite de la progression se recalcule toute seule. */
  function pastJournal(c) {
    const t = today(), nm = PE.nowMin(), p = E.plan(), rows = [];
    for (let d = c.startDate || S.settings.rentree; d <= t; d = addDays(d, 1)) {
      for (const b of E.blocksOn(d)) {
        if (!b.classIds.includes(c.id) || b.blocked || E.classBlocked(d, c.id)) continue;
        for (const x of b.hours) if (x.counts && (d < t || toMin(x.end) <= nm)) rows.push({ d, x, b });
      }
    }
    if (!rows.length) return '';
    rows.reverse();
    const all = UI.pastAll === c.id, list = all ? rows : rows.slice(0, 12);
    const opts = E.orderedSequences(c.id).map(q => `<optgroup label="Séq. ${seqNum(q)} – ${esc(q.title)}">${E.orderedSeancesOf(q.id).filter(s => !s.skipped).map(s => `<option value="${s.id}">${esc(numTxt(s))}</option>`).join('')}</optgroup>`).join('');
    const STS = [['', '— à valider —'], ['realisee', 'Réalisée'], ['non_terminee', 'Non terminée'], ['reportee', 'Reportée'], ['non_realisee', 'Non réalisée'], ['annule', 'Cours annulé']];
    return `<details class="edit card" ${UI.pastOpen === c.id ? 'open' : ''} data-past="${c.id}"><summary>Corriger ce qui s'est passé (${rows.length} cours passés)</summary>
      <p class="small muted">Pour chaque heure : la séance réellement faite et son statut. Une séance qui a duré 2 h : choisissez-la sur les deux heures. Le reste de la progression se recalcule.</p>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Cours</th><th>Séance faite</th><th>Statut</th></tr></thead><tbody>
      ${list.map(({ d, x, b }) => {
        const rec = S.occ[x.id] || {}, o = p.occ[x.id] || {};
        const auto = o.seanceId && !rec.pin && seanceById(o.seanceId) ? ' : ' + esc(numTxt(seanceById(o.seanceId))) : '';
        const cur = rec.cancelled ? 'annule' : (rec.status || '');
        return `<tr><td class="nowrap">${esc(fmt(d))} ${hm(x.start)}${b.group ? `<div class="small muted">${esc(b.group)}</div>` : ''}${b.type !== 'cours' ? `<div class="small muted">${b.type === 'ap' ? 'AP' : 'co-int.'}</div>` : ''}</td>
          <td><select data-c="pin" data-h="${x.id}"><option value="">Automatique${auto}</option>${rec.pin ? opts.replace(`value="${rec.pin}"`, `value="${rec.pin}" selected`) : opts}</select></td>
          <td><select data-c="hstatus" data-h="${x.id}">${STS.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td></tr>`;
      }).join('')}</tbody></table></div>
      ${!all && rows.length > list.length ? `<button class="ghost small" data-a="pastAll" data-id="${c.id}">Voir les ${rows.length - list.length} cours plus anciens</button>` : ''}</details>`;
  }

  /* Réorganisation en cas de retard : propositions, simulation, rien d'appliqué sans validation */
  function reorgCandidates(c, k) {
    const t = today(), items = [];
    // Les cours passés pas encore validés ne comptent pas comme du retard à rattraper
    const lag = k.delta != null ? -(k.delta + (k.unvalidated || 0)) : 0;
    const needed = Math.max(k.unplaced || 0, lag, k.margin < 0 ? -k.margin : 0, 0);
    const reserved = [], ap = [];
    for (let d = t; d <= S.settings.finAnnee; d = addDays(d, 1)) {
      for (const b of E.blocksOn(d)) {
        if (!b.classIds.includes(c.id) || E.classBlocked(d, c.id)) continue;
        for (const x of b.hours) {
          const rec = S.occ[x.id] || {};
          if (rec.cancelled) continue;
          if (x.counts && rec.reserved) reserved.push({ kind: 'reserved', hid: x.id, date: d, label: `Utiliser le cours libre du ${fmt(d)} ${hm(x.start)}${b.note ? ` (${b.note})` : ''}` });
          else if (!x.counts && b.type === 'ap' && b.classIds.length === 1) ap.push({ kind: 'ap', hid: x.id, date: d, other: !!(b.group && k.tracks && b.group !== k.worstGroup), label: `Faire une séance de cours pendant l'AP du ${fmt(d)} ${hm(x.start)}${b.group ? ' · ' + b.group : ''}${b.note ? ` (prévu : ${b.note})` : ''}` });
        }
      }
    }
    let n = 0;
    ap.sort((a, b) => a.other - b.other || a.date.localeCompare(b.date)); // d'abord le groupe en retard
    for (const x of reserved) { items.push({ ...x, on: n < needed }); n++; }
    for (const x of ap) { if (items.length >= needed + 6) break; items.push({ ...x, on: n < needed }); n++; }
    // Séances qui ne tiennent toujours pas : à fusionner ou retirer, à la main
    const list = E.orderedSeances(c.id).filter(s => !s.skipped);
    const unplaced = list.filter(s => (E.plan().seance[s.id] || {}).unplaced);
    for (const s of unplaced) items.push({ kind: 'skip', seanceId: s.id, label: `Retirer « ${s.title} » (séq. ${seqNum(seqById(s.sequenceId))}) de la progression effective`, on: false });
    return { needed, items };
  }
  function applyReorg(st, items) {
    for (const x of items.filter(i => i.on)) {
      if (x.kind === 'reserved') { const r = { ...(st.occ[x.hid] || {}) }; delete r.reserved; if (Object.keys(r).filter(k => k !== 'imp').length) st.occ[x.hid] = r; else delete st.occ[x.hid]; }
      else if (x.kind === 'ap') st.occ[x.hid] = { ...(st.occ[x.hid] || {}), counts: true };
      else if (x.kind === 'skip') { const s = st.seances.find(y => y.id === x.seanceId); if (s) s.skipped = true; }
    }
  }
  function reorgHtml(c, k) {
    const r = UI.reorg && UI.reorg.classId === c.id ? UI.reorg : null;
    const late = (k.delta != null && k.delta + (k.unvalidated || 0) < 0) || k.margin < 0 || k.unplaced;
    if (!r) return `<div class="row"><button class="${late ? '' : 'ghost'}" data-a="reorg">Proposer une réorganisation</button>${late ? '' : '<span class="small muted">Pas de retard pour l’instant.</span>'}</div>`;
    if (!r.items.length) return `<section class="card"><h2>Réorganisation</h2><p>${r.needed ? 'Aucun cours libre ni AP disponible d’ici la fin de l’année : il faudra fusionner ou alléger des séances à la main.' : 'Aucun retard : rien à proposer.'}</p><button class="ghost" data-a="reorgClose">Fermer</button></section>`;
    // Simulation des changements choisis
    const st = clone(S); st._rev = 1; applyReorg(st, r.items);
    const E2 = PE.Engine(() => st), p1 = E.plan(), p2 = E2.plan(), k2 = E2.compare(c.id);
    const changes = E.orderedSeances(c.id).map(s => ({ s, a: (p1.seance[s.id] || {}).firstDate, b: s.id && (p2.seance[s.id] || {}).firstDate, skip: st.seances.find(y => y.id === s.id).skipped && !s.skipped }))
      .filter(x => x.a !== x.b || x.skip);
    return `<section class="card reorg"><h2>Réorganisation proposée — ${esc(c.short)}</h2>
      <p class="small">À rattraper : <b>${r.needed} h</b>. Cochez les changements à appliquer ; rien n'est modifié tant que vous ne validez pas. La progression initiale ne change jamais.</p>
      <ul class="plain">${r.items.map((x, i) => `<li><label class="check"><input type="checkbox" data-c="reorgItem" data-i="${i}" ${x.on ? 'checked' : ''}> ${esc(x.label)}</label></li>`).join('')}</ul>
      <div class="tiles">${tile(`${k.margin > 0 ? '+' : ''}${k.margin} → ${k2.margin > 0 ? '+' : ''}${k2.margin} h`, 'marge')}${k.delta != null ? tile(`${k.delta} → ${k2.delta}`, 'avance / retard aujourd’hui') : ''}${tile(`${k.unplaced} → ${k2.unplaced}`, 'séances sans créneau')}</div>
      ${changes.length ? `<details class="edit" open><summary>${changes.length} séance(s) changent de date</summary><ul class="plain small">${changes.slice(0, 40).map(x => `<li>Séq. ${seqNum(seqById(x.s.sequenceId))} · ${esc(numTxt(x.s))} :${x.a ? esc(fmt(x.a)) : 'sans créneau'} → ${x.skip ? 'retirée' : x.b ? esc(fmt(x.b)) : 'sans créneau'}</li>`).join('')}</ul></details>` : '<p class="small muted">Aucun changement de date avec cette sélection.</p>'}
      <div class="row"><button data-a="reorgApply">Appliquer la sélection</button><button class="ghost" data-a="reorgClose">Refuser</button></div></section>`;
  }

  /* ---------- Réglages ---------- */
  function renderSettings() {
    const st = S.settings;
    let h = `<nav class="toc">
      <a href="#sec-classes">Classes</a><a href="#sec-edt">Emploi du temps</a><a href="#sec-weeks">Semaines Q1 / Q2</a><a href="#sec-cal">Calendrier</a><a href="#sec-start">Démarrage en cours d'année</a><a href="#sec-prompts">Modèles de prompts</a><a href="#sec-year">Nouvelle année</a><a href="#sec-data">Données</a></nav>`;

    h += `<section class="card" id="sec-classes"><h2>Classes</h2><div class="tablewrap"><table class="tbl">
      <thead><tr><th>Nom court</th><th>Classe</th><th>Matière</th><th>Lien du Projet Claude</th><th>Début des séances</th><th></th></tr></thead><tbody>
      ${S.classes.map(c => `<tr>
        <td><input data-c="cls" data-id="${c.id}" data-f="short" value="${esc(c.short)}" aria-label="Nom court"></td>
        <td><input data-c="cls" data-id="${c.id}" data-f="classe" value="${esc(c.classe)}" aria-label="Classe"></td>
        <td><input data-c="cls" data-id="${c.id}" data-f="matiere" value="${esc(c.matiere)}" aria-label="Matière"></td>
        <td><input data-c="cls" data-id="${c.id}" data-f="projectUrl" value="${esc(c.projectUrl)}" placeholder="https://claude.ai/project/…" aria-label="Lien du Projet"></td>
        <td><input type="date" data-c="cls" data-id="${c.id}" data-f="startDate" value="${esc(c.startDate)}" aria-label="Début"></td>
        <td><button class="icon" data-a="delClass" data-id="${c.id}" title="Supprimer" aria-label="Supprimer">🗑</button></td></tr>`).join('')}
      </tbody></table></div><button class="ghost" data-a="addClass">＋ Classe</button>
      <p class="small muted">« Début des séances » : laissez vide pour commencer à la rentrée (l'import d'un tableau daté le remplit).</p></section>`;

    h += `<section class="card" id="sec-edt"><h2>Emploi du temps</h2>
      <ol class="steps"><li>Copiez le prompt, puis envoyez-le à Claude avec la photo ou le PDF de l'emploi du temps — ou tapez directement le tableau.</li>
      <li>Collez le texte ci-dessous (une ligne par créneau), puis vérifiez les créneaux reconnus.</li></ol>
      <pre class="ex">Jour | Horaire | Type | Classe | Groupe | Semaine | Semestre | Collègue
Lundi | 8h00-8h55 | AP | 2MV | 2MV2 | Q1 | - | -
Mardi | 8h00-9h50 | Co-intervention | CAP1 Mét + CAP1 Peint | - | Q1 | - | Zabe A.</pre>
      <div class="row"><button data-a="copyImport">Copier le prompt d'import</button><a class="btn ghost" href="https://claude.ai/new" target="_blank" rel="noopener">Ouvrir Claude ↗</a>
        ${S.slots.length ? `<button class="ghost" data-a="copyEdtText">Copier l'emploi du temps actuel (texte)</button>` : ''}</div>
      <textarea id="edtText" rows="7" placeholder="Lundi | 8h00-8h55 | Cours | 2MV | 2MV2 | Toutes | - | -"></textarea>
      <div class="row"><button data-a="parseEdt">Analyser le texte</button></div>
      ${edtPreviewHtml()}
      <h3>Créneaux enregistrés (${S.slots.length})</h3>
      ${slotsTable()}
      <div class="row"><button class="ghost" data-a="slotForm">＋ Créneau</button><button class="ghost" data-a="extraForm">＋ Cours ponctuel (une date)</button></div>
      ${S.extras.length ? `<h3>Cours ponctuels</h3><ul class="plain">${S.extras.slice().sort((a, b) => a.date.localeCompare(b.date)).map(x => `<li>${esc(fmt(x.date))} ${hm(x.start)}–${hm(x.end)} · ${esc(x.classIds.map(id => classById(id)?.short).join(' + ') || x.label)} <button class="icon" data-a="delExtra" data-id="${x.id}" aria-label="Supprimer">🗑</button></li>`).join('')}</ul>` : ''}
      <p class="small muted">Seuls les créneaux de type Cours génèrent une séance à préparer. AP et co-intervention apparaissent dans l'agenda sans séance (on peut, cours par cours, y placer une séance de progression).</p></section>`;

    const anchors = E.anchors();
    h += `<section class="card" id="sec-weeks"><h2>Semaines Q1 / Q2 et semestres</h2>
      <p>Cette semaine : <span class="qpill q${E.weekType(today())}">${E.weekLabel(E.weekType(today()))}</span> · semestre ${E.semesterOf(today())}</p>
      <h3>Repères</h3><ul class="plain">${anchors.map(a => `<li>Semaine du ${esc(fmt(a.monday, { day: 'numeric', month: 'long', year: 'numeric' }))} = <b>Q${a.type}</b> ${(S.settings.weekAnchors || []).length > 1 ? `<button class="icon" data-a="delAnchor" data-m="${a.monday}" aria-label="Supprimer ce repère">🗑</button>` : ''}</li>`).join('')}</ul>
      <div class="form"><label>Semaine du <input type="date" id="anchorDate" value="${mondayOf(today())}"></label>
        <label>est <select id="anchorType"><option value="1">Q1</option><option value="2">Q2</option></select></label>
        <button class="ghost" data-a="addAnchor">Ajouter ce repère</button></div>
      <p class="small muted">L'alternance part du repère le plus proche avant la semaine affichée. Dans l'agenda, le bouton « Corriger » ajoute un repère pour la semaine affichée.</p>
      <label class="check"><input type="checkbox" data-c="setBool" data-f="skipVacations" ${st.skipVacations ? 'checked' : ''}> Les semaines de vacances ne comptent pas dans l'alternance</label>
      <div class="form"><label>Début du semestre 2 <input type="date" data-c="set" data-f="s2Start" value="${esc(st.s2Start || '')}"></label></div>
      <p class="small muted">Les créneaux marqués S1 s'arrêtent la veille ; ceux marqués S2 commencent ce jour-là.</p></section>`;

    const y = Number(st.rentree.slice(0, 4));
    const feries = [...PE.feriesOf(y), ...PE.feriesOf(y + 1)].filter(([d]) => d >= st.rentree && d <= st.finAnnee && weekday(d) < 7);
    h += `<section class="card" id="sec-cal"><h2>Calendrier scolaire</h2>
      <div class="form">
        <label>Rentrée <input type="date" data-c="setCal" data-f="rentree" value="${esc(st.rentree)}"></label>
        <label>Fin des cours <input type="date" data-c="setCal" data-f="finAnnee" value="${esc(st.finAnnee)}"></label>
        <label>Zone <select data-c="setCal" data-f="zone">${['A', 'B', 'C'].map(z => `<option ${st.zone === z ? 'selected' : ''}>${z}</option>`).join('')}</select></label>
      </div>
      <div class="row"><button class="ghost" data-a="reloadHolidays">Recharger les vacances (calendrier officiel)</button>
      <span class="small muted">Source : ${esc(st.holidaysSource || '—')}${st.holidaysLoadedAt ? ', ' + esc(fmt(st.holidaysLoadedAt)) : ''}</span></div>
      <div class="cols2"><div><h3>Vacances zone ${esc(st.zone)} ${esc(st.holidaysYear || '')}</h3><ul class="plain">${S.holidays.map(x => `<li>${esc(x.label)} : ${esc(fmt(x.start))}${x.end !== x.start ? ' → ' + esc(fmt(x.end)) : ''}</li>`).join('')}</ul></div>
      <div><h3>Jours fériés</h3><ul class="plain">${feries.map(([d, l]) => `<li>${esc(l)} : ${esc(fmt(d))}</li>`).join('')}</ul></div></div>
      <h3>PFMP, examens, journées sans cours</h3>
      ${S.events.length ? `<ul class="plain">${S.events.slice().sort((a, b) => a.start.localeCompare(b.start)).map(ev => `<li><span class="tag ev-${ev.type}">${esc(EVENT_TYPES[ev.type])}</span> ${esc(ev.label)} · ${esc(fmt(ev.start))}${ev.end !== ev.start ? ' → ' + esc(fmt(ev.end)) : ''}${esc(evWhen(ev))} · ${ev.classIds.length ? esc(ev.classIds.map(id => classById(id)?.short).filter(Boolean).join(', ')) : 'toutes les classes'}${ev.noClass ? ' · pas de cours' : ''}
        <button class="icon" data-a="eventForm" data-id="${ev.id}" aria-label="Modifier">✎</button><button class="icon" data-a="delEvent" data-id="${ev.id}" aria-label="Supprimer">🗑</button></li>`).join('')}</ul>` : '<p class="muted small">Aucun.</p>'}
      <button class="ghost" data-a="eventForm">＋ Ajouter</button></section>`;

    h += `<section class="card" id="sec-start"><h2>Démarrage en cours d'année</h2>
      <p class="small">Toutes les séances prévues jusqu'à cette date (incluse) et pas encore validées passent en « réalisée ». Ajustez ensuite à la main celles qui n'ont pas eu lieu.</p>
      <div class="form"><label>Jusqu'au <input type="date" id="doneUntil" value="${addDays(today(), -1)}"></label>
      <label>Classe <select id="doneClass"><option value="">Toutes</option>${S.classes.map(c => `<option value="${c.id}">${esc(c.short)}</option>`).join('')}</select></label></div>
      <button data-a="markDone">Marquer comme réalisé jusqu'au…</button>
      <h3>Réalisé par défaut</h3>
      <label class="check"><input type="checkbox" data-c="setBool" data-f="autoDone" ${st.autoDone ? 'checked' : ''}> Compter chaque cours passé comme « réalisé », sauf si j'indique autre chose</label>
      <p class="small muted">Plus besoin de valider chaque heure : vous ne signalez que les exceptions (non terminée, reportée, non réalisée, annulé).</p></section>`;

    const T = PROMPTS.TEMPLATES, key = T[UI.tplKey] ? UI.tplKey : 'seance', custom = S.prompts[key] != null;
    h += `<section class="card" id="sec-prompts"><h2>Modèles de prompts</h2>
      <p class="small muted">Les règles habituelles (mise en page, livrables…) restent dans les instructions des Projets Claude. Ici, seulement le texte que l'application envoie. Les mots entre accolades sont remplacés automatiquement.</p>
      <div class="form"><label>Modèle <select data-c="tplSel">${Object.entries(T).map(([k, t]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${esc(t.label)}${S.prompts[k] != null ? ' (modifié)' : ''}</option>`).join('')}</select></label></div>
      <textarea rows="14" data-c="tplText" data-k="${key}">${esc(custom ? S.prompts[key] : T[key].text)}</textarea>
      <p class="small">Variables : ${Object.entries(T[key].vars).map(([v, d]) => `<code>{${v}}</code> ${esc(d)}`).join(' · ')}</p>
      ${custom ? `<button class="ghost" data-a="tplReset" data-k="${key}">Rétablir le modèle d'origine</button>` : ''}</section>`;

    const yl = `${st.rentree.slice(0, 4)}-${st.finAnnee.slice(0, 4)}`, ny = `${Number(st.rentree.slice(0, 4)) + 1}-${Number(st.finAnnee.slice(0, 4)) + 1}`;
    h += `<section class="card" id="sec-year"><h2>Nouvelle année scolaire</h2>
      <p class="small">Archive l'année ${esc(yl)} (tout est conservé : séquences, séances, validations, progression figée), puis repart avec les mêmes classes et les mêmes modèles de prompts pour ${esc(ny)}.</p>
      <label class="check"><input type="checkbox" id="keepEdt"> Garder l'emploi du temps actuel</label>
      <label class="check"><input type="checkbox" id="keepProg" checked> Reprendre les séquences et les séances de cette année (titres, liens vers les fiches, remarques), sans les validations</label>
      <button data-a="archiveYear">Archiver ${esc(yl)} et préparer ${esc(ny)}</button>
      <h3>Années archivées</h3>
      ${S.archives.length ? `<ul class="plain">${S.archives.map(a => `<li><b>${esc(a.label)}</b> · archivée le ${esc(fmt(a.archivedAt))}
        <button class="ghost small" data-a="viewArchive" data-id="${a.id}">Consulter</button><button class="ghost small" data-a="exportArchive" data-id="${a.id}">Exporter</button><button class="icon" data-a="delArchive" data-id="${a.id}" aria-label="Supprimer">🗑</button></li>`).join('')}</ul>` : '<p class="muted small">Aucune.</p>'}</section>`;

    const snaps = snapshots();
    h += `<section class="card" id="sec-versions"><h2>Versions précédentes</h2>
      <p class="small">L'application garde automatiquement sur cet appareil une copie de vos données chaque jour, et avant chaque remplacement (récupération en ligne, restauration). Les 8 dernières sont conservées.</p>
      ${snaps.length ? `<ul class="plain">${snaps.map(b => `<li>${esc(new Date(b.at).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · <span class="muted">${esc(b.reason)}</span> <button class="ghost small" data-a="restoreSnap" data-id="${b.id}">Revenir à cette version</button></li>`).join('')}</ul>` : '<p class="muted small">Aucune pour l\'instant.</p>'}</section>`;
    h += `<section class="card" id="sec-cal-export"><h2>Agenda dans le calendrier du téléphone</h2>
      <p class="small">Télécharge un fichier calendrier (.ics) avec vos cours et vos séances d'aujourd'hui à la fin de l'année, à ouvrir avec Google Agenda, le calendrier de l'iPhone ou Outlook. C'est une photo à un instant donné : refaites l'export après de gros changements.</p>
      <button class="ghost" data-a="exportIcs">Exporter l'agenda (.ics)</button></section>`;
    h += `<section class="card" id="sec-data"><h2>Données</h2>
      <p class="small">Les données sont enregistrées dans ce navigateur. Exportez-les régulièrement ; la synchronisation en ligne entre appareils viendra avec l'hébergement.</p>
      <p class="small muted">Dernier export : ${st.lastExport ? esc(fmt(st.lastExport)) : 'jamais'}</p>
      <div class="row"><button data-a="export">Exporter mes données</button><button class="ghost" data-a="import">Importer une sauvegarde</button>${window.DEPART ? '<button class="ghost" data-a="loadDepart">Recharger les données de départ (8 nov. 2026)</button>' : ''}<button class="danger" data-a="reset">Tout effacer</button></div></section>`;
    return h;
  }

  const weeksLabel = w => w === '12' ? 'Toutes' : 'Q' + w;
  function slotsTable() {
    if (!S.slots.length) return '<p class="muted small">Aucun créneau.</p>';
    const rows = S.slots.slice().sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start) || a.weeks.localeCompare(b.weeks));
    return `<div class="tablewrap"><table class="tbl"><thead><tr><th>Jour</th><th>Horaire</th><th>Type</th><th>Classe</th><th>Groupe</th><th>Semaine</th><th>Sem.</th><th>Collègue</th><th>Séance</th><th></th></tr></thead><tbody>
      ${rows.map(s => `<tr><td>${DAYS[s.day]}</td><td class="nowrap">${hm(s.start)}–${hm(s.end)}</td><td>${esc(s.type === 'hors' ? (s.label || 'Hors progression') : SLOT_TYPES[s.type])}</td>
        <td>${s.classIds.length || s.classLabel ? `<b>${esc(s.classLabel || s.classIds.map(id => classById(id)?.short || '?').join(' + '))}</b>` : '—'}</td>
        <td>${esc(s.group || '—')}</td><td>${weeksLabel(s.weeks)}</td><td>${esc(s.semester || '—')}</td><td>${esc(s.colleague || '—')}</td><td>${PE.slotCounts(s) && s.classIds.length ? '✓' : ''}</td>
        <td class="nowrap"><button class="icon" data-a="slotForm" data-id="${s.id}" aria-label="Modifier">✎</button><button class="icon" data-a="delSlot" data-id="${s.id}" aria-label="Supprimer">🗑</button></td></tr>`).join('')}
      </tbody></table></div>`;
  }
  function edtToText() {
    const rows = S.slots.slice().sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start) || a.weeks.localeCompare(b.weeks));
    const line = s => {
      const cls = s.classLabel || s.classIds.map(id => classById(id)?.short).filter(Boolean).join(' + ') || '-';
      const type = s.type === 'hors' ? (s.label || 'Hors progression') : SLOT_TYPES[s.type];
      const grp = s.group || (s.type === 'cours' && s.classIds.length === 1 && E.tracksOf(s.classIds[0]).length > 1 ? 'classe entière' : '-');
      return [DAYS[s.day], `${hm(s.start)}-${hm(s.end)}`, type, cls, grp, weeksLabel(s.weeks), s.semester || '-', s.colleague || '-'].join(' | ');
    };
    return ['Jour | Horaire | Type | Classe | Groupe | Semaine | Semestre | Collègue', ...rows.map(line)].join('\n');
  }

  function classOptions(sel, withNone) {
    return (withNone ? `<option value="" ${!sel ? 'selected' : ''}>—</option>` : '') +
      S.classes.map(c => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.short)}</option>`).join('');
  }
  function edtPreviewHtml() {
    const p = UI.edtPreview; if (!p) return '';
    if (!p.length) return `<p class="banner bad">Aucun créneau reconnu. Vérifiez le format (une ligne par créneau, champs séparés par « | »).</p>`;
    const nWarn = p.filter(r => r.warn).length;
    return `<h3>Créneaux reconnus (${p.length}) — à vérifier</h3>${nWarn ? `<p class="banner">${nWarn} ligne(s) à vérifier (surlignées).</p>` : ''}
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Jour</th><th>Début</th><th>Fin</th><th>Type</th><th>Classe</th><th>Groupe</th><th>Semaine</th><th>Sem.</th><th>Collègue</th><th></th></tr></thead><tbody>
      ${p.map((r, i) => `<tr class="${r.warn ? 'warnrow' : ''}">
        <td><select data-c="pv" data-i="${i}" data-f="day">${[1, 2, 3, 4, 5, 6].map(d => `<option value="${d}" ${r.day === d ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select></td>
        <td><input type="time" data-c="pv" data-i="${i}" data-f="start" value="${r.start}"></td>
        <td><input type="time" data-c="pv" data-i="${i}" data-f="end" value="${r.end}"></td>
        <td><select data-c="pv" data-i="${i}" data-f="type">${Object.entries(SLOT_TYPES).map(([k, l]) => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${r.type === 'hors' && r.label ? `<div class="small muted">${esc(r.label)}</div>` : ''}</td>
        <td>${r.classIds.length > 1 || r.classLabel ? `<b>${esc(r.classLabel || r.classIds.map(id => classById(id)?.short).join(' + '))}</b>` : `<select data-c="pv" data-i="${i}" data-f="classId">${classOptions(r.classIds[0], true)}</select>`}${r.warn ? `<div class="small bad">${esc(r.warn)}</div>` : r.info ? `<div class="small muted">${esc(r.info)}</div>` : ''}</td>
        <td><input data-c="pv" data-i="${i}" data-f="group" value="${esc(r.group)}" size="7"></td>
        <td><select data-c="pv" data-i="${i}" data-f="weeks">${['12', '1', '2'].map(w => `<option value="${w}" ${r.weeks === w ? 'selected' : ''}>${weeksLabel(w)}</option>`).join('')}</select></td>
        <td><select data-c="pv" data-i="${i}" data-f="semester">${['', 'S1', 'S2'].map(w => `<option value="${w}" ${r.semester === w ? 'selected' : ''}>${w || '—'}</option>`).join('')}</select></td>
        <td><input data-c="pv" data-i="${i}" data-f="colleague" value="${esc(r.colleague)}" size="9"></td>
        <td><button class="icon" data-a="pvDel" data-i="${i}" aria-label="Retirer">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row"><button data-a="pvApply" data-mode="replace">Remplacer l'emploi du temps</button><button class="ghost" data-a="pvApply" data-mode="add">Ajouter aux créneaux existants</button><button class="ghost" data-a="pvCancel">Annuler</button></div>`;
  }

  function normTime(t) {
    const m = String(t || '').trim().match(/^(\d{1,2})\s*[h:.]\s*(\d{0,2})/i);
    if (!m) return null;
    return PE.pad(Number(m[1])) + ':' + PE.pad(Number(m[2] || 0));
  }
  function slotTypeOf(raw) {
    const t = norm(raw);
    if (!t || t === 'cours' || t === 'c') return { type: 'cours' };
    if (t === 'ap' || t.startsWith('accomp')) return { type: 'ap' };
    if (t.includes('cointer') || t === 'coint') return { type: 'coint' };
    return { type: 'hors', label: t === 'hors' ? 'Hors progression' : String(raw).trim() };
  }
  /* Format : Jour | Horaire | Type | Classe | Groupe | Semaine | Semestre | Collègue
     (l'ancien format Jour | Début | Fin | Classe | Groupe | Semaine | Libellé reste accepté) */
  function parseEdt(text) {
    const dayMap = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
    const dash = v => { const x = String(v || '').trim(); return x === '-' || x === '—' || x === '?' ? '' : x; };
    const rows = [];
    for (let line of text.split(/\r?\n/)) {
      line = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      if (!line || /^[-|:\s]+$/.test(line) || /^```/.test(line)) continue;
      const f = line.split(/\s*[|;\t]\s*/).map(x => x.trim());
      const day = dayMap[norm(f[0])] || dayMap[norm(f[0]).slice(0, 3)];
      if (!day) continue;
      let start, end, typeRaw, clsRaw, group, weekRaw, sem = '', colleague = '', label = '';
      const range = String(f[1] || '').split(/\s*[-–—à]\s*/);
      if (range.length === 2 && normTime(range[0]) && normTime(range[1])) {
        start = normTime(range[0]); end = normTime(range[1]);
        [typeRaw, clsRaw, group, weekRaw, sem, colleague, label] = [f[2], f[3], f[4], f[5], f[6], f[7], f[8]];
      } else {
        start = normTime(f[1]); end = normTime(f[2]);
        clsRaw = f[3]; group = f[4]; weekRaw = f[5]; label = f[6];
        typeRaw = norm(clsRaw) === 'hors' ? (label || 'Hors progression') : 'Cours';
      }
      if (!start || !end || toMin(end) <= toMin(start)) continue;
      const tp = slotTypeOf(typeRaw);
      const cls = dash(clsRaw);
      const m = cls && norm(cls) !== 'hors' ? matchClasses(cls) : { ids: [], unknown: [] };
      let warn = '', info = '', classLabel = '';
      const parts = cls ? cls.split(/\s*\+\s*/).length : 0;
      if (m.unknown.length) {
        classLabel = cls;
        if (tp.type === 'cours') warn = `classe « ${m.unknown.join(', ')} » inconnue`;
        else info = 'classe hors liste : gardée comme libellé';
      } else if (m.ids.length > parts) {
        classLabel = cls;
        if (tp.type === 'cours') warn = `« ${cls} » désigne plusieurs classes : choisissez`;
      }
      const g = dash(group);
      const w = norm(weekRaw);
      const weeks = !w || w === 'toutes' || w === '12' || w === 'tous' ? '12' : w.endsWith('1') ? '1' : w.endsWith('2') ? '2' : '12';
      const s = norm(sem);
      rows.push({
        day, start, end, type: tp.type, classIds: warn && tp.type === 'cours' ? [] : m.ids, classLabel, raw: cls,
        group: ['classeentiere', 'entiere', 'classe', 'groupes1et2'].includes(norm(g)) ? '' : g,
        weeks, semester: s === 's1' ? 'S1' : s === 's2' ? 'S2' : '', colleague: dash(colleague),
        label: tp.label || dash(label), warn, info,
      });
    }
    return rows;
  }

  function slotForm(id, extra, pre) {
    return () => {
      const s = id ? (extra ? S.extras : S.slots).find(x => x.id === id) : null;
      const v = s || { day: 1, start: '08:00', end: '08:55', type: 'cours', classIds: S.classes[0] ? [S.classes[0].id] : [], classLabel: '', group: '', weeks: '12', semester: '', colleague: '', label: '', date: today(), ...(pre || {}) };
      return `<h2>${v.makeUpFor ? 'Rattrapage' : extra ? 'Cours ponctuel' : (s ? 'Modifier le créneau' : 'Nouveau créneau')}</h2>
        ${v.makeUpFor ? `<p class="small muted">Choisissez la date et l'heure du rattrapage : la séance prévue s'y placera.</p>` : ''}
        <form class="form" data-form="${extra ? 'extra' : 'slot'}" data-id="${id || ''}">
          <input type="hidden" name="makeUpFor" value="${esc(v.makeUpFor || '')}">
          ${extra ? `<label>Date <input type="date" name="date" value="${esc(v.date)}" required></label>` :
          `<label>Jour <select name="day">${[1, 2, 3, 4, 5, 6].map(d => `<option value="${d}" ${v.day === d ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select></label>`}
          <label>Début <input type="time" name="start" value="${v.start}" required></label>
          <label>Fin <input type="time" name="end" value="${v.end}" required></label>
          <label>Type <select name="type">${Object.entries(SLOT_TYPES).map(([k, l]) => `<option value="${k}" ${v.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <fieldset><legend>Classe(s)</legend>${S.classes.map(c => `<label class="check"><input type="checkbox" name="cls" value="${c.id}" ${v.classIds.includes(c.id) ? 'checked' : ''}> ${esc(c.short)}</label>`).join('')}</fieldset>
          <label>Nom affiché (facultatif) <input name="classLabel" value="${esc(v.classLabel)}" placeholder="ex. 1MV, 2TB2E"></label>
          <label>Groupe <input name="group" value="${esc(v.group)}" placeholder="vide = classe entière"></label>
          ${extra ? '' : `<label>Semaine <select name="weeks">${['12', '1', '2'].map(w => `<option value="${w}" ${v.weeks === w ? 'selected' : ''}>${weeksLabel(w)}</option>`).join('')}</select></label>
          <label>Semestre <select name="semester">${['', 'S1', 'S2'].map(w => `<option value="${w}" ${v.semester === w ? 'selected' : ''}>${w || 'Toute l\'année'}</option>`).join('')}</select></label>`}
          <label>Collègue <input name="colleague" value="${esc(v.colleague)}"></label>
          <label>Libellé (hors progression) <input name="label" value="${esc(v.label)}" placeholder="Aide aux élèves, réunion…"></label>
          <label>Séance à préparer <select name="countsMode">
            <option value="auto" ${v.counts == null ? 'selected' : ''}>Selon le type (oui pour un cours)</option>
            <option value="yes" ${v.counts === true ? 'selected' : ''}>Oui</option>
            <option value="no" ${v.counts === false ? 'selected' : ''}>Non</option></select></label>
          <div class="row"><button type="submit">Enregistrer</button></div>
        </form>`;
    };
  }
  function eventForm(id) {
    return () => {
      const ev = id ? S.events.find(x => x.id === id) : null;
      const v = ev || { type: 'pfmp', label: '', start: today(), end: today(), classIds: [], noClass: true };
      return `<h2>${ev ? 'Modifier' : 'Ajouter'} une période</h2>
        <form class="form" data-form="event" data-id="${id || ''}">
          <label>Type <select name="type">${Object.entries(EVENT_TYPES).map(([k, l]) => `<option value="${k}" ${v.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Libellé <input name="label" value="${esc(v.label)}" placeholder="PFMP 1, Bac blanc…"></label>
          <label>Du <input type="date" name="start" value="${v.start}" required></label>
          <label>Au (inclus) <input type="date" name="end" value="${v.end}" required></label>
          <label>De (heure, facultatif) <input type="time" name="startTime" value="${esc(v.startTime || '')}"></label>
          <label>À <input type="time" name="endTime" value="${esc(v.endTime || '')}"></label>
          <label class="check"><input type="checkbox" name="keepCoint" ${v.keepCoint ? 'checked' : ''}> Co-interventions maintenues</label>
          <label class="check"><input type="checkbox" name="makeUp" ${v.makeUp ? 'checked' : ''}> Cours à rattraper (sinon ils sont perdus)</label>
          <fieldset><legend>Classes concernées (aucune cochée = toutes)</legend>
            ${S.classes.map(c => `<label class="check"><input type="checkbox" name="cls" value="${c.id}" ${v.classIds.includes(c.id) ? 'checked' : ''}> ${esc(c.short)}</label>`).join('')}</fieldset>
          <label class="check"><input type="checkbox" name="noClass" ${v.noClass ? 'checked' : ''}> Pas de cours pendant cette période</label>
          <div class="row"><button type="submit">Enregistrer</button></div>
        </form>`;
    };
  }
  function archiveModal(id) {
    return () => {
      const a = S.archives.find(x => x.id === id); if (!a) return null;
      const d = a.data;
      const E2 = PE.Engine(() => ({ ...d, _rev: 1 }));
      return `<h2>Année ${esc(a.label)}</h2><p class="small muted">Archivée le ${esc(fmt(a.archivedAt, { day: 'numeric', month: 'long', year: 'numeric' }))} — lecture seule.</p>` + d.classes.map(c => {
        const seqs = E2.orderedSequences(c.id);
        if (!seqs.length) return '';
        return `<h3>${esc(c.short)}</h3><ul class="plain small">${seqs.map((q, i) => { const ss = E2.orderedSeancesOf(q.id); const done = ss.filter(s => E2.seanceStatus(s) === 'realisee').length; return `<li>Séquence ${i + 1} – ${esc(q.title)} · ${done} / ${ss.length} séances réalisées${q.convUrl ? ` · <a href="${esc(q.convUrl)}" target="_blank" rel="noopener">conversation ↗</a>` : ''}</li>`; }).join('')}</ul>`;
      }).join('');
    };
  }

  async function ensureHolidays(force) {
    const y = Number(S.settings.rentree.slice(0, 4)), year = `${y}-${y + 1}`;
    if (!force && S.settings.holidaysYear === year && S.settings.holidaysSource === 'en ligne') return;
    try {
      S.holidays = await PE.fetchHolidays(S.settings.zone, year);
      S.settings.holidaysSource = 'en ligne';
    } catch (e) {
      const fb = PE.FALLBACK_HOLIDAYS[year];
      if (fb && S.settings.zone === 'B') { S.holidays = fb.map(h => ({ ...h })); S.settings.holidaysSource = 'intégré (hors ligne)'; }
      else { if (force) toast('Impossible de charger les vacances. Réessayez avec une connexion.'); return; }
    }
    S.settings.holidaysYear = year; S.settings.holidaysLoadedAt = today();
    save();
    if (force) toast('Vacances mises à jour.');
  }

  function download(obj, name) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  // Texte brut d'un cours : séances (toutes classes / groupes), pour le calendrier et le cahier de textes
  const plainSeance = (s, cont) => `${numTxt(s)}${cont ? ' (suite)' : ''}`;
  function hourPlain(x) {
    const o = E.plan().occ[x.id];
    if (!o || !o.seanceId) return '';
    if (o.multi) return o.multi.map(m => { const s = seanceById(m.seanceId); return s ? `${classById(m.classId)?.short} : ${plainSeance(s, m.cont)}` : ''; }).filter(Boolean).join(' / ');
    if (o.split) return o.split.map(m => { const s = seanceById(m.seanceId); return s ? `${m.group} : ${plainSeance(s, m.cont)}` : ''; }).filter(Boolean).join(' / ');
    const s = seanceById(o.seanceId); return s ? plainSeance(s, o.cont) : '';
  }
  function blockPlain(b) {
    const typ = b.type === 'ap' ? 'AP ' : b.type === 'coint' ? 'Co-intervention ' : '';
    const what = [...new Set(b.hours.filter(x => x.counts && !(S.occ[x.id] && S.occ[x.id].cancelled)).map(hourPlain).filter(Boolean))].join(' ; ');
    return { title: `${typ}${blockNames(b) || b.label}${b.group ? ' ' + b.group : ''}`, what };
  }
  function exportIcs() {
    const z = s => s.replace(/[-:]/g, ''), escI = s => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pilotage pedagogique//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Cours'];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    let n = 0;
    for (let d = today(); d <= S.settings.finAnnee; d = addDays(d, 1)) {
      for (const b of E.blocksOn(d)) {
        if (b.blocked || b.hours.every(x => S.occ[x.id] && S.occ[x.id].cancelled)) continue;
        const { title, what } = blockPlain(b);
        lines.push('BEGIN:VEVENT', `UID:${b.id}@pilotage`, `DTSTAMP:${stamp}`, `DTSTART:${z(d)}T${z(b.start)}00`, `DTEND:${z(d)}T${z(b.end)}00`,
          `SUMMARY:${escI(what ? `${title} — ${what}` : title)}`, ...(b.note ? [`DESCRIPTION:${escI(b.note)}`] : []), 'END:VEVENT');
        n++;
      }
    }
    lines.push('END:VCALENDAR');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' })); a.download = `agenda-cours-${today()}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    toast(`${n} cours exportés dans le fichier calendrier.`);
  }
  function exportData() {
    S.settings.lastExport = today();
    persist();
    const { _rev, ...rest } = S;
    download({ app: 'pilotage-pedagogique', exportedAt: new Date().toISOString(), data: rest }, `pilotage-sauvegarde-${today()}.json`);
    render();
    toast('Sauvegarde exportée.');
  }

  /* ---------- Actions (clics) ---------- */
  const ACT = {
    tab: t => { UI.tab = t.dataset.tab; render(); scrollTo(0, 0); },
    goto: t => { UI.tab = t.dataset.tab; render(); const el = t.dataset.sec && document.getElementById(t.dataset.sec); if (el) el.scrollIntoView(); else scrollTo(0, 0); },
    view: t => { UI.view = t.dataset.v; render(); },
    step: t => stepDate(Number(t.dataset.n)),
    today: () => { UI.date = today(); UI.monthSel = UI.date; render(); },
    monthDay: t => { if (isPhone()) { UI.monthSel = t.dataset.d; render(); } else { UI.date = t.dataset.d; UI.view = 'day'; render(); } },
    yearSeq: t => { const q = seqById(t.dataset.id); UI.libClass = q.classId; UI.tab = 'bibliotheque'; render(); },
    copyProg: () => { const c = classById(UI.progClass); copy(P('progression', progressionVars(c)), 'Prompt de progression'); },
    iniReimport: () => { UI.iniReimport = true; UI.iniPreview = null; render(); },
    iniCancel: () => { UI.iniReimport = false; UI.iniPreview = null; render(); },
    iniParse: () => {
      const c = classById(UI.progClass), text = document.getElementById('iniText').value;
      const rows = IMP.parseCSV(text);
      if (IMP.looksLikeAgenda(rows)) return startAgendaImport(rows, 'texte collé');
      UI.iniPreview = { kind: 'text', classId: c.id, text, seqs: datePreview(c, parseProgression(text)) };
      render();
    },
    iniApply: () => {
      const c = classById(UI.progClass), pv = UI.iniPreview;
      if (!pv || pv.kind !== 'text' || pv.classId !== c.id) return;
      const oldSeqs = E.orderedSequences(c.id);
      const old = S.initial[c.id];
      const msg = (old ? `Remplacer la progression initiale figée le ${fmt(old.importedAt)} par cette nouvelle version ?\n` : `Figer cette progression comme référence pour ${c.short} ?\n`) +
        (oldSeqs.length ? `Les ${oldSeqs.length} séquence(s) de la bibliothèque seront remplacées (liens de conversation et séances « préparées » conservés quand les titres correspondent ; les cours déjà validés restent validés).` : '');
      if (!confirm(msg)) return;
      const oldSeances = new Map();
      for (const q of oldSeqs) for (const s of E.orderedSeancesOf(q.id)) oldSeances.set(norm(q.title) + '|' + norm(s.title), s);
      const seqIds = new Set(oldSeqs.map(q => q.id));
      S.seances = S.seances.filter(s => !seqIds.has(s.sequenceId));
      S.sequences = S.sequences.filter(q => q.classId !== c.id);
      pv.seqs.forEach((q, i) => {
        const prev = oldSeqs.find(o => norm(o.title) === norm(q.title));
        const nq = { id: prev && !S.sequences.some(x => x.id === prev.id) ? prev.id : uid(), classId: c.id, title: q.title, convUrl: prev ? prev.convUrl : '', order: i };
        S.sequences.push(nq);
        q.seances.forEach((s, j) => {
          const os = prev && oldSeances.get(norm(prev.title) + '|' + norm(s.title));
          S.seances.push({ id: os ? os.id : uid(), sequenceId: nq.id, title: s.title, kind: os ? os.kind : 'cours', prepared: os ? !!os.prepared : false, order: j });
        });
      });
      S.initial[c.id] = {
        importedAt: today(), text: pv.text, capacity: (E.plan().perClass[c.id] || {}).capacity || 0,
        sequences: pv.seqs.map(q => ({ title: q.title, hours: q.seances.length, start: q.start, end: q.end, seances: q.seances.map(s => ({ title: s.title, date: s.date })) })),
      };
      UI.iniPreview = null; UI.iniReimport = false;
      save(); toast('Progression figée et placée dans l\'agenda.');
    },
    agendaFile: () => document.getElementById('agendaFileInput').click(),
    agendaApply: () => {
      const pv = UI.iniPreview; if (!pv || pv.kind !== 'agenda') return;
      const names = Object.keys(pv.classes).map(id => classById(id).short);
      const already = Object.keys(pv.classes).filter(id => S.initial[id] || E.orderedSequences(id).length).map(id => classById(id).short);
      if (!confirm(`Figer la progression de ${names.join(', ')} d'après ce fichier ?` + (already.length ? `\nLa bibliothèque et la progression figée de ${already.join(', ')} seront remplacées (liens de conversation conservés quand les titres de séquence correspondent).` : ''))) return;
      applyAgenda(S, pv);
      persist();
      for (const cid of Object.keys(pv.classes)) S.initial[cid].capacity = (E.plan().perClass[cid] || {}).capacity || 0;
      UI.iniPreview = null; UI.iniReimport = false; UI.progSub = 'effective';
      save(); toast(`Progression importée pour ${names.join(', ')}.`);
    },
    gotoDay: t => { closeModal(); UI.tab = 'agenda'; UI.date = t.dataset.d; UI.view = 'day'; render(); scrollTo(0, 0); },
    threat: t => openModal(threatModal(t.dataset.id)),
    syncMenu: () => openModal(syncModal),
    syncNow: () => SY.pull(),
    exportIcs: () => exportIcs(),
    validateAll: () => {
      const ids = E.unvalidatedList(); if (!ids.length) return;
      const prev = Object.fromEntries(ids.map(id => [id, S.occ[id] ? { ...S.occ[id] } : null]));
      for (const id of ids) setOcc(id, r => { r.status = 'realisee'; });
      closeModal(); save();
      toast(`${ids.length} cours marqués réalisés.`, () => { for (const [id, r] of Object.entries(prev)) { if (r) S.occ[id] = r; else delete S.occ[id]; } save(); });
    },
    print: () => window.print(),
    pastAll: t => { UI.pastAll = t.dataset.id; UI.pastOpen = t.dataset.id; render(); },
    refreeze: () => {
      const c = classById(UI.progClass); if (!c) return;
      if (!confirm(`Figer la progression actuelle de ${c.short} comme nouvelle référence ?\nL'avance et le retard seront calculés à partir d'aujourd'hui, sur les dates actuelles.`)) return;
      const p = E.plan();
      const seqs = E.orderedSequences(c.id).map(q => {
        const se = E.orderedSeancesOf(q.id).filter(s => !s.skipped).map(s => ({ title: s.title, date: (p.seance[s.id] || {}).firstDate || null }));
        return { title: q.title, hours: se.length, start: se[0] ? se[0].date : null, end: se.length ? se[se.length - 1].date : null, seances: se };
      }).filter(q => q.seances.length);
      const ini = { importedAt: today(), source: 'progression en cours', capacity: (p.perClass[c.id] || {}).capacity || 0, sequences: seqs };
      ini.text = iniText(ini);
      S.initial[c.id] = ini; save(); toast('Progression figée comme nouvelle référence.');
    },
    libSearch: () => { UI.libQuery = (document.getElementById('libSearch').value || '').trim(); render(); },
    libSearchClear: () => { UI.libQuery = ''; render(); },
    copyCahier: t => {
      const [src, date] = t.dataset.id.split('@');
      const b = E.blocksOn(date).find(x => x.srcId === src); if (!b) return;
      const { title, what } = blockPlain(b);
      const hw = S.homework[b.id];
      copy([`${title} — ${fmtLong(date)}, ${hm(b.start)}–${hm(b.end)}`, what ? `Séance : ${what}` : '', b.note ? `Contenu : ${b.note}` : '', hw ? `Travail à faire : ${hw}` : ''].filter(Boolean).join('\n'), 'Texte du cahier de textes', 'Pronote');
    },
    markPrepared: t => { const s = seanceById(t.dataset.id); if (s) { s.prepared = true; save(); toast('Séance marquée préparée.'); } },
    forgotPwd: async () => {
      const email = (document.querySelector('form[data-form="login"] [name="email"]').value || '').trim();
      if (!email) { toast('Tapez d\'abord votre adresse e-mail.'); return; }
      try { await SY.resetPassword(email); toast('E-mail envoyé : ouvrez le lien qu\'il contient pour choisir un nouveau mot de passe.'); }
      catch (err) { toast('Envoi impossible : ' + err.message); }
    },
    restoreSnap: t => {
      const b = snapshots().find(x => x.id === t.dataset.id); if (!b) return;
      if (!confirm(`Revenir à la version du ${new Date(b.at).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })} ?\nLa version actuelle est gardée dans la liste, vous pourrez y revenir.`)) return;
      snapshot('avant retour à une version précédente', true);
      const arch = S.archives;
      S = migrate(clone(b.data)); S.archives = arch || [];
      persist(); render(); toast('Version restaurée.');
    },
    signOut: async () => { if (!confirm('Se déconnecter ? Les données restent sur cet appareil.')) return; await SY.signOut(); drawModal(); },
    makeUp: t => openModal(slotForm(null, true, { classIds: [t.dataset.cls], type: t.dataset.type || 'cours', start: t.dataset.s, end: t.dataset.e, date: today(), makeUpFor: t.dataset.h })),
    progClassEff: t => { UI.progSub = 'effective'; UI.progClass = t.dataset.id; render(); scrollTo(0, 0); },
    reorgFor: t => { const c = classById(t.dataset.id); closeModal(); UI.tab = 'progression'; UI.progSub = 'effective'; UI.progClass = c.id; UI.reorg = { classId: c.id, ...reorgCandidates(c, E.compare(c.id)) }; render(); },
    switchWeek: () => { const cur = E.weekType(UI.date); let d = addDays(mondayOf(UI.date), 7); for (let i = 0; i < 12 && E.weekType(d) === cur; i++) d = addDays(d, 7); UI.date = d; render(); },
    forceWeek: () => openModal(forceWeekModal),
    setWeek: t => {
      const m = mondayOf(UI.date);
      S.settings.weekAnchors = (S.settings.weekAnchors || []).filter(a => mondayOf(a.monday) !== m).concat({ monday: m, type: Number(t.dataset.t) });
      closeModal(); save(); toast(`Semaine du ${fmt(m)} : Q${t.dataset.t}.`);
    },
    addAnchor: () => {
      const d = document.getElementById('anchorDate').value; if (!d) return;
      const m = mondayOf(d), type = Number(document.getElementById('anchorType').value);
      S.settings.weekAnchors = (S.settings.weekAnchors || []).filter(a => mondayOf(a.monday) !== m).concat({ monday: m, type });
      save();
    },
    delAnchor: t => { S.settings.weekAnchors = S.settings.weekAnchors.filter(a => mondayOf(a.monday) !== t.dataset.m); save(); },
    unvalidated: () => openModal(unvalidatedModal),
    validate: t => setStatus(t.dataset.h, t.dataset.s || null),
    hourMenu: t => openModal(hourModal(t.dataset.h)),
    block: t => openModal(blockModal(t.dataset.id)),
    cancelHours: t => setCancelled(t.dataset.ids.split(','), t.dataset.v === '1'),
    toggleCounts: t => {
      const info = hourInfo(t.dataset.h); if (!info) return;
      const def = info.hour.defaultCounts, cur = info.hour.counts;
      setOcc(t.dataset.h, r => { if (!cur === def) delete r.counts; else r.counts = !cur; delete r.imp; if (cur) { delete r.status; delete r.reserved; } });
      save();
      if (info.block.type === 'ap') toast(cur ? `Heure rendue à l'AP (${fmt(info.date)}) : la progression recule d'une heure.` : `AP du ${fmt(info.date)} transformée en heure de maths : la suite de la progression avance d'une heure.`);
    },
    toggleReserved: t => { setOcc(t.dataset.h, r => { if (r.reserved) delete r.reserved; else { r.reserved = true; delete r.status; } delete r.imp; }); save(); },
    delExtra: t => { if (!confirm('Supprimer ce cours ponctuel ?')) return; S.extras = S.extras.filter(x => x.id !== t.dataset.id); closeModal(); save(); },
    closeModal: () => closeModal(),
    undo: () => { const f = undoFn; undoFn = null; document.getElementById('toast').hidden = true; if (f) f(); },
    export: () => exportData(),
    snooze: () => { S.settings.reminderSnooze = addDays(today(), 7); save(); },
    import: () => document.getElementById('importFile').click(),
    loadDepart: () => {
      if (!confirm('Remplacer les données actuelles par les données de départ du 8 nov. 2026 (emploi du temps, calendrier, progressions 2MV et CAP1) ? Les validations faites depuis seront perdues.')) return;
      S = fromDepart(); applyPatches(); persist(); render(); toast('Données de départ chargées.');
    },
    reset: () => {
      if (!confirm('Effacer toutes les données de ce navigateur ? Exportez d\'abord une sauvegarde si besoin.')) return;
      if (!confirm('Confirmer : tout effacer définitivement ?')) return;
      snapshot('avant effacement', true);
      S = migrate(defaultState()); persist(); render(); toast('Données effacées.');
    },

    openSeance: t => { const s = seanceById(t.dataset.id); if (!s) return; const q = seqById(s.sequenceId); UI.libClass = q.classId; if (UI.tab === 'agenda') UI.tab = 'bibliotheque'; render(); openModal(seanceModal(s.id)); },
    libClass: t => { UI.libClass = t.dataset.id; render(); },
    progClass: t => { UI.progClass = t.dataset.id; if (UI.iniPreview && UI.iniPreview.kind === 'text') UI.iniPreview = null; render(); },
    progSub: t => { UI.progSub = t.dataset.v; render(); },
    addSeq: () => {
      const title = prompt('Titre de la séquence :'); if (!title || !title.trim()) return;
      const sib = E.orderedSequences(UI.libClass);
      S.sequences.push({ id: uid(), classId: UI.libClass, title: title.trim(), convUrl: '', order: sib.length });
      save();
    },
    renSeq: t => { const q = seqById(t.dataset.id); const v = prompt('Titre de la séquence :', q.title); if (v && v.trim()) { q.title = v.trim(); save(); } },
    moveSeq: t => { const q = seqById(t.dataset.id); if (move(S.sequences.filter(x => x.classId === q.classId), q.id, Number(t.dataset.d))) save(); },
    delSeq: t => {
      const q = seqById(t.dataset.id); const n = S.seances.filter(s => s.sequenceId === q.id).length;
      if (!confirm(`Supprimer la séquence « ${q.title} » et ses ${n} séance(s) ?`)) return;
      S.seances = S.seances.filter(s => s.sequenceId !== q.id); S.sequences = S.sequences.filter(x => x.id !== q.id);
      S.evaluations = S.evaluations.filter(x => x.sequenceId !== q.id); S.exercises = S.exercises.filter(x => x.sequenceId !== q.id);
      save();
    },
    editConv: t => {
      const q = seqById(t.dataset.id);
      const v = prompt('Lien de la conversation Claude de cette séquence :', q.convUrl || 'https://claude.ai/chat/');
      if (v == null) return;
      const url = v.trim();
      if (url && !/^https:\/\//i.test(url)) { toast('Le lien doit commencer par https://'); return; }
      q.convUrl = url === 'https://claude.ai/chat/' ? '' : url; save();
    },
    copyStart: t => { const q = seqById(t.dataset.id); copy(P('demarrage', seqVars(q)), 'Prompt de démarrage'); },
    copyNotions: t => { const q = seqById(t.dataset.id); copy(P('notions', seqVars(q)), 'Prompt des notions'); },
    copyComp: t => { const q = seqById(t.dataset.id); copy(P('competences', seqVars(q)), 'Prompt des compétences'); },
    addSeance: t => {
      const title = prompt('Titre de la séance :'); if (!title || !title.trim()) return;
      S.seances.push({ id: uid(), sequenceId: t.dataset.id, title: title.trim(), kind: 'cours', prepared: false, order: E.orderedSeancesOf(t.dataset.id).length });
      save();
    },
    copySeance: t => {
      const s = seanceById(t.dataset.id), q = seqById(s.sequenceId), prev = prevSeances(s);
      copy(P('seance', { ...seqVars(q), seance_num: seanceNum(s), seance: s.title, seances_precedentes: prev.length ? prev.map(p => `${p.num}. ${p.title}${p.done ? ' (réalisée)' : ''}`).join('\n') : 'aucune (première séance de la séquence)' }), 'Prompt de la séance');
    },
    copyCorrige: t => { const s = seanceById(t.dataset.id), q = seqById(s.sequenceId); copy(P('corrige', { ...seqVars(q), seance_num: seanceNum(s), seance: s.title }), 'Prompt du corrigé'); },
    moveSeance: t => { const s = seanceById(t.dataset.id); if (move(S.seances.filter(x => x.sequenceId === s.sequenceId), s.id, Number(t.dataset.d))) save(); },
    doneSeance: t => toggleDone(t.dataset.id),
    skipSeance: t => { const s = seanceById(t.dataset.id); s.skipped = !s.skipped; if (!s.skipped) delete s.skipped; save(); },
    delSeance: t => { const s = seanceById(t.dataset.id); if (!confirm(`Supprimer la séance « ${s.title} » ?`)) return; S.seances = S.seances.filter(x => x.id !== s.id); closeModal(); save(); },
    evalForm: t => openModal(evalForm(t.dataset.id, t.dataset.seq)),
    delEval: t => { if (!confirm('Supprimer cette évaluation ?')) return; S.evaluations = S.evaluations.filter(x => x.id !== t.dataset.id); closeModal(); save(); },
    exoForm: t => openModal(exoForm(t.dataset.seq)),
    quizForm: t => openModal(exoForm(t.dataset.seq, true)),
    delQuiz: t => { if (!confirm('Supprimer ce quiz de la liste ?')) return; S.quizzes = S.quizzes.filter(x => x.id !== t.dataset.id); save(); },
    delExo: t => { if (!confirm('Supprimer cette série de la liste ?')) return; S.exercises = S.exercises.filter(x => x.id !== t.dataset.id); save(); },
    bulk: () => openModal(bulkModal),
    bulkGo: () => {
      const parsed = parseBulk(document.getElementById('bulkText').value);
      if (!parsed.length) { toast('Rien à ajouter.'); return; }
      let order = E.orderedSequences(UI.libClass).length, n = 0;
      for (const p of parsed) {
        const q = { id: uid(), classId: UI.libClass, title: p.title, convUrl: '', order: order++ };
        S.sequences.push(q);
        p.seances.forEach((t, i) => { S.seances.push({ id: uid(), sequenceId: q.id, title: t, kind: 'cours', prepared: false, order: i }); n++; });
      }
      closeModal(); save(); toast(`${parsed.length} séquence(s), ${n} séance(s) ajoutées.`);
    },
    reorg: () => { const c = classById(UI.progClass); UI.reorg = { classId: c.id, ...reorgCandidates(c, E.compare(c.id)) }; render(); },
    reorgClose: () => { UI.reorg = null; render(); },
    reorgApply: () => {
      const r = UI.reorg; if (!r || !r.items.some(x => x.on)) { toast('Rien de coché.'); return; }
      applyReorg(S, r.items); UI.reorg = null; save(); toast('Réorganisation appliquée.');
    },

    addClass: () => { S.classes.push({ id: uid(), short: 'Nouvelle classe', classe: '', matiere: 'Mathématiques', projectUrl: '', startDate: '' }); save(); },
    delClass: t => {
      const c = classById(t.dataset.id);
      const seqIds = S.sequences.filter(q => q.classId === c.id).map(q => q.id);
      if (!confirm(`Supprimer la classe ${c.short}, ses séquences, ses séances et ses créneaux ?`)) return;
      S.seances = S.seances.filter(s => !seqIds.includes(s.sequenceId));
      S.sequences = S.sequences.filter(q => q.classId !== c.id);
      for (const list of [S.slots, S.extras]) for (const s of list) s.classIds = s.classIds.filter(id => id !== c.id);
      S.slots = S.slots.filter(s => s.classIds.length || s.type === 'hors' || s.classLabel);
      S.extras = S.extras.filter(s => s.classIds.length || s.type === 'hors');
      delete S.initial[c.id];
      S.classes = S.classes.filter(x => x.id !== c.id); save();
    },
    copyImport: () => copy(P('importEdt', { classes: S.classes.map(c => `  - ${c.short} = ${c.classe}, ${c.matiere}`).join('\n') }), "Prompt d'import"),
    copyEdtText: () => copy(edtToText(), 'Emploi du temps'),
    parseEdt: () => { UI.edtPreview = parseEdt(document.getElementById('edtText').value); render(); document.getElementById('sec-edt').scrollIntoView(); },
    pvDel: t => { UI.edtPreview.splice(Number(t.dataset.i), 1); render(); },
    pvCancel: () => { UI.edtPreview = null; render(); },
    pvApply: t => {
      const bad = UI.edtPreview.filter(r => r.warn && r.type === 'cours' && !r.classIds.length);
      if (bad.length && !confirm(`${bad.length} cours sans classe reconnue seront enregistrés sans classe. Continuer ?`)) return;
      const rows = UI.edtPreview.map(r => fixSlot({
        id: uid(), day: r.day, start: r.start, end: r.end, type: r.type, classIds: r.classIds, classLabel: r.classLabel,
        group: r.group, weeks: r.weeks, semester: r.semester, colleague: r.colleague, label: r.type === 'hors' ? (r.label || 'Hors progression') : r.label,
      }));
      if (t.dataset.mode === 'replace') {
        const validated = Object.values(S.occ).filter(o => o.status).length;
        if (S.slots.length && !confirm(`Remplacer les ${S.slots.length} créneaux actuels${validated ? ` (les ${validated} validations déjà faites seront perdues)` : ''} ?`)) return;
        S.slots = rows;
        const keep = new Set(S.extras.map(x => x.id));
        for (const k of Object.keys(S.occ)) if (!keep.has(k.split('@')[0])) delete S.occ[k];
        for (const k of Object.keys(S.notes)) if (!keep.has(k.split('@')[0])) delete S.notes[k];
      } else S.slots.push(...rows);
      UI.edtPreview = null; save(); toast(`${rows.length} créneau(x) enregistré(s).`);
    },
    slotForm: t => openModal(slotForm(t.dataset.id, false)),
    extraForm: () => openModal(slotForm(null, true)),
    delSlot: t => { if (!confirm('Supprimer ce créneau ?')) return; S.slots = S.slots.filter(s => s.id !== t.dataset.id); save(); },
    eventForm: t => openModal(eventForm(t.dataset.id)),
    delEvent: t => { if (!confirm('Supprimer cette période ?')) return; S.events = S.events.filter(x => x.id !== t.dataset.id); save(); },
    reloadHolidays: () => ensureHolidays(true),
    markDone: () => {
      const date = document.getElementById('doneUntil').value, cls = document.getElementById('doneClass').value;
      if (!date) return;
      const ids = Object.entries(E.plan().occ).filter(([id, o]) => o.seanceId && !o.status && (!cls || o.classId === cls) && id.split('@')[1].split('#')[0] <= date).map(([id]) => id);
      if (!ids.length) { toast('Aucune séance à marquer.'); return; }
      if (!confirm(`Marquer ${ids.length} heure(s) de cours comme réalisées jusqu'au ${fmt(date)} ?`)) return;
      for (const id of ids) S.occ[id] = { ...(S.occ[id] || {}), status: 'realisee' };
      save(); toast(`${ids.length} heure(s) marquées comme réalisées.`);
    },
    tplReset: t => { if (!confirm('Rétablir le modèle d\'origine ?')) return; delete S.prompts[t.dataset.k]; save(); },
    archiveYear: () => {
      const st = S.settings, yl = `${st.rentree.slice(0, 4)}-${st.finAnnee.slice(0, 4)}`;
      const keepEdt = document.getElementById('keepEdt').checked;
      if (!confirm(`Archiver l'année ${yl} et repartir avec les mêmes classes ?\nL'année archivée reste consultable et exportable dans Réglages.`)) return;
      const { _rev, archives, ...rest } = S;
      const arch = { id: uid(), label: yl, archivedAt: today(), data: clone(rest) };
      const next = migrate(defaultState());
      next.archives = [...(S.archives || []), arch];
      next.classes = S.classes.map(c => ({ ...c, startDate: '' }));
      next.prompts = S.prompts;
      if (keepEdt) next.slots = clone(S.slots);
      // Reprendre les séquences et les séances (avec liens vers les fiches et remarques), sans les validations
      if (document.getElementById('keepProg').checked) {
        next.sequences = S.sequences.map(q => ({ ...q, convUrl: '' }));
        next.seances = S.seances.map(s => { const { corrected, graded, skipped, ...rest2 } = s; return { ...rest2, prepared: false }; });
      }
      snapshot('avant archivage de l\'année', true);
      next.settings = { ...next.settings, rentree: addYear(st.rentree), finAnnee: addYear(st.finAnnee), s2Start: addYear(st.s2Start), zone: st.zone, skipVacations: st.skipVacations, holidaysYear: '', holidaysSource: '', lastExport: st.lastExport, patches: st.patches || [], autoDone: !!st.autoDone };
      next.settings.weekAnchors = [{ monday: mondayOf(next.settings.rentree), type: 1 }];
      next.holidays = PE.FALLBACK_HOLIDAYS[`${next.settings.rentree.slice(0, 4)}-${next.settings.finAnnee.slice(0, 4)}`] || [];
      S = next; persist(); render(); ensureHolidays(true);
      toast(`Année ${yl} archivée. Pensez à vérifier la rentrée et les semaines Q1 / Q2.`);
    },
    viewArchive: t => openModal(archiveModal(t.dataset.id)),
    exportArchive: t => { const a = S.archives.find(x => x.id === t.dataset.id); download({ app: 'pilotage-pedagogique', exportedAt: new Date().toISOString(), archive: a.label, data: a.data }, `pilotage-archive-${a.label}.json`); },
    delArchive: t => { const a = S.archives.find(x => x.id === t.dataset.id); if (!confirm(`Supprimer définitivement l'archive ${a.label} ? Exportez-la d'abord si besoin.`)) return; S.archives = S.archives.filter(x => x.id !== a.id); save(); },
  };

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-a]');
    if (!t) { if (e.target.id === 'modal') closeModal(); return; }
    const fn = ACT[t.dataset.a];
    if (fn) { e.preventDefault(); fn(t, e); }
  });

  /* ---------- Changements de champs ---------- */
  const CHG = {
    cls: t => { const c = classById(t.dataset.id); c[t.dataset.f] = t.value.trim(); if (t.dataset.f === 'startDate') save(); else commit(); },
    set: t => { S.settings[t.dataset.f] = t.value; save(); },
    setBool: t => { S.settings[t.dataset.f] = t.checked; save(); },
    setCal: t => {
      if (!t.value) return;
      const f = t.dataset.f; const yearChanged = f === 'rentree' && t.value.slice(0, 4) !== S.settings.rentree.slice(0, 4);
      S.settings[f] = t.value; save();
      if (yearChanged || f === 'zone') ensureHolidays(true);
    },
    prepared: t => { seanceById(t.dataset.id).prepared = t.checked; save(); },
    seanceTitle: t => { const v = t.value.trim(); if (v) { seanceById(t.dataset.id).title = v; commit(); render(); } },
    seanceKind: t => { seanceById(t.dataset.id).kind = t.value; save(); },
    evalFlag: t => { const s = seanceById(t.dataset.id); if (s) { s[t.dataset.f] = t.checked; save(); } },
    hstatus: t => {
      const v = t.value;
      setOcc(t.dataset.h, r => { delete r.status; delete r.cancelled; delete r.moved; if (v === 'annule') r.cancelled = true; else if (v) r.status = v; });
      save();
    },
    seanceField: t => {
      const s = seanceById(t.dataset.id); if (!s) return;
      const v = t.value.trim();
      if (t.dataset.f === 'docUrl' && v && !/^https?:\/\//i.test(v)) { toast('Le lien doit commencer par https://'); return; }
      if (v) s[t.dataset.f] = v; else delete s[t.dataset.f];
      save();
    },
    homework: t => { const v = t.value.trim(); if (v) S.homework[t.dataset.id] = v; else delete S.homework[t.dataset.id]; commit(); },
    pin: t => { setOcc(t.dataset.h, r => { if (t.value) r.pin = t.value; else delete r.pin; }); save(); toast(t.value ? 'Séance fixée sur ce cours ; le reste de la progression suit son ordre.' : 'Retour à l\'ordre de la progression.'); },
    note: t => { const v = t.value.trim(); if (v) S.notes[t.dataset.id] = v; else delete S.notes[t.dataset.id]; save(); },
    pv: t => {
      const r = UI.edtPreview[Number(t.dataset.i)]; const f = t.dataset.f;
      if (f === 'classId') { r.classIds = t.value ? [t.value] : []; r.classLabel = ''; r.warn = ''; }
      else r[f] = f === 'day' ? Number(t.value) : t.value;
    },
    agendaCancel: t => { const pv = UI.iniPreview; pv.cancelExtra[t.dataset.id] = t.checked; pv.check = agendaCheck(pv); render(); },
    reorgItem: t => { UI.reorg.items[Number(t.dataset.i)].on = t.checked; render(); },
    tplSel: t => { UI.tplKey = t.value; render(); document.getElementById('sec-prompts').scrollIntoView(); },
    tplText: t => { const k = t.dataset.k; if (t.value.trim() === PROMPTS.TEMPLATES[k].text.trim() || !t.value.trim()) delete S.prompts[k]; else S.prompts[k] = t.value; save(); toast('Modèle enregistré.'); },
  };
  document.addEventListener('change', e => {
    if (e.target.id === 'importFile') return importFile(e.target);
    if (e.target.id === 'agendaFileInput') return agendaFileChosen(e.target);
    const t = e.target.closest('[data-c]'); if (t && CHG[t.dataset.c]) CHG[t.dataset.c](t);
  });

  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const fd = new FormData(f), kind = f.dataset.form, id = f.dataset.id;
    if (kind === 'slot' || kind === 'extra') {
      const v = {
        start: fd.get('start'), end: fd.get('end'), type: fd.get('type'), classIds: fd.getAll('cls'), classLabel: (fd.get('classLabel') || '').trim(),
        group: (fd.get('group') || '').trim(), colleague: (fd.get('colleague') || '').trim(), label: (fd.get('label') || '').trim(),
      };
      if (toMin(v.end) <= toMin(v.start)) { toast("L'heure de fin doit être après le début."); return; }
      if (v.type === 'hors' && !v.label) v.label = 'Hors progression';
      const cm = fd.get('countsMode');
      v.counts = cm === 'yes' ? true : cm === 'no' ? false : undefined;
      if (kind === 'slot') { v.day = Number(fd.get('day')); v.weeks = fd.get('weeks'); v.semester = fd.get('semester') || ''; }
      else { v.date = fd.get('date'); if (fd.get('makeUpFor')) v.makeUpFor = fd.get('makeUpFor'); }
      const list = kind === 'slot' ? S.slots : S.extras;
      const cur = id && list.find(x => x.id === id);
      if (cur) { Object.assign(cur, v); if (v.counts === undefined) delete cur.counts; }
      else { const n = fixSlot({ id: uid(), ...v }); if (v.counts === undefined) delete n.counts; list.push(n); }
    } else if (kind === 'move') {
      const [src, date] = id.split('@');
      const b = E.blocksOn(date).find(x => x.srcId === src); if (!b) return;
      const v = { date: fd.get('date'), start: fd.get('start'), end: fd.get('end') };
      if (toMin(v.end) <= toMin(v.start)) { toast("L'heure de fin doit être après le début."); return; }
      for (const x of b.hours) setOcc(x.id, r => { r.cancelled = true; r.moved = v.date; delete r.status; });
      const nid = uid();
      S.extras.push(fixSlot({ id: nid, ...v, type: b.type, classIds: b.classIds.slice(), classLabel: b.classLabel, group: b.group, colleague: b.colleague, label: b.label, ...(b.counts !== (b.type === 'cours') ? { counts: b.counts } : {}) }));
      if (b.note) S.notes[`${nid}@${v.date}`] = b.note;
      closeModal(); save(); toast(`Cours déplacé au ${fmt(v.date)}.`);
      return;
    } else if (kind === 'event') {
      const v = { type: fd.get('type'), label: (fd.get('label') || '').trim(), start: fd.get('start'), end: fd.get('end'), classIds: fd.getAll('cls'), noClass: fd.get('noClass') === 'on',
        startTime: fd.get('startTime') || '', endTime: fd.get('endTime') || '', keepCoint: fd.get('keepCoint') === 'on', makeUp: fd.get('makeUp') === 'on' };
      if (v.end < v.start) { toast('La date de fin doit être après le début.'); return; }
      if (!!v.startTime !== !!v.endTime || (v.startTime && toMin(v.endTime) <= toMin(v.startTime))) { toast('Indiquez les deux heures (début avant fin), ou aucune.'); return; }
      if (!v.label) v.label = EVENT_TYPES[v.type];
      const cur = id && S.events.find(x => x.id === id);
      if (cur) Object.assign(cur, v); else S.events.push({ id: uid(), ...v });
    } else if (kind === 'login') {
      const email = (fd.get('email') || '').trim(), password = fd.get('password') || '';
      const up = e.submitter && e.submitter.value === 'up';
      (async () => {
        try {
          if (up) { const ok = await SY.signUp(email, password); if (!ok) { toast('Compte créé : confirmez avec le lien reçu par e-mail, puis connectez-vous.'); return; } }
          else await SY.signIn(email, password);
          closeModal(); toast('Connecté.');
        } catch (err) { toast(/invalid login/i.test(err.message) ? 'Adresse ou mot de passe incorrect.' : 'Connexion impossible : ' + err.message); }
      })();
      return;
    } else if (kind === 'libSearch') {
      UI.libQuery = (document.getElementById('libSearch').value || '').trim(); render(); return;
    } else if (kind === 'newpwd') {
      (async () => {
        try { await SY.updatePassword(fd.get('password') || ''); closeModal(); toast('Mot de passe modifié.'); }
        catch (err) { toast('Impossible de changer le mot de passe : ' + err.message); }
      })();
      return;
    } else if (kind === 'eval') {
      const v = { sequenceId: f.dataset.seq, type: fd.get('type') || 'fin', duration: (fd.get('duration') || '').trim() || '1 h', seanceIds: fd.getAll('sea'), date: fd.get('date') || '' };
      let ev = id && S.evaluations.find(x => x.id === id);
      if (ev) Object.assign(ev, v); else { ev = { id: uid(), ...v }; S.evaluations.push(ev); }
      if (e.submitter && e.submitter.value === 'copy') {
        const q = seqById(ev.sequenceId);
        copy(P('evaluation', { ...seqVars(q), type_eval: ev.type === 'fin' ? 'de fin de séquence' : 'partielle', duree: ev.duration, seances_concernees: seanceListText(ev.seanceIds) || 'toute la séquence' }), "Prompt de l'évaluation");
      }
    } else if (kind === 'exo') {
      const q = seqById(f.dataset.seq), ids = fd.getAll('sea');
      const n = S.exercises.filter(x => x.sequenceId === q.id).length + 1;
      const expert = e.submitter && e.submitter.value === 'expert';
      S.exercises.push({ id: uid(), sequenceId: q.id, createdAt: today(), seanceIds: ids, level: expert ? 'expert' : 'normal' });
      copy(P(expert ? 'exercicesExpert' : 'exercices', { ...seqVars(q), serie_num: n, seances_concernees: seanceListText(ids) || 'toute la séquence' }), expert ? "Prompt d'exercices niveau expert" : "Prompt d'exercices");
    } else if (kind === 'quiz') {
      const q = seqById(f.dataset.seq), ids = fd.getAll('sea'), duree = (fd.get('duration') || '').trim() || '1 h';
      const n = S.quizzes.filter(x => x.sequenceId === q.id).length + 1;
      S.quizzes.push({ id: uid(), sequenceId: q.id, createdAt: today(), seanceIds: ids, duration: duree });
      copy(P('quiz', { ...seqVars(q), quiz_num: n, duree, seances_concernees: seanceListText(ids) || 'toute la séquence' }), 'Prompt du quiz');
    }
    closeModal(); save();
  });

  function importFile(input) {
    const file = input.files && input.files[0]; input.value = '';
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        const data = j && j.data && j.app === 'pilotage-pedagogique' ? j.data : null;
        if (!data || !Array.isArray(data.classes)) throw new Error('format');
        if (!confirm(`Restaurer la sauvegarde du ${j.exportedAt ? new Date(j.exportedAt).toLocaleDateString('fr-FR') : '?'} ? Les données actuelles seront remplacées.`)) return;
        snapshot('avant restauration d\'un fichier', true);
        S = migrate(data); persist(); render(); toast('Sauvegarde restaurée.');
      } catch (e) { toast("Ce fichier n'est pas une sauvegarde valide."); }
    };
    r.readAsText(file);
  }
  async function agendaFileChosen(input) {
    const file = input.files && input.files[0]; input.value = '';
    if (!file) return;
    try { startAgendaImport(await IMP.readFile(file), file.name); }
    catch (e) { toast('Fichier illisible : ' + e.message); }
  }

  /* ---------- Glissement (vue jour / semaine) ---------- */
  let tx = null, ty = null;
  const view = document.getElementById('view');
  view.addEventListener('touchstart', e => { if (UI.tab !== 'agenda' || !e.target.closest('#swipe')) return; tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  view.addEventListener('touchend', e => {
    if (tx == null) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) stepDate(dx < 0 ? 1 : -1);
  });
  document.addEventListener('toggle', e => {
    if (e.target.dataset && e.target.dataset.past) UI.pastOpen = e.target.open ? e.target.dataset.past : null;
    if (e.target.id === 'dash') try { localStorage.setItem('pedago.ui.dash', e.target.open ? '1' : '0'); } catch (_) { /* ignore */ }
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalFn) closeModal(); });
  let rz = null;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (isPhone() !== lastPhone && UI.tab === 'agenda') render(); }, 200); });

  // Rafraîchit l'affichage des cours « à valider » au fil de la journée
  setInterval(() => { S._rev++; if (!modalFn && UI.tab === 'agenda') render(); else renderTabs(); }, 5 * 60 * 1000);

  render();
  renderSyncBtn();
  SY.start();
  ensureHolidays(false);
})();
