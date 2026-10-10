/* Business: a home for health coaching and author business notes. Analytics and store sales come later. */
(function () {
  const { $, $$, esc } = App;
  let notes = [], current = null, saveT = null, dirty = false;

  const Business = {
    async open() {
      await Editor.close();
      notes = (await Data.entries('business_note')).filter(n => !n.archived_at).sort((a, b) => (a.updated_at || a.created_at) < (b.updated_at || b.created_at) ? 1 : -1);
      $('#app').innerHTML = `${App.topbar({ section: 'business' })}
        <main class="business">
          <h1 class="section-title">Business</h1>
          <p class="section-sub">Health coaching and the author business, side by side with the writing that powers them.</p>
          <div class="biz-grid">
            <section class="biz-soon">
              <h2>More to come</h2>
              <p>This is where the business side of your work will grow. Ideas on the list:</p>
              <ul>
                <li>Sales from your fan store</li>
                <li>Readers, subscribers and how they find you</li>
                <li>Coaching clients and programs</li>
                <li>A content calendar for posts, newsletters and launches</li>
              </ul>
              <p class="muted">Have an idea for this space? Send it from the lightbulb at the top.</p>
            </section>
            <section class="biz-notes">
              <div class="insp-head"><h2>Business notes</h2><button class="btn small primary" data-new-note>${App.ICON.plus} New note</button></div>
              <div class="biz-note-layout">
                <ul class="biz-list"></ul>
                <div class="biz-editor"></div>
              </div>
            </section>
          </div>
          <footer class="glory">${esc(window.APP_CONFIG.TAGLINE)}</footer>
        </main>`;
      App.bindTopbar();
      const root = $('.business');
      root.addEventListener('click', e => {
        if (e.target.closest('[data-new-note]')) return Business.add();
        const n = e.target.closest('[data-note]'); if (n) return Business.select(n.dataset.note);
        if (e.target.closest('[data-archive-note]')) return Business.archive();
      });
      Business.renderList();
      Business.select(notes[0] ? notes[0].id : null);
    },

    renderList() {
      $('.biz-list').innerHTML = notes.length ? notes.map(n => `<li><button class="biz-item ${current && current.id === n.id ? 'on' : ''}" data-note="${n.id}">
        <strong>${esc(n.title || 'Untitled note')}</strong><span>${esc((n.body || '').slice(0, 70))}</span></button></li>`).join('')
        : '<li class="muted small">Plans, offers, launch ideas, client follow-ups. Start with “New note.”</li>';
    },

    async add() {
      await Business.flush();
      const n = await Data.save('entries', { kind: 'business_note', subtype: 'note', title: '', body: '', data: {} }, { quiet: true });
      notes.unshift(n);
      Business.renderList(); Business.select(n.id);
      setTimeout(() => { const t = $('.biz-title'); if (t) t.focus(); }, 30);
    },

    async select(id) {
      await Business.flush();
      current = notes.find(n => n.id === id) || null;
      Business.renderList();
      const box = $('.biz-editor');
      if (!current) { box.innerHTML = ''; return; }
      box.innerHTML = `<input class="biz-title" value="${esc(current.title || '')}" placeholder="Title" aria-label="Note title">
        <textarea class="biz-body" rows="14" placeholder="Write anything here">${esc(current.body || '')}</textarea>
        <div class="modal-actions"><span class="muted small">Saves on its own</span><span class="spacer"></span><button class="btn quiet small" data-archive-note>Archive note</button></div>`;
      box.oninput = e => {
        if (e.target.classList.contains('biz-title')) current.title = e.target.value;
        if (e.target.classList.contains('biz-body')) current.body = e.target.value;
        dirty = true; clearTimeout(saveT); saveT = setTimeout(Business.flush, 700);
      };
    },

    async flush() {
      clearTimeout(saveT);
      if (!dirty || !current) return;
      dirty = false;
      await Data.save('entries', current, { quiet: true });
      const li = $(`[data-note="${current.id}"]`);
      if (li) li.innerHTML = `<strong>${esc(current.title || 'Untitled note')}</strong><span>${esc((current.body || '').slice(0, 70))}</span>`;
    },

    async archive() {
      if (!current) return;
      if (!(await App.confirm('Archive this note?', 'It will be hidden from the list. Nothing is deleted.', 'Archive'))) return;
      current.archived_at = Data.nowIso();
      await Data.save('entries', current, { quiet: true });
      notes = notes.filter(n => n !== current); current = null;
      Business.renderList(); Business.select(notes[0] ? notes[0].id : null);
    },
    leave() { return Business.flush(); }
  };
  window.Business = Business;
})();
