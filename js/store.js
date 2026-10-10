/* Device storage (IndexedDB). Everything is saved here first, then synced.
   Nothing is ever deleted from the synced tables; items are archived instead. */
(function () {
  const DB_NAME = 'inspiration';
  const DB_VERSION = 2;
  const SYNCED = ['projects', 'nodes', 'snapshots', 'writing_log', 'suggestions', 'settings', 'entries'];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const mk = (name, opts, indexes) => {
          if (db.objectStoreNames.contains(name)) return;
          const s = db.createObjectStore(name, opts);
          (indexes || []).forEach(i => s.createIndex(i, i));
        };
        mk('projects', { keyPath: 'id' });
        mk('nodes', { keyPath: 'id' }, ['project_id']);
        mk('snapshots', { keyPath: 'id' }, ['node_id']);
        mk('writing_log', { keyPath: 'id' }, ['day']);
        mk('suggestions', { keyPath: 'id' });
        mk('settings', { keyPath: 'id' });
        mk('outbox', { keyPath: 'key' });
        mk('meta', { keyPath: 'key' });
        mk('files', { keyPath: 'id' });
        mk('entries', { keyPath: 'id' }, ['kind', 'project_id']);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  const DB = {
    SYNCED,
    open,
    get: (store, key) => open().then(db => wrap(db.transaction(store).objectStore(store).get(key))),
    all: store => open().then(db => wrap(db.transaction(store).objectStore(store).getAll())),
    byIndex: (store, index, val) => open().then(db => wrap(db.transaction(store).objectStore(store).index(index).getAll(val))),
    put: (store, obj) => tx(store, 'readwrite', s => wrap(s.put(obj))),
    putMany: (store, list) => tx(store, 'readwrite', s => { list.forEach(o => s.put(o)); }),
    del: (store, key) => tx(store, 'readwrite', s => wrap(s.delete(key))),
    clearAll: () => open().then(db => Promise.all(Array.from(db.objectStoreNames).map(n => tx(n, 'readwrite', s => wrap(s.clear()))))),
    meta: {
      get: key => DB.get('meta', key).then(r => (r ? r.value : undefined)),
      set: (key, value) => DB.put('meta', { key, value })
    }
  };

  /* ---------- Data: the app's single way to save synced records ---------- */
  const listeners = new Set();
  const nowIso = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  // Local date in Central time (evening edits must not land on tomorrow's date)
  function localDate(d) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
    return parts; // YYYY-MM-DD
  }

  const Data = {
    uuid, nowIso, localDate,
    userId: 'local',
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(table, rec) { listeners.forEach(fn => { try { fn(table, rec); } catch (e) { console.error(e); } }); },

    async save(table, rec, opts) {
      opts = opts || {};
      if (!rec.id) rec.id = uuid();
      if (!rec.created_at) rec.created_at = nowIso();
      if (rec.rev == null) rec.rev = 0;
      // If this device's own earlier save has since synced, carry its new revision forward.
      // (Rows that arrived from another device have no _local_at, so a stale copy is caught as a conflict.)
      const cur = await DB.get(table, rec.id);
      if (cur && cur._local_at && (cur.rev || 0) > rec.rev) rec.rev = cur.rev;
      if (cur && cur.updated_at && !rec.updated_at) rec.updated_at = cur.updated_at;
      rec.user_id = Data.userId;
      rec._local_at = nowIso();
      await DB.put(table, rec);
      await DB.put('outbox', { key: table + ':' + rec.id, table, id: rec.id, seq: Date.now() + Math.random() });
      if (!opts.quiet) Data.emit(table, rec);
      if (window.Sync) window.Sync.schedulePush();
      return rec;
    },

    async projects() {
      const list = await DB.all('projects');
      return list.filter(p => p.user_id === Data.userId);
    },
    async nodes(projectId) {
      const list = await DB.byIndex('nodes', 'project_id', projectId);
      return list.filter(n => n.user_id === Data.userId);
    },
    /* Story Atlas entries, Bible notes, business notes, saved designs */
    async entries(kind, projectId) {
      const list = await DB.byIndex('entries', 'kind', kind);
      return list.filter(e => e.user_id === Data.userId && (projectId === undefined || e.project_id === projectId))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.created_at < b.created_at ? -1 : 1));
    },
    async snapshots(nodeId) {
      const list = await DB.byIndex('snapshots', 'node_id', nodeId);
      return list.filter(s => s.user_id === Data.userId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },

    async settings() {
      const s = await DB.get('settings', Data.userId);
      return Object.assign({}, Data.DEFAULT_PREFS, (s && s.prefs) || {});
    },
    async saveSettings(prefs) {
      const s = (await DB.get('settings', Data.userId)) || { id: Data.userId };
      s.prefs = Object.assign({}, (s.prefs || {}), prefs);
      return Data.save('settings', s);
    },
    async settingsRecord() { return DB.get('settings', Data.userId); },

    DEFAULT_PREFS: {
      theme: 'parchment',          // parchment | library | forest | plain
      background: 'scene-dawn',    // a built-in scene id, a photo id, or 'custom:<fileId>'
      writingFont: 'Literata',
      textSize: 19,
      lineHeight: 1.75,
      pageWidth: 720,
      spellcheck: true,
      paragraphStyle: 'indent',    // indent | spaced
      dailyGoal: 500,
      writerName: 'Kayla',
      penName: 'K.E. Nielsen',
      dimBackground: 0.25
    },

    /* Word counting from plain text */
    countWords(text) {
      const m = (text || '').trim().match(/[A-Za-z0-9À-ɏ'’-]+/g);
      return m ? m.length : 0;
    },

    /* Writing log: one row per day per device, summed for totals */
    async logWords(delta) {
      if (!delta) return;
      const deviceId = await Data.deviceId();
      const day = localDate();
      const id = day + ':' + deviceId;
      const row = (await DB.get('writing_log', id)) || { id, day, device: deviceId, words: 0, minutes: 0 };
      row.words = Math.max(0, (row.words || 0) + delta);
      await Data.save('writing_log', row, { quiet: true });
    },
    async wordsOn(day) {
      const rows = await DB.byIndex('writing_log', 'day', day);
      return rows.filter(r => r.user_id === Data.userId).reduce((a, r) => a + (r.words || 0), 0);
    },
    async streak(goal) {
      let n = 0;
      const d = new Date();
      // today counts if goal met; otherwise start from yesterday
      if ((await Data.wordsOn(localDate(d))) < goal) d.setDate(d.getDate() - 1);
      for (let i = 0; i < 400; i++) {
        if ((await Data.wordsOn(localDate(d))) >= goal) { n++; d.setDate(d.getDate() - 1); } else break;
      }
      return n;
    },
    async deviceId() {
      let id = await DB.meta.get('deviceId');
      if (!id) { id = uuid().slice(0, 8); await DB.meta.set('deviceId', id); }
      return id;
    }
  };

  window.DB = DB;
  window.Data = Data;
})();
