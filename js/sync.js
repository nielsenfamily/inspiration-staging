/* Sign-in and syncing with Supabase.
   Work is saved on the device first; this file sends queued changes up and pulls changes down.
   If the same item was changed somewhere else, this device's version wins and the other
   version is kept in the document's History, so nothing is lost. */
(function () {
  const C = window.APP_CONFIG;
  const COLUMNS = {
    projects: ['id', 'user_id', 'title', 'subtitle', 'kind', 'status', 'word_goal', 'color', 'notes', 'sort_order', 'archived_at', 'created_at', 'rev'],
    nodes: ['id', 'user_id', 'project_id', 'parent_id', 'kind', 'title', 'synopsis', 'notes', 'label', 'content', 'plain', 'word_count', 'sort_order', 'archived_at', 'created_at', 'rev'],
    snapshots: ['id', 'user_id', 'node_id', 'project_id', 'name', 'reason', 'content', 'word_count', 'created_at', 'rev'],
    writing_log: ['id', 'user_id', 'day', 'device', 'words', 'minutes', 'created_at', 'rev'],
    suggestions: ['id', 'user_id', 'body', 'status', 'reply', 'archived_at', 'created_at', 'rev'],
    settings: ['id', 'user_id', 'prefs', 'last_backup_at', 'created_at', 'rev']
  };
  const TABLES = Object.keys(COLUMNS);

  let sb = null;
  let status = 'local';
  let pushTimer = null;
  let pushing = false;
  let pulling = false;
  const statusListeners = new Set();

  function setStatus(s, detail) {
    status = s;
    statusListeners.forEach(fn => fn(s, detail));
  }

  function payloadFor(table, rec) {
    const out = {};
    COLUMNS[table].forEach(k => { if (rec[k] !== undefined) out[k] = rec[k]; });
    return out;
  }

  const Sync = {
    get configured() { return !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY); },
    get status() { return status; },
    onStatus(fn) { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); },
    user: null,

    async init() {
      if (!Sync.configured) {
        Data.userId = 'local';
        setStatus('local');
        return { needLogin: false };
      }
      sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'inspiration-auth' }
      });
      let session = null;
      try { session = (await sb.auth.getSession()).data.session; } catch (e) { /* offline */ }
      const lastUser = await DB.meta.get('lastUser');

      sb.auth.onAuthStateChange((event, s) => {
        if (event === 'PASSWORD_RECOVERY') setTimeout(() => window.App && App.openNewPassword(), 300);
        if (s && s.user) {
          Sync.user = s.user;
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') Sync.kick();
        } else if (event === 'SIGNED_OUT') {
          Sync.user = null;
          setStatus('signed-out');
        }
      });

      window.addEventListener('online', () => Sync.kick());
      window.addEventListener('offline', () => setStatus('offline'));
      document.addEventListener('visibilitychange', () => { if (!document.hidden) Sync.pull(); });
      setInterval(() => Sync.pull(), 60000);

      if (session) {
        await Sync._setUser(session.user);
        Sync.kick();
        return { needLogin: false };
      }
      if (lastUser) {
        // Previously signed in on this device: open the work, sync once signed in again
        Data.userId = lastUser.id;
        setStatus(navigator.onLine ? 'signed-out' : 'offline');
        return { needLogin: false };
      }
      return { needLogin: true };
    },

    async _setUser(user) {
      Sync.user = user;
      Data.userId = user.id;
      await DB.meta.set('lastUser', { id: user.id, email: user.email });
    },

    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await Sync._setUser(data.user);
      await Sync.pull();
      Sync.schedulePush(0);
      return data.user;
    },

    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
    },

    async updatePassword(pw) {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
    },

    async pendingCount() { return (await DB.all('outbox')).length; },

    async signOutAndClear() {
      try { if (sb) await sb.auth.signOut(); } catch (e) { /* offline is fine */ }
      await DB.clearAll();
      try { localStorage.removeItem('inspiration-auth'); } catch (e) { }
    },

    kick() { Sync.pull().then(() => Sync.schedulePush(0)); },

    schedulePush(delay) {
      if (!sb) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => Sync.push(), delay == null ? 3000 : delay);
      if (status === 'synced') setStatus('pending');
    },

    async push() {
      if (!sb || pushing) return;
      if (!Sync.user) { setStatus(navigator.onLine ? 'signed-out' : 'offline'); return; }
      if (!navigator.onLine) { setStatus('offline'); return; }
      pushing = true;
      setStatus('syncing');
      try {
        let entries = await DB.all('outbox');
        // Snapshots first is not needed; order by seq so older changes go first
        entries.sort((a, b) => a.seq - b.seq);
        for (const entry of entries) {
          await pushOne(entry);
        }
        const left = await DB.all('outbox');
        if (left.length) { pushing = false; return Sync.schedulePush(1500); }
        setStatus('synced');
      } catch (e) {
        console.warn('Sync push failed', e);
        setStatus(navigator.onLine ? 'error' : 'offline', e && e.message);
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => Sync.push(), 30000);
      } finally {
        pushing = false;
      }
    },

    async pull() {
      if (!sb || pulling || !Sync.user || !navigator.onLine) return;
      pulling = true;
      let changed = false;
      try {
        for (const t of TABLES) {
          let cursor = (await DB.meta.get('pull:' + t)) || '1970-01-01T00:00:00Z';
          for (let page = 0; page < 50; page++) {
            const { data, error } = await sb.from(t).select('*').gt('updated_at', cursor).order('updated_at', { ascending: true }).limit(500);
            if (error) throw error;
            if (!data.length) break;
            for (const row of data) {
              const pending = await DB.get('outbox', t + ':' + row.id);
              const local = await DB.get(t, row.id);
              const r = row.rev || 0, l = local ? (local.rev || 0) : -1;
              // Take the server copy if it is newer. Skip echoes of this device's own saves.
              if (!pending && (!local || r > l || (!local._local_at && r >= l))) {
                await DB.put(t, row);
                changed = true;
              }
              cursor = row.updated_at;
            }
            await DB.meta.set('pull:' + t, cursor);
            if (data.length < 500) break;
          }
        }
        if (changed) Data.emit('remote', null);
        const pendingLeft = await Sync.pendingCount();
        setStatus(pendingLeft ? 'pending' : 'synced');
      } catch (e) {
        console.warn('Sync pull failed', e);
        setStatus(navigator.onLine ? 'error' : 'offline', e && e.message);
      } finally {
        pulling = false;
      }
    }
  };

  async function pushOne(entry) {
    const { table, id } = entry;
    const rec = await DB.get(table, id);
    if (!rec) { await DB.del('outbox', entry.key); return; }
    if (rec.user_id !== Sync.user.id) { await DB.del('outbox', entry.key); return; }
    const base = rec.rev || 0;
    const payload = payloadFor(table, rec);
    payload.rev = base + 1;

    let res = await sb.from(table).update(payload).eq('id', id).eq('rev', base).select('id,rev,updated_at');
    if (res.error) throw res.error;
    let row = res.data && res.data[0];

    if (!row) {
      const ex = await sb.from(table).select('*').eq('id', id).maybeSingle();
      if (ex.error) throw ex.error;
      if (!ex.data) {
        res = await sb.from(table).insert(payload).select('id,rev,updated_at');
        if (res.error) throw res.error;
        row = res.data[0];
      } else {
        // Changed somewhere else since this device last saw it
        const other = ex.data;
        if (table === 'nodes' && JSON.stringify(other.content) !== JSON.stringify(rec.content)) {
          await Data.save('snapshots', {
            node_id: id, project_id: other.project_id,
            name: 'Version from another device',
            reason: 'conflict', content: other.content, word_count: other.word_count || 0
          }, { quiet: true });
          window.App && App.toast('“' + (rec.title || 'Untitled') + '” was also changed on another device. That version is saved in its History.');
        }
        if (table === 'settings') payload.prefs = Object.assign({}, other.prefs || {}, rec.prefs || {});
        payload.rev = (other.rev || 0) + 1;
        res = await sb.from(table).update(payload).eq('id', id).eq('rev', other.rev || 0).select('id,rev,updated_at');
        if (res.error) throw res.error;
        row = res.data && res.data[0];
        if (!row) return; // changed again meanwhile; try next round
      }
    }

    // Record the new revision without touching any newer local edits
    const cur = await DB.get(table, id);
    if (cur) { cur.rev = row.rev; cur.updated_at = row.updated_at; await DB.put(table, cur); }
    const still = await DB.get('outbox', entry.key);
    if (still && still.seq === entry.seq) await DB.del('outbox', entry.key);
  }

  window.Sync = Sync;
})();
