/* Synchronisation en ligne (Supabase) : une ligne par compte, avec toutes les données de l'application.
   - à la connexion et quand l'application revient au premier plan : on récupère la version en ligne ;
   - après chaque modification : on envoie la version de l'appareil (quelques secondes après).
   Sans configuration ou sans réseau, l'application marche comme avant, sur l'appareil seul. */
(function (global) {
  'use strict';
  const META = 'pedago.sync';
  const cfg = global.PILOTAGE_CONFIG || {};
  const readMeta = () => { try { return JSON.parse(localStorage.getItem(META)) || {}; } catch (e) { return {}; } };
  const writeMeta = m => { try { localStorage.setItem(META, JSON.stringify(m)); } catch (e) { /* ignore */ } };

  function Sync(hooks) {
    // hooks : getData(), setData(data), isEmpty(), onStatus(), ask(question) → bool
    const enabled = !!(cfg.supabaseUrl && cfg.supabaseKey && global.supabase && global.supabase.createClient);
    const client = enabled ? global.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
    let user = null, status = enabled ? 'deconnecte' : 'local', timer = null, busy = false, lastError = '';
    const set = (s, err) => { status = s; lastError = err || ''; hooks.onStatus(); };

    async function pull() {
      if (!client || !user || busy) return;
      busy = true; set('envoi');
      try {
        const { data, error } = await client.from('pilotage').select('data, updated_at').eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        const meta = readMeta();
        if (!data) { busy = false; return push(true); }                       // rien en ligne : premier envoi
        const remoteNewer = data.updated_at !== meta.syncedAt;
        if (!remoteNewer) { busy = false; if (meta.dirty) return push(); set('ok'); return; }
        let take = true;
        if (meta.dirty && !hooks.isEmpty()) {
          take = hooks.ask(meta.syncedAt
            ? 'Vos données ont changé sur cet appareil ET sur un autre appareil.\n\nOK : prendre la version en ligne (les changements de cet appareil sont perdus).\nAnnuler : garder la version de cet appareil et l\'envoyer en ligne.'
            : 'Des données existent déjà en ligne pour ce compte.\n\nOK : les récupérer sur cet appareil (les données actuelles de cet appareil sont remplacées).\nAnnuler : remplacer la version en ligne par celle de cet appareil.');
        }
        if (take) {
          hooks.setData(data.data);
          writeMeta({ ...meta, syncedAt: data.updated_at, dirty: false });
          busy = false; set('ok');
        } else { busy = false; return push(true); }
      } catch (e) { busy = false; set('erreur', e.message || String(e)); }
    }
    async function push(force) {
      if (!client || !user) return;
      if (busy && !force) { schedule(); return; }
      busy = true; set('envoi');
      try {
        const now = new Date().toISOString();
        const { error } = await client.from('pilotage').upsert({ user_id: user.id, data: hooks.getData(), updated_at: now });
        if (error) throw error;
        writeMeta({ ...readMeta(), syncedAt: now, dirty: false });
        busy = false; set('ok');
      } catch (e) { busy = false; set('erreur', e.message || String(e)); }
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(() => push(), 2500); }
    // À appeler après chaque enregistrement local
    function changed() {
      writeMeta({ ...readMeta(), dirty: true });
      if (user) { set('attente'); schedule(); }
    }

    async function start() {
      if (!client) return;
      const { data } = await client.auth.getSession();
      user = data && data.session ? data.session.user : null;
      set(user ? 'ok' : 'deconnecte');
      if (user) pull();
      client.auth.onAuthStateChange((ev, session) => {
        const was = user && user.id;
        user = session ? session.user : null;
        if (!user) set('deconnecte');
        else if (user.id !== was) pull();
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
      addEventListener('online', () => pull());
    }
    async function signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    async function signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      return !!(data && data.session); // false : il faut confirmer l'adresse e-mail
    }
    async function signOut() { await client.auth.signOut(); writeMeta({}); set('deconnecte'); }

    return {
      enabled, start, changed, pull, push: () => push(true), signIn, signUp, signOut,
      get status() { return status; }, get user() { return user; }, get error() { return lastError; },
    };
  }
  global.PSync = Sync;
})(window);
