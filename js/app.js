/* App shell: start-up, screens, library shelf, settings, ideas box, banners. */
(function () {
  const C = window.APP_CONFIG;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (n || 0).toLocaleString();

  const SPINES = [
    { id: 'oxblood', name: 'Oxblood', hex: '#6b2f2a' }, { id: 'moss', name: 'Moss', hex: '#2f4a3a' },
    { id: 'navy', name: 'Navy', hex: '#2d3a52' }, { id: 'ochre', name: 'Ochre', hex: '#8a6a2f' },
    { id: 'plum', name: 'Plum', hex: '#4a3050' }, { id: 'teal', name: 'Teal', hex: '#2f5a5a' },
    { id: 'saddle', name: 'Saddle', hex: '#7a4a33' }, { id: 'slate', name: 'Slate', hex: '#4f555a' }
  ];
  const KINDS = ['Novel', 'Novella', 'Short story', 'Nonfiction', 'Devotional', 'Poetry', 'Blog post', 'Other'];
  const STATUSES = [{ id: 'active', name: 'On the desk' }, { id: 'paused', name: 'Paused' }, { id: 'finished', name: 'Finished' }];
  const THEMES = [
    { id: 'parchment', name: 'Parchment', note: 'Light and warm' },
    { id: 'library', name: 'Library', note: 'Dark walnut for evenings' },
    { id: 'forest', name: 'Forest', note: 'Deep green and brass' },
    { id: 'plain', name: 'Plain', note: 'Clean white, no scenery' }
  ];
  const FONTS = ['Literata', 'Lora', 'EB Garamond', 'DM Sans', 'Courier Prime'];

  let prefs = Object.assign({}, Data.DEFAULT_PREFS);
  let libFilter = 'active';
  let updateReady = false;

  const App = {
    $, $$, esc, fmt, SPINES, KINDS, STATUSES,
    get prefs() { return prefs; },
    spineHex(id) { return (SPINES.find(s => s.id === id) || SPINES[0]).hex; },

    async start() {
      if (C.ENVIRONMENT === 'staging') document.body.classList.add('is-staging');
      if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('Offline support unavailable', e));
      }
      let r;
      try { r = await Sync.init(); } catch (e) { console.error(e); r = { needLogin: Sync.configured }; }
      await App.loadPrefs();
      Data.onChange(async (table) => {
        if (table === 'settings' || table === 'remote') await App.loadPrefs();
        if (table === 'remote' && App.route().view === 'library') App.render();
      });
      Sync.onStatus(() => App.paintStatus());
      App._topbarClicks();
      window.addEventListener('hashchange', () => App.render());
      setInterval(App.checkForUpdate, 10 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) App.checkForUpdate(); });
      if (r.needLogin) return App.renderLogin();
      App.render();
    },

    async loadPrefs() {
      prefs = await Data.settings();
      App.applyPrefs();
    },

    applyPrefs() {
      const b = document.body;
      b.className = b.className.replace(/\btheme-\w+\b/g, '').trim() + ' theme-' + prefs.theme;
      if (C.ENVIRONMENT === 'staging') b.classList.add('is-staging');
      const root = document.documentElement.style;
      root.setProperty('--write-font', `'${prefs.writingFont}', Georgia, serif`);
      root.setProperty('--write-size', prefs.textSize + 'px');
      root.setProperty('--write-leading', prefs.lineHeight);
      root.setProperty('--page-width', prefs.pageWidth + 'px');
      root.setProperty('--dim', prefs.theme === 'plain' ? 0 : prefs.dimBackground);
      b.classList.toggle('para-spaced', prefs.paragraphStyle === 'spaced');
      App.paintBackground();
    },

    async paintBackground() {
      const scene = $('#scene');
      if (prefs.theme === 'plain') { scene.style.backgroundImage = 'none'; return; }
      const id = prefs.background || 'scene-dawn';
      let url = null;
      if (id.startsWith('custom:')) {
        const f = await DB.get('files', id.slice(7));
        if (f && f.blob) url = URL.createObjectURL(f.blob);
      } else if (id.startsWith('scene-')) {
        url = Scenes.url(id);
      } else {
        const p = C.BACKGROUNDS.find(x => x.id === id);
        if (p) url = p.file;
      }
      if (!url && id !== 'scene-none') url = Scenes.url('scene-dawn');
      scene.style.backgroundImage = url ? `url("${url}")` : 'none';
    },

    route() {
      const h = location.hash.replace(/^#\/?/, '');
      if (/access_token|error_description|type=recovery/.test(h)) return { view: 'library' };
      const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] === 'project' && parts[1] && parts[2] === 'atlas') return { view: 'atlas', projectId: parts[1], entryId: parts[3] || null };
      if (parts[0] === 'project' && parts[1]) return { view: 'project', projectId: parts[1], nodeId: parts[2] || null };
      if (parts[0] === 'backup') return { view: 'backup' };
      if (parts[0] === 'bible') return { view: 'bible', ref: parts[1] || null };
      if (parts[0] === 'templates') return { view: 'templates', designId: parts[1] || null, extra: parts[2] || null };
      if (parts[0] === 'business') return { view: 'business' };
      return { view: 'library' };
    },
    go(hash) { if (location.hash === hash) App.render(); else location.hash = hash; },

    async render() {
      const r = App.route();
      if (window.Editor && r.view !== 'project') await Editor.close();
      if (window.Atlas) await Atlas.flush();
      if (window.Designs) await Designs.leave();
      if (window.Business) await Business.leave();
      if (r.view === 'project') return Editor.open(r.projectId, r.nodeId);
      if (r.view === 'atlas') return Atlas.open(r.projectId, r.entryId);
      if (r.view === 'backup') return Transfer.render();
      if (r.view === 'bible') return Bible.open(r.ref);
      if (r.view === 'templates') return Designs.open(r.designId, r.extra);
      if (r.view === 'business') return Business.open();
      return App.renderLibrary();
    },

    /* ---------------- Shared chrome ---------------- */
    topbar(opts) {
      opts = opts || {};
      return `<header class="topbar ${opts.cls || ''}">
        <div class="tb-left">${opts.left || `<a class="wordmark" href="#/">${esc(C.APP_NAME)}</a>${App.sectionNav(opts.section)}`}</div>
        <div class="tb-mid">${opts.mid || ''}</div>
        <div class="tb-right">
          <span class="update-pill ${updateReady ? '' : 'hidden'}"><button class="link" data-act="apply-update">Update ready, apply when you’re done</button></span>
          <span class="sync-status" data-sync></span>
          ${opts.right || ''}
          <button class="icon-btn" data-act="ideas" title="Ideas for the app">${ICON.bulb}<span>Ideas</span></button>
          <button class="icon-btn" data-act="settings" title="Settings">${ICON.gear}<span>Settings</span></button>
        </div>
      </header>`;
    },
    sectionNav(current) {
      const items = [['writing', '#/', 'Writing'], ['bible', '#/bible', 'Bible'], ['templates', '#/templates', 'Templates'], ['business', '#/business', 'Business']];
      return `<nav class="section-nav" aria-label="Sections">${items.map(([id, href, label]) =>
        `<a href="${href}" ${current === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
    },
    bindTopbar() { App.paintStatus(); },
    _topbarClicks() {
      document.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'ideas') App.openIdeas();
        else if (act === 'settings') App.openSettings();
        else if (act === 'apply-update') App.applyUpdate();
        else if (act === 'signin') App.openSignIn();
      });
    },
    paintStatus() {
      const map = {
        local: ['local', 'Local test mode'],
        synced: ['ok', 'Synced'],
        syncing: ['busy', 'Syncing'],
        pending: ['busy', 'Saved, syncing soon'],
        offline: ['off', 'Offline, saved on this device'],
        'signed-out': ['warn', 'Sign in to sync'],
        error: ['warn', 'Sync paused, saved on this device']
      };
      const [cls, label] = map[Sync.status] || map.local;
      $$('[data-sync]').forEach(n => {
        n.className = 'sync-status s-' + cls;
        n.innerHTML = Sync.status === 'signed-out'
          ? `<i></i><button class="link" data-act="signin">${label}</button>` : `<i></i>${label}`;
        n.title = Sync.status === 'local' ? 'No database is connected yet. Work is saved in this browser only.' : label;
      });
    },

    /* ---------------- Login ---------------- */
    renderLogin(message) {
      $('#app').innerHTML = `<main class="login">
        <div class="login-card">
          <h1 class="login-title">${esc(C.APP_NAME)}</h1>
          <p class="tagline">${esc(C.TAGLINE)}</p>
          <form id="login-form" autocomplete="on">
            <label>Email<input type="email" name="email" autocomplete="username" required></label>
            <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
            <p class="form-msg" id="login-msg">${esc(message || '')}</p>
            <button class="btn primary wide" type="submit">Sign in</button>
            <button class="link small" type="button" id="forgot">Forgot your password?</button>
          </form>
        </div>
      </main>`;
      const form = $('#login-form');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const msg = $('#login-msg');
        msg.textContent = 'Signing in…';
        try {
          await Sync.signIn(form.email.value.trim(), form.password.value);
          await App.loadPrefs();
          location.hash = '#/';
          App.render();
        } catch (err) {
          msg.textContent = navigator.onLine ? 'That email and password didn’t match. Try again.' : 'You’re offline. Connect to the internet to sign in the first time.';
        }
      });
      $('#forgot').addEventListener('click', async () => {
        const email = form.email.value.trim();
        const msg = $('#login-msg');
        if (!email) { msg.textContent = 'Enter your email above, then choose “Forgot your password?” again.'; return; }
        try { await Sync.resetPassword(email); msg.textContent = 'Check your email for a link to set a new password.'; }
        catch (e) { msg.textContent = 'Couldn’t send the email. Check your connection and try again.'; }
      });
    },

    openSignIn() {
      const m = App.modal(`<h2>Sign in to sync</h2>
        <p class="muted">Your work is safe on this device. Sign in to send it to your account.</p>
        <form id="re-login"><label>Email<input type="email" name="email" required></label>
        <label>Password<input type="password" name="password" required></label>
        <p class="form-msg"></p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Not now</button><button class="btn primary">Sign in</button></div></form>`);
      const f = $('#re-login', m.el);
      DB.meta.get('lastUser').then(u => { if (u) f.email.value = u.email; });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        try { await Sync.signIn(f.email.value.trim(), f.password.value); m.close(); App.toast('Signed in. Syncing now.'); }
        catch (err) { $('.form-msg', m.el).textContent = 'That didn’t work. Check the password and your connection.'; }
      });
    },

    openNewPassword() {
      const m = App.modal(`<h2>Set a new password</h2>
        <form id="np"><label>New password<input type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
        <p class="form-msg"></p><div class="modal-actions"><span class="spacer"></span><button class="btn primary">Save password</button></div></form>`);
      const f = $('#np', m.el);
      f.addEventListener('submit', async e => {
        e.preventDefault();
        try { await Sync.updatePassword(f.pw.value); m.close(); App.toast('Password saved.'); history.replaceState(null, '', location.pathname); App.render(); }
        catch (err) { $('.form-msg', m.el).textContent = 'Couldn’t save it. Use at least 8 characters.'; }
      });
    },

    /* ---------------- Library ---------------- */
    async renderLibrary() {
      const all = await Data.projects();
      const today = await Data.wordsOn(Data.localDate());
      const goal = prefs.dailyGoal || 0;
      const streak = goal ? await Data.streak(goal) : 0;
      const last = await DB.meta.get('lastOpened:' + Data.userId);
      const counts = { active: 0, paused: 0, finished: 0, archived: 0 };
      all.forEach(p => { counts[p.archived_at ? 'archived' : (p.status || 'active')]++; });
      const shown = all.filter(p => libFilter === 'archived' ? p.archived_at : (!p.archived_at && (p.status || 'active') === libFilter))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.created_at < b.created_at ? -1 : 1));

      // Total words per project (from documents)
      const totals = {};
      for (const p of shown) {
        const ns = await Data.nodes(p.id);
        totals[p.id] = ns.filter(n => !n.archived_at).reduce((a, n) => a + (n.word_count || 0), 0);
      }

      let resume = '';
      if (last && last.projectId) {
        const p = all.find(x => x.id === last.projectId && !x.archived_at);
        const n = p && last.nodeId ? await DB.get('nodes', last.nodeId) : null;
        if (p) resume = `<a class="resume" href="#/project/${p.id}${n ? '/' + n.id : ''}">Pick up where you left off: <strong>${esc(n ? (n.title || 'Untitled') : p.title)}</strong>${n ? ` in ${esc(p.title)}` : ''}</a>`;
      }

      const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Chicago' }).format(new Date()));
      const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      const name = prefs.writerName ? ', ' + prefs.writerName : '';
      const pct = goal ? Math.min(100, Math.round(today / goal * 100)) : 0;

      const books = shown.map(p => {
        const words = totals[p.id] || 0;
        const h = 230 + Math.min(70, Math.round(Math.sqrt(words) / 3));
        const w = 58 + Math.min(26, Math.round(words / 4000));
        return `<button class="book" style="--spine:${App.spineHex(p.color)};--h:${h}px;--w:${w}px" data-open="${p.id}" title="${esc(p.title)}: ${fmt(words)} words">
          <span class="book-band top"></span><span class="book-title">${esc(p.title || 'Untitled')}</span><span class="book-band bottom"></span>
        </button>`;
      }).join('');

      const emptyNote = !shown.length ? `<p class="shelf-empty">${libFilter === 'active'
        ? (all.length ? 'Nothing on the desk right now. Start something new, or bring a paused project back.' : 'Your shelf is ready. Start your first project.')
        : libFilter === 'archived' ? 'Archived projects will rest here. Nothing is ever thrown away.' : 'No projects here yet.'}</p>` : '';

      $('#app').innerHTML = `${App.topbar({ section: 'writing', right: `<a class="icon-btn" href="#/backup" title="Backup, export and import">${ICON.box}<span>Backup &amp; export</span></a>` })}
        <main class="library">
          <div id="banners"></div>
          <section class="lib-intro">
            <h1>${part}${esc(name)}.</h1>
            ${goal ? `<div class="goal"><div class="goal-text"><strong>${fmt(today)}</strong> of ${fmt(goal)} words today${streak > 1 ? `<span class="streak">${streak}-day streak</span>` : ''}</div>
              <div class="goal-bar"><i style="width:${pct}%"></i></div></div>` : ''}
            ${resume}
          </section>
          <nav class="shelf-tabs" role="tablist">
            ${[['active', 'On the desk'], ['paused', 'Paused'], ['finished', 'Finished'], ['archived', 'Archived']].map(([id, label]) =>
              `<button role="tab" aria-selected="${libFilter === id}" data-filter="${id}">${label}${counts[id] ? `<span class="count">${counts[id]}</span>` : ''}</button>`).join('')}
          </nav>
          <section class="shelf">
            <div class="shelf-row">
              ${books}
              ${libFilter !== 'archived' ? `<button class="book book-new" data-new title="Start a new project"><span>${ICON.plus}</span><span class="book-title">New project</span></button>` : ''}
            </div>
            <div class="plank"></div>
            ${emptyNote}
          </section>
          <footer class="glory">${esc(C.TAGLINE)}</footer>
        </main>`;
      App.bindTopbar();
      const root = $('.library');
      root.addEventListener('click', e => {
        const t = e.target.closest('[data-open],[data-new],[data-filter]');
        if (!t) return;
        if (t.dataset.open) App.go('#/project/' + t.dataset.open);
        else if ('new' in t.dataset) App.editProject(null);
        else if (t.dataset.filter) { libFilter = t.dataset.filter; App.renderLibrary(); }
      });
      root.addEventListener('contextmenu', e => {
        const t = e.target.closest('[data-open]');
        if (t) { e.preventDefault(); App.editProject(t.dataset.open); }
      });
      App.renderBanners();
    },

    async renderBanners() {
      const box = $('#banners');
      if (!box) return;
      let html = '';
      if (!Sync.configured) html += `<div class="banner info">Local test mode: work is saved in this browser only. Add the Supabase details in config.js to turn on sign-in and sync.</div>`;
      const days = await App.daysSinceBackup();
      const snooze = await DB.meta.get('backupSnooze');
      const hasWork = (await Data.projects()).length > 0;
      if (hasWork && days >= (C.BACKUP_REMINDER_DAYS || 30) && !(snooze && Date.now() < snooze)) {
        html += `<div class="banner backup"><span>${days === Infinity ? 'You haven’t downloaded a backup yet.' : `It’s been ${days} days since your last backup.`} A copy on a drive keeps your work safe no matter what.</span>
          <span class="banner-actions"><button class="btn small primary" data-backup-now>Download backup</button><button class="btn small" data-backup-later>Remind me later</button></span></div>`;
      }
      box.innerHTML = html;
      box.onclick = async e => {
        if (e.target.closest('[data-backup-now]')) { await Transfer.downloadBackup(); App.renderBanners(); }
        if (e.target.closest('[data-backup-later]')) { await DB.meta.set('backupSnooze', Date.now() + 3 * 864e5); App.renderBanners(); }
      };
    },

    async daysSinceBackup() {
      const s = await Data.settingsRecord();
      let last = s && s.last_backup_at;
      if (!last) {
        // Count from when the first project was made
        const ps = await Data.projects();
        if (!ps.length) return 0;
        const first = ps.map(p => p.created_at).sort()[0];
        return Math.floor((Date.now() - new Date(first)) / 864e5) >= (C.BACKUP_REMINDER_DAYS || 30) ? Infinity : 0;
      }
      return Math.floor((Date.now() - new Date(last)) / 864e5);
    },

    /* ---------------- Project details ---------------- */
    async editProject(id) {
      const p = id ? await DB.get('projects', id) : { title: '', subtitle: '', kind: 'Novel', status: 'active', color: SPINES[Math.floor(Math.random() * SPINES.length)].id, word_goal: null };
      const m = App.modal(`<h2>${id ? 'Project details' : 'New project'}</h2>
        <form id="proj-form">
          <label>Title<input name="title" required maxlength="120" value="${esc(p.title)}" placeholder="Working title"></label>
          <label>Subtitle or series <span class="opt">optional</span><input name="subtitle" maxlength="160" value="${esc(p.subtitle || '')}"></label>
          <div class="row2">
            <label>Kind<select name="kind">${KINDS.map(k => `<option ${p.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
            <label>Word goal <span class="opt">optional</span><input name="word_goal" type="number" min="0" step="500" value="${p.word_goal || ''}" placeholder="e.g. 80000"></label>
          </div>
          ${id ? `<label>Where it sits<select name="status">${STATUSES.map(s => `<option value="${s.id}" ${p.status === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label>` : ''}
          <fieldset class="swatches"><legend>Spine color</legend>
            ${SPINES.map(s => `<label class="swatch" title="${s.name}"><input type="radio" name="color" value="${s.id}" ${p.color === s.id ? 'checked' : ''}><i style="background:${s.hex}"></i><span class="sr">${s.name}</span></label>`).join('')}
          </fieldset>
          <div class="modal-actions">
            ${id ? (p.archived_at ? `<button type="button" class="btn" data-restore>Bring back from archive</button>` : `<button type="button" class="btn quiet" data-archive>Archive project</button>`) : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" data-close>Cancel</button>
            <button class="btn primary">${id ? 'Save' : 'Create project'}</button>
          </div>
        </form>`);
      const f = $('#proj-form', m.el);
      f.title.focus();
      f.addEventListener('submit', async e => {
        e.preventDefault();
        p.title = f.title.value.trim() || 'Untitled';
        p.subtitle = f.subtitle.value.trim();
        p.kind = f.kind.value;
        p.word_goal = f.word_goal.value ? Number(f.word_goal.value) : null;
        if (f.status) p.status = f.status.value;
        p.color = (f.querySelector('input[name=color]:checked') || {}).value || p.color;
        if (!id) p.sort_order = Date.now();
        const saved = await Data.save('projects', p);
        m.close();
        if (!id) {
          // Starter layout: a manuscript folder with a first chapter, and a notes folder
          const ms = await Data.save('nodes', { project_id: saved.id, parent_id: null, kind: 'folder', title: 'Manuscript', sort_order: 1, word_count: 0 });
          const ch = await Data.save('nodes', { project_id: saved.id, parent_id: ms.id, kind: 'doc', title: 'Chapter 1', sort_order: 1, content: null, plain: '', word_count: 0 });
          await Data.save('nodes', { project_id: saved.id, parent_id: null, kind: 'folder', title: 'Notes & research', sort_order: 2, word_count: 0 });
          App.go('#/project/' + saved.id + '/' + ch.id);
        } else App.render();
      });
      const arch = $('[data-archive]', m.el), rest = $('[data-restore]', m.el);
      if (arch) arch.onclick = async () => { p.archived_at = Data.nowIso(); await Data.save('projects', p); m.close(); App.toast('“' + p.title + '” moved to the archive.'); App.go('#/'); };
      if (rest) rest.onclick = async () => { p.archived_at = null; await Data.save('projects', p); m.close(); App.toast('“' + p.title + '” is back on the shelf.'); App.render(); };
    },

    /* ---------------- Settings ---------------- */
    async openSettings(tab) {
      tab = tab || 'look';
      const customs = (await DB.all('files')).filter(f => f.kind === 'background');
      const bgThumb = (id, url, name) => `<button class="bg-opt ${prefs.background === id ? 'on' : ''}" data-bg="${id}" title="${esc(name)}">
          <span class="bg-img" style="${url ? `background-image:url('${url}')` : ''}"></span><span>${esc(name)}</span></button>`;
      const scenes = Object.keys(Scenes.list).map(id => bgThumb(id, Scenes.url(id), Scenes.list[id].name)).join('');
      const photos = C.BACKGROUNDS.map(b => `<button class="bg-opt photo ${prefs.background === b.id ? 'on' : ''}" data-bg="${b.id}" data-src="${esc(b.file)}" title="${esc(b.name)}"><span class="bg-img" style="background-image:url('${esc(b.file)}')"></span><span>${esc(b.name)}</span></button>`).join('');
      const custom = customs.map(f => bgThumb('custom:' + f.id, URL.createObjectURL(f.blob), f.name || 'My photo')).join('');
      const user = await DB.meta.get('lastUser');

      const m = App.modal(`<h2>Settings</h2>
        <nav class="tabs" role="tablist">
          ${[['look', 'Look'], ['writing', 'Writing'], ['goals', 'You & goals'], ['account', 'Account']].map(([id, n]) => `<button role="tab" data-tab="${id}" aria-selected="${tab === id}">${n}</button>`).join('')}
        </nav>
        <section class="tabpane" data-pane="look">
          <h3>Theme</h3>
          <div class="theme-grid">${THEMES.map(t => `<button class="theme-opt t-${t.id} ${prefs.theme === t.id ? 'on' : ''}" data-theme="${t.id}"><span class="theme-chip"></span><strong>${t.name}</strong><span class="muted">${t.note}</span></button>`).join('')}</div>
          <h3>Background</h3>
          <div class="bg-grid">${scenes}${photos}${custom}
            <label class="bg-opt add"><input type="file" accept="image/*" hidden data-upload-bg><span class="bg-img">${ICON.plus}</span><span>Add your own photo</span></label>
          </div>
          <p class="hint">Photos you add are kept on this device.</p>
          <label class="range">How much to soften the background<input type="range" min="0" max="0.7" step="0.05" value="${prefs.dimBackground}" data-pref="dimBackground"></label>
        </section>
        <section class="tabpane" data-pane="writing">
          <label>Writing font<select data-pref="writingFont">${FONTS.map(f => `<option ${prefs.writingFont === f ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></label>
          <label class="range">Text size <output>${prefs.textSize}px</output><input type="range" min="14" max="28" step="1" value="${prefs.textSize}" data-pref="textSize"></label>
          <label class="range">Line spacing <output>${prefs.lineHeight}</output><input type="range" min="1.3" max="2.4" step="0.05" value="${prefs.lineHeight}" data-pref="lineHeight"></label>
          <label class="range">Page width <output>${prefs.pageWidth}px</output><input type="range" min="520" max="1000" step="20" value="${prefs.pageWidth}" data-pref="pageWidth"></label>
          <label>Paragraphs<select data-pref="paragraphStyle"><option value="indent" ${prefs.paragraphStyle === 'indent' ? 'selected' : ''}>Indented, like a book</option><option value="spaced" ${prefs.paragraphStyle === 'spaced' ? 'selected' : ''}>Space between, like a letter</option></select></label>
          <label class="check"><input type="checkbox" data-pref="spellcheck" ${prefs.spellcheck ? 'checked' : ''}> Underline spelling mistakes</label>
          <p class="hint">Spelling uses your computer’s own dictionary. Right-click a word to add it. Grammar checking and a dictionary for each project’s names are coming next.</p>
        </section>
        <section class="tabpane" data-pane="goals">
          <label>Your name<input data-pref="writerName" value="${esc(prefs.writerName || '')}" placeholder="Used in greetings"></label>
          <label>Pen name<input data-pref="penName" value="${esc(prefs.penName || '')}" placeholder="Used on exported title pages"></label>
          <label>Daily word goal<input type="number" min="0" step="50" data-pref="dailyGoal" value="${prefs.dailyGoal || 0}"></label>
          <p class="hint">Set the goal to 0 to hide it.</p>
        </section>
        <section class="tabpane" data-pane="account">
          ${Sync.configured ? `
            <p>Signed in as <strong>${esc(user ? user.email : 'not signed in')}</strong></p>
            <form id="pw-form" class="inline-form"><label>New password<input type="password" name="pw" minlength="8" autocomplete="new-password"></label><button class="btn">Change password</button></form>
            <h3>This device</h3>
            <p class="muted">Signing out removes your work from this device only. It stays safe in your account.</p>
            <button class="btn danger" data-signout>Sign out and clear this device</button>`
            : `<p class="muted">Local test mode. No account is connected, so work is saved in this browser only.</p>`}
          <h3>About</h3>
          <p class="muted">${esc(C.APP_NAME)}, version ${esc(C.VERSION)}${C.ENVIRONMENT === 'staging' ? ' (staging)' : ''}</p>
        </section>
        <div class="modal-actions"><span class="spacer"></span><button class="btn primary" data-close>Done</button></div>`, { wide: true });

      const showTab = t => { $$('[data-tab]', m.el).forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t)); $$('[data-pane]', m.el).forEach(p => p.hidden = p.dataset.pane !== t); };
      showTab(tab);
      // Hide photo backgrounds whose files are missing
      $$('.bg-opt.photo', m.el).forEach(b => { const i = new Image(); i.onerror = () => b.remove(); i.src = b.dataset.src; });

      m.el.addEventListener('click', async e => {
        const t = e.target.closest('[data-tab],[data-theme],[data-bg],[data-signout]');
        if (!t) return;
        if (t.dataset.tab) showTab(t.dataset.tab);
        else if (t.dataset.theme) { await App.setPref('theme', t.dataset.theme); $$('[data-theme]', m.el).forEach(b => b.classList.toggle('on', b === t)); }
        else if (t.dataset.bg) { await App.setPref('background', t.dataset.bg); $$('[data-bg]', m.el).forEach(b => b.classList.toggle('on', b === t)); }
        else if ('signout' in t.dataset) App.confirmSignOut();
      });
      m.el.addEventListener('input', e => {
        const t = e.target;
        if (!t.dataset.pref) return;
        let v = t.type === 'checkbox' ? t.checked : t.value;
        if (t.type === 'range' || t.type === 'number') v = Number(v);
        const out = t.parentElement.querySelector('output');
        if (out) out.textContent = v + (/textSize|pageWidth/.test(t.dataset.pref) ? 'px' : '');
        prefs[t.dataset.pref] = v; App.applyPrefs();
        clearTimeout(App._prefT); App._prefT = setTimeout(() => Data.saveSettings({ [t.dataset.pref]: v }), 400);
        if (t.dataset.pref === 'spellcheck' && window.Editor) Editor.applySpellcheck();
      });
      const up = $('[data-upload-bg]', m.el);
      up.addEventListener('change', async () => {
        const file = up.files[0]; if (!file) return;
        const blob = await App.shrinkImage(file, 2400);
        const id = Data.uuid();
        await DB.put('files', { id, kind: 'background', name: file.name.replace(/\.[^.]+$/, ''), blob });
        await App.setPref('background', 'custom:' + id);
        m.close(); App.openSettings('look');
      });
      const pw = $('#pw-form', m.el);
      if (pw) pw.addEventListener('submit', async e => {
        e.preventDefault();
        try { await Sync.updatePassword(pw.pw.value); pw.reset(); App.toast('Password changed.'); }
        catch (err) { App.toast('Couldn’t change the password. Use at least 8 characters, and check your connection.'); }
      });
    },

    async setPref(k, v) { prefs[k] = v; App.applyPrefs(); await Data.saveSettings({ [k]: v }); },

    async confirmSignOut() {
      const pending = await Sync.pendingCount();
      const m = App.modal(`<h2>Sign out and clear this device?</h2>
        ${pending ? `<p class="warn-text">${pending} change${pending > 1 ? 's haven’t' : ' hasn’t'} synced yet. Connect to the internet and wait for “Synced” first, or ${pending > 1 ? 'they' : 'it'} will be lost.</p>` : '<p>Everything is synced. Your work stays safe in your account.</p>'}
        <div class="modal-actions"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn danger" data-yes>Sign out and clear</button></div>`);
      $('[data-yes]', m.el).onclick = async () => { await Sync.signOutAndClear(); location.hash = ''; location.reload(); };
    },

    shrinkImage(file, max) {
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(b => resolve(b || file), 'image/jpeg', 0.85);
        };
        img.onerror = () => resolve(file);
        img.src = URL.createObjectURL(file);
      });
    },

    /* ---------------- Ideas box ---------------- */
    async openIdeas() {
      const list = (await DB.all('suggestions')).filter(s => s.user_id === Data.userId && !s.archived_at).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const label = { new: 'Sent', planned: 'Planned', building: 'Being built', done: 'Done', declined: 'Not now' };
      const m = App.modal(`<h2>Ideas for Inspiration</h2>
        <p class="muted">What would make this a better place to write? Anything goes, big or small. Jared reads every one.</p>
        <form id="idea-form"><textarea name="body" rows="4" required placeholder="I wish I could…"></textarea>
        <div class="modal-actions"><span class="spacer"></span><button class="btn" type="button" data-close>Close</button><button class="btn primary">Send idea</button></div></form>
        ${list.length ? `<h3>Your ideas</h3><ul class="idea-list">${list.map(s => `<li><p>${esc(s.body)}</p><div class="idea-meta"><span class="tag tag-${esc(s.status || 'new')}">${label[s.status] || 'Sent'}</span><span class="muted">${new Date(s.created_at).toLocaleDateString()}</span></div>${s.reply ? `<p class="reply">${esc(s.reply)}</p>` : ''}</li>`).join('')}</ul>` : ''}`);
      const f = $('#idea-form', m.el);
      f.body.focus();
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const body = f.body.value.trim(); if (!body) return;
        await Data.save('suggestions', { body, status: 'new' });
        m.close(); App.toast('Idea sent. Thank you!');
      });
    },

    /* ---------------- Updates ---------------- */
    async checkForUpdate() {
      if (location.protocol === 'file:' || !navigator.onLine) return;
      try {
        const txt = await (await fetch('js/config.js?v=' + Date.now(), { cache: 'no-store' })).text();
        const m = txt.match(/VERSION:\s*'([^']+)'/);
        if (m && m[1] !== C.VERSION) { updateReady = true; $$('.update-pill').forEach(p => p.classList.remove('hidden')); }
      } catch (e) { /* offline */ }
    },
    async applyUpdate() {
      if (window.Editor) await Editor.flush();
      location.reload();
    },

    /* ---------------- Modal & toast ---------------- */
    modal(html, opts) {
      opts = opts || {};
      const root = $('#modal-root');
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
      root.appendChild(wrap);
      const prev = document.activeElement;
      const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); if (opts.onClose) opts.onClose(); };
      const onKey = e => { if (e.key === 'Escape' && root.lastElementChild === wrap) close(); };
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
      wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
      const first = wrap.querySelector('input,select,textarea,button:not([data-close])');
      if (first && !opts.noFocus) setTimeout(() => first.focus(), 0);
      return { el: wrap.firstElementChild, close };
    },
    confirm(title, body, yes, danger) {
      return new Promise(resolve => {
        const m = App.modal(`<h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ''}
          <div class="modal-actions"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(yes || 'OK')}</button></div>`, { onClose: () => resolve(false) });
        $('[data-yes]', m.el).onclick = () => { resolve(true); m.close(); };
      });
    },
    prompt(title, value, yes) {
      return new Promise(resolve => {
        let done = false;
        const m = App.modal(`<h2>${esc(title)}</h2><form><input name="v" value="${esc(value || '')}" maxlength="160">
          <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${esc(yes || 'Save')}</button></div></form>`, { onClose: () => { if (!done) resolve(null); } });
        const f = $('form', m.el);
        setTimeout(() => f.v.select(), 0);
        f.addEventListener('submit', e => { e.preventDefault(); done = true; resolve(f.v.value.trim()); m.close(); });
      });
    },
    toast(msg, ms) {
      const t = document.createElement('div');
      t.className = 'toast'; t.textContent = msg;
      $('#toasts').appendChild(t);
      setTimeout(() => t.classList.add('out'), ms || 4200);
      setTimeout(() => t.remove(), (ms || 4200) + 400);
    }
  };

  const svgI = p => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    bulb: svgI('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
    gear: svgI('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    plus: svgI('<path d="M12 5v14M5 12h14"/>'),
    box: svgI('<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>'),
    shelf: svgI('<path d="M4 19V5M8 19V7M12 19V4M16 19l3-13M2 21h20"/>'),
    folder: svgI('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    doc: svgI('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
    focus: svgI('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    panel: svgI('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M15 4v16"/>'),
    more: svgI('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
    history: svgI('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
    chevron: svgI('<path d="M9 6l6 6-6 6"/>'),
    back: svgI('<path d="M15 18l-6-6 6-6"/>')
  };
  App.ICON = ICON;
  window.App = App;
})();
