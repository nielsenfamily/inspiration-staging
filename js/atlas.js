/* Story Atlas: the people, places, things and events of each project. */
(function () {
  const { $, $$, esc, fmt, ICON } = App;
  const KINDS = {
    character: { label: 'Characters', one: 'character', fields: [
      ['role', 'Role in the story', 'select', ['', 'Main character', 'Antagonist', 'Supporting', 'Minor']],
      ['aka', 'Also called', 'text', 'Nicknames, titles, other names (comma separated)'],
      ['age', 'Age', 'text'],
      ['appearance', 'Appearance', 'area'],
      ['personality', 'Personality', 'area'],
      ['want', 'What they want', 'area'],
      ['obstacle', 'What stands in the way', 'area'],
      ['arc', 'How they change', 'area'],
      ['backstory', 'Backstory', 'area']] },
    place: { label: 'Places', one: 'place', fields: [
      ['aka', 'Also called', 'text'],
      ['type', 'What kind of place', 'text', 'Town, house, forest, kingdom…'],
      ['senses', 'What you see, hear and smell there', 'area'],
      ['significance', 'Why it matters to the story', 'area']] },
    thing: { label: 'Things & lore', one: 'thing', fields: [
      ['aka', 'Also called', 'text'],
      ['description', 'Description', 'area'],
      ['rules', 'Rules or limits', 'area'],
      ['significance', 'Why it matters to the story', 'area']] },
    event: { label: 'Events', one: 'event', fields: [
      ['when', 'When it happens', 'text', 'Day, season, year, or “before the story”'],
      ['what', 'What happens', 'area'],
      ['who', 'Who is involved', 'text'],
      ['consequence', 'What changes because of it', 'area']] }
  };
  const S = { project: null, entries: [], current: null, filter: '', saveT: null };

  const Atlas = {
    KINDS,
    async open(projectId, entryId) {
      const p = await DB.get('projects', projectId);
      if (!p || p.user_id !== Data.userId) return App.go('#/');
      S.project = p;
      S.entries = (await Data.entries('atlas', projectId)).filter(e => !e.archived_at);
      $('#app').innerHTML = `<div class="ws atlas-ws">
        ${App.topbar({ cls: 'ws-top', left: `<a class="icon-btn" href="#/" title="Back to your shelf">${ICON.shelf}<span>Library</span></a>
            <span class="proj-name static">${esc(p.title)}</span>`, mid: Atlas.switcher(p.id, 'atlas') })}
        <div class="atlas-body">
          <aside class="binder atlas-list" aria-label="Story Atlas entries">
            <div class="binder-head"><input type="search" class="atlas-filter" placeholder="Find…" aria-label="Find in the atlas" value="${esc(S.filter)}"></div>
            <div class="tree atlas-tree"></div>
          </aside>
          <main class="desk"><div class="desk-scroll"><div class="page-col atlas-col"></div></div></main>
        </div></div>`;
      App.bindTopbar();
      Atlas.renderList();
      const root = $('.atlas-ws');
      root.addEventListener('click', e => {
        const add = e.target.closest('[data-add]'); if (add) return Atlas.add(add.dataset.add);
        const it = e.target.closest('[data-entry]'); if (it) return Atlas.select(it.dataset.entry);
        const doc = e.target.closest('[data-doc]'); if (doc) return App.go('#/project/' + S.project.id + '/' + doc.dataset.doc);
        if (e.target.closest('[data-archive-entry]')) Atlas.archive();
      });
      $('.atlas-filter').addEventListener('input', e => { S.filter = e.target.value; Atlas.renderList(); });
      Atlas.select(entryId || null);
    },

    switcher(projectId, current) {
      return `<nav class="seg" aria-label="Project view">
        <a href="#/project/${projectId}" ${current === 'manuscript' ? 'aria-current="page"' : ''}>Manuscript</a>
        <a href="#/project/${projectId}/atlas" ${current === 'atlas' ? 'aria-current="page"' : ''}>Story Atlas</a></nav>`;
    },

    renderList() {
      const f = S.filter.trim().toLowerCase();
      $('.atlas-tree').innerHTML = Object.entries(KINDS).map(([k, def]) => {
        const items = S.entries.filter(e => e.subtype === k && (!f || (e.title || '').toLowerCase().includes(f) || ((e.data || {}).aka || '').toLowerCase().includes(f)));
        return `<div class="atlas-group"><div class="atlas-gh"><span>${def.label}</span><button class="icon-btn only" data-add="${k}" title="Add a ${def.one}">${ICON.plus}</button></div>
          ${items.map(e => `<button class="tn atlas-item ${S.current && S.current.id === e.id ? 'on' : ''}" data-entry="${e.id}" style="--depth:0"><span class="tn-title">${esc(e.title || 'Unnamed')}</span>${e.data && e.data.role ? `<span class="tn-words">${esc(e.data.role)}</span>` : ''}</button>`).join('')
            || `<p class="atlas-empty">None yet</p>`}</div>`;
      }).join('');
    },

    async add(kind) {
      const e = await Data.save('entries', { kind: 'atlas', project_id: S.project.id, subtype: kind, title: '', body: '', data: {}, sort_order: Date.now() }, { quiet: true });
      S.entries.push(e);
      await Atlas.select(e.id);
      setTimeout(() => { const n = $('.atlas-name'); if (n) n.focus(); }, 30);
    },

    async select(id) {
      await Atlas.flush();
      const e = id ? S.entries.find(x => x.id === id) : null;
      S.current = e || null;
      history.replaceState(null, '', `#/project/${S.project.id}/atlas${e ? '/' + e.id : ''}`);
      Atlas.renderList();
      const col = $('.atlas-col');
      if (!e) {
        const counts = Object.entries(KINDS).map(([k, d]) => `<button class="card atlas-start" data-add="${k}"><span class="card-title">${d.label}</span><span class="card-syn">${fmt(S.entries.filter(x => x.subtype === k).length)} so far. Add a ${d.one}.</span></button>`).join('');
        col.innerHTML = `<div class="page atlas-intro"><h1 class="atlas-h">Story Atlas</h1>
          <p>Everything you know about the world of <em>${esc(S.project.title)}</em>, kept in one place. Each entry shows where it appears in your manuscript, and names you add here are never flagged as misspellings.</p>
          <div class="cards">${counts}</div></div>`;
        return;
      }
      const def = KINDS[e.subtype] || KINDS.thing;
      const d = e.data || {};
      col.innerHTML = `<article class="page atlas-page">
        <p class="atlas-kind">${esc(def.one[0].toUpperCase() + def.one.slice(1))}</p>
        <input class="doc-title atlas-name" value="${esc(e.title || '')}" placeholder="Name" maxlength="120" aria-label="Name">
        <div class="atlas-fields">
          ${def.fields.map(([key, label, type, extra]) => type === 'select'
            ? `<label>${label}<select data-f="${key}">${extra.map(o => `<option ${d[key] === o ? 'selected' : ''} value="${o}">${o || 'Choose…'}</option>`).join('')}</select></label>`
            : type === 'area' ? `<label>${label}<textarea data-f="${key}" rows="3">${esc(d[key] || '')}</textarea></label>`
            : `<label>${label}<input data-f="${key}" value="${esc(d[key] || '')}" ${extra ? `placeholder="${esc(extra)}"` : ''}></label>`).join('')}
          <label>Notes<textarea data-body rows="5" placeholder="Anything else">${esc(e.body || '')}</textarea></label>
        </div>
        <section class="appears"><h3>Appears in</h3><div class="appears-list"><p class="muted small">Looking through your manuscript…</p></div></section>
        <div class="modal-actions"><span class="spacer"></span><button class="btn quiet small" data-archive-entry>Archive this entry</button></div>
      </article>`;
      const page = $('.atlas-page');
      page.addEventListener('input', ev => {
        const t = ev.target;
        if (t.classList.contains('atlas-name')) { e.title = t.value; const li = $(`[data-entry="${e.id}"] .tn-title`); if (li) li.textContent = e.title || 'Unnamed'; }
        else if (t.dataset.f) { e.data = Object.assign({}, e.data, { [t.dataset.f]: t.value }); if (t.dataset.f === 'role') Atlas.renderList(); }
        else if ('body' in t.dataset) e.body = t.value;
        S.dirty = true; clearTimeout(S.saveT); S.saveT = setTimeout(Atlas.flush, 700);
      });
      page.addEventListener('change', ev => { if (ev.target.classList.contains('atlas-name') || ev.target.dataset.f === 'aka') Atlas.appears(); });
      Atlas.appears();
    },

    async appears() {
      const e = S.current; if (!e) return;
      const names = [e.title, ...((e.data || {}).aka || '').split(',')].map(s => (s || '').trim()).filter(s => s.length > 1);
      const box = $('.appears-list'); if (!box) return;
      if (!names.length) { box.innerHTML = '<p class="muted small">Give this entry a name to see where it appears.</p>'; return; }
      const re = new RegExp('\\b(' + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi');
      const docs = (await Data.nodes(S.project.id)).filter(n => n.kind === 'doc' && !n.archived_at);
      const hits = docs.map(n => ({ n, count: ((n.plain || '').match(re) || []).length })).filter(h => h.count).sort((a, b) => (a.n.sort_order || 0) - (b.n.sort_order || 0));
      box.innerHTML = hits.length ? hits.map(h => `<button class="xref" data-doc="${h.n.id}"><strong>${esc(h.n.title || 'Untitled')}</strong><span>${h.count} mention${h.count === 1 ? '' : 's'}</span></button>`).join('')
        : '<p class="muted small">Not mentioned in the manuscript yet.</p>';
    },

    async flush() {
      clearTimeout(S.saveT);
      if (!S.dirty || !S.current) return;
      S.dirty = false;
      await Data.save('entries', S.current, { quiet: true });
    },

    async archive() {
      const e = S.current; if (!e) return;
      const ok = await App.confirm('Archive “' + (e.title || 'this entry') + '”?', 'It will be hidden from the atlas. Nothing is deleted.', 'Archive');
      if (!ok) return;
      e.archived_at = Data.nowIso();
      await Data.save('entries', e, { quiet: true });
      S.entries = S.entries.filter(x => x.id !== e.id);
      S.current = null;
      Atlas.select(null);
    },

    /* Words that should never be flagged in this project: atlas names plus the project dictionary */
    async wordsFor(projectId) {
      const p = await DB.get('projects', projectId);
      const words = new Set((p && p.dictionary) || []);
      (await Data.entries('atlas', projectId)).filter(e => !e.archived_at).forEach(e => {
        [e.title, ...((e.data || {}).aka || '').split(',')].forEach(n => (n || '').split(/[\s\-]+/).forEach(w => { w = w.replace(/[^\p{L}'’]/gu, ''); if (w.length > 1) words.add(w); }));
      });
      return [...words];
    }
  };
  window.Atlas = Atlas;
})();
