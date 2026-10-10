/* Templates: printable designs built from JSON template files in /templates.
   Kayla changes words and simple design choices (borders, colors, lettering) with controls; the JSON never needs editing by hand. */
(function () {
  const { $, $$, esc, fmt } = App;
  const FONTS = ['Cormorant Garamond', 'EB Garamond', 'Lora', 'Literata', 'DM Sans', 'Courier Prime'];
  const cache = {};
  const S = { tpl: null, design: null, values: null, saveT: null, dirty: false, tab: 'content' };

  async function template(id) {
    if (!cache[id]) cache[id] = fetch('templates/' + id + '.json').then(r => { if (!r.ok) throw new Error('missing'); return r.json(); });
    return cache[id];
  }
  async function allTemplates() {
    const ids = await fetch('templates/index.json').then(r => r.json());
    return (await Promise.all(ids.map(id => template(id).catch(() => null)))).filter(Boolean);
  }
  function defaults(tpl) {
    const v = { fields: {}, design: {} };
    tpl.fields.forEach(f => { v.fields[f.key] = f.default || ''; });
    tpl.design.forEach(d => { v.design[d.key] = d.default; });
    return v;
  }

  /* Draw a template with values into an element (isolated so its styles can't affect the app) */
  function draw(host, tpl, values, scaleTo) {
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const classes = [], vars = [];
    tpl.design.forEach(d => {
      const val = values.design[d.key] != null ? values.design[d.key] : d.default;
      if (d.type === 'choice') classes.push(`${d.key}-${val}`);
      else if (d.type === 'font') vars.push(`--${d.key}:'${val}', Georgia, serif`);
      else vars.push(`--${d.key}:${val}${d.unit || ''}`);
    });
    const body = tpl.html.replace(/\{\{(\w+)\}\}/g, (_, k) => esc(values.fields[k] != null ? values.fields[k] : '').replace(/\n/g, '<br>'));
    const w = tpl.page.width, h = tpl.page.height;
    root.innerHTML = `<style>*{box-sizing:border-box}.t-root{width:${w}in;height:${h}in;transform-origin:top left}.t-page{width:${w}in;height:${h}in;overflow:hidden;position:relative}${tpl.css}</style>
      <div class="t-root ${classes.join(' ')}" style="${vars.join(';')}"><div class="t-page">${body}</div></div>`;
    if (scaleTo) {
      const s = Math.min(scaleTo.w / (w * 96), scaleTo.h / (h * 96));
      root.querySelector('.t-root').style.transform = `scale(${s})`;
      host.style.width = (w * 96 * s) + 'px'; host.style.height = (h * 96 * s) + 'px';
    }
    return root;
  }

  const Designs = {
    async open(designId, extra) {
      await Editor.close();
      if (designId === 'new' && extra) return Designs.edit(null, extra);
      if (designId) return Designs.edit(designId);
      return Designs.gallery();
    },

    async gallery() {
      $('#app').innerHTML = `${App.topbar({ section: 'templates' })}<main class="designs"><h1 class="section-title">Templates</h1>
        <p class="section-sub">Start from a design and make it yours. Change the words, the border, the colors and the lettering, then print it or save it as a PDF.</p>
        <section><h2>Start from a template</h2><div class="tpl-grid"><p class="muted">Loading…</p></div></section>
        <section class="my-designs"></section>
        <footer class="glory">${esc(window.APP_CONFIG.TAGLINE)}</footer></main>`;
      App.bindTopbar();
      let tpls = [];
      try { tpls = await allTemplates(); } catch (e) { $('.tpl-grid').innerHTML = '<p>Templates couldn’t be loaded. Check that the <code>templates</code> folder was uploaded.</p>'; return; }
      $('.tpl-grid').innerHTML = tpls.map(t => `<button class="tpl-card" data-new="${t.id}"><span class="tpl-thumb"><span class="tpl-host" data-host="${t.id}"></span></span>
        <span class="tpl-name">${esc(t.name)}</span><span class="tpl-desc">${esc(t.description)}</span></button>`).join('');
      tpls.forEach(t => draw($(`[data-host="${t.id}"]`), t, defaults(t), { w: 230, h: 230 }));
      const mine = (await Data.entries('design')).filter(d => !d.archived_at).sort((a, b) => (a.updated_at || a.created_at) < (b.updated_at || b.created_at) ? 1 : -1);
      const names = Object.fromEntries(tpls.map(t => [t.id, t.name]));
      $('.my-designs').innerHTML = mine.length ? `<h2>Your designs</h2><div class="tpl-grid">${mine.map(d => `<button class="tpl-card" data-open="${d.id}"><span class="tpl-thumb"><span class="tpl-host" data-mine="${d.id}"></span></span>
        <span class="tpl-name">${esc(d.title || 'Untitled design')}</span><span class="tpl-desc">${esc(names[d.subtype] || '')}</span></button>`).join('')}</div>` : '';
      for (const d of mine) { const t = tpls.find(x => x.id === d.subtype); const host = $(`[data-mine="${d.id}"]`); if (t && host) draw(host, t, Designs.merge(t, d.data && d.data.values), { w: 230, h: 230 }); }
      $('.designs').addEventListener('click', e => {
        const n = e.target.closest('[data-new]'); if (n) return App.go('#/templates/new/' + n.dataset.new);
        const o = e.target.closest('[data-open]'); if (o) App.go('#/templates/' + o.dataset.open);
      });
    },

    merge(tpl, saved) {
      const v = defaults(tpl);
      if (saved) { Object.assign(v.fields, saved.fields || {}); Object.assign(v.design, saved.design || {}); }
      return v;
    },

    async edit(designId, tplId) {
      let design = null;
      if (designId) { design = await DB.get('entries', designId); if (!design || design.user_id !== Data.userId) return App.go('#/templates'); tplId = design.subtype; }
      let tpl;
      try { tpl = await template(tplId); } catch (e) { App.toast('That template couldn’t be found.'); return App.go('#/templates'); }
      S.tpl = tpl; S.design = design; S.dirty = false;
      S.values = Designs.merge(tpl, design && design.data && design.data.values);
      if (!design) {
        // Fill in what we already know
        tpl.fields.forEach(f => { if (f.source === 'prefs.penName' && App.prefs.penName) S.values.fields[f.key] = App.prefs.penName; });
        if (tpl.id === 'scripture-card') {
          const cv = await DB.meta.get('cardVerse');
          if (cv) { S.values.fields.verse = cv.text; S.values.fields.reference = cv.ref; await DB.meta.set('cardVerse', null); }
        }
      }
      const projects = (await Data.projects()).filter(p => !p.archived_at);
      const hasSource = tpl.fields.some(f => f.source && f.source.startsWith('project'));
      $('#app').innerHTML = `${App.topbar({ section: 'templates', mid: `<span class="crumb"><a href="#/templates">Templates</a> / ${esc(tpl.name)}</span>` })}
        <div class="design-ws">
          <aside class="design-panel">
            <input class="design-title" value="${esc(design ? design.title : tpl.name)}" aria-label="Design name">
            <nav class="tabs" role="tablist"><button role="tab" data-tab="content" aria-selected="true">Words</button><button role="tab" data-tab="design" aria-selected="false">Design</button></nav>
            <section class="tabpane" data-pane="content">
              ${hasSource && projects.length ? `<label>Fill in from a project<select data-fill><option value="">Choose a project…</option>${projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>` : ''}
              ${tpl.fields.map(f => f.type === 'textarea'
                ? `<label>${esc(f.label)}<textarea data-field="${f.key}" rows="${f.key === 'verse' || f.key === 'pitch' ? 5 : 3}">${esc(S.values.fields[f.key])}</textarea></label>`
                : `<label>${esc(f.label)}<input data-field="${f.key}" value="${esc(S.values.fields[f.key])}"></label>`).join('')}
            </section>
            <section class="tabpane" data-pane="design" hidden>${tpl.design.map(d => Designs.control(d)).join('')}
              <button class="link small" data-reset>Put the design back to how it started</button></section>
            <div class="design-actions">
              <button class="btn primary" data-print>Print or save as PDF</button>
              ${design ? '<button class="btn quiet small" data-archive>Archive</button>' : ''}
            </div>
            <p class="hint">Changes save on their own.</p>
          </aside>
          <main class="design-stage"><div class="design-host"></div><p class="muted small stage-note">${tpl.page.width} × ${tpl.page.height} inches</p></main>
        </div>`;
      App.bindTopbar();
      Designs.redraw();
      window.addEventListener('resize', Designs.redraw);
      const panel = $('.design-panel');
      panel.addEventListener('input', e => {
        const t = e.target;
        if (t.dataset.field) S.values.fields[t.dataset.field] = t.value;
        else if (t.dataset.d) { const d = tpl.design.find(x => x.key === t.dataset.d); S.values.design[d.key] = d.type === 'range' ? Number(t.value) : t.value; const o = t.parentElement.querySelector('output'); if (o) o.textContent = t.value + (d.unit || ''); }
        else if (!t.classList.contains('design-title')) return;
        Designs.changed();
      });
      panel.addEventListener('change', async e => {
        if ('fill' in e.target.dataset && e.target.value) {
          const p = await DB.get('projects', e.target.value);
          const words = (await Data.nodes(p.id)).filter(n => n.kind === 'doc' && !n.archived_at).reduce((a, n) => a + (n.word_count || 0), 0);
          const round = words >= 10000 ? Math.round(words / 1000) * 1000 : Math.max(100, Math.round(words / 100) * 100);
          tpl.fields.forEach(f => {
            if (f.source === 'project.title') S.values.fields[f.key] = p.title;
            if (f.source === 'project.words') S.values.fields[f.key] = `About ${fmt(round)} words`;
            const inp = $(`[data-field="${f.key}"]`); if (inp) inp.value = S.values.fields[f.key];
          });
          Designs.changed();
        }
      });
      panel.addEventListener('click', async e => {
        const tab = e.target.closest('[data-tab]');
        if (tab) { $$('[data-tab]', panel).forEach(b => b.setAttribute('aria-selected', b === tab)); $$('[data-pane]', panel).forEach(p => p.hidden = p.dataset.pane !== tab.dataset.tab); }
        const sw = e.target.closest('[data-swatch]');
        if (sw) { S.values.design[sw.dataset.key] = sw.dataset.swatch; const inp = $(`[data-d="${sw.dataset.key}"]`); if (inp) inp.value = sw.dataset.swatch; Designs.changed(); }
        const ch = e.target.closest('[data-choice]');
        if (ch) { S.values.design[ch.dataset.key] = ch.dataset.choice; $$(`[data-key="${ch.dataset.key}"][data-choice]`, panel).forEach(b => b.classList.toggle('on', b === ch)); Designs.changed(); }
        if (e.target.closest('[data-reset]')) {
          S.values.design = defaults(tpl).design; const pane = $('[data-pane=design]', panel);
          pane.innerHTML = tpl.design.map(d => Designs.control(d)).join('') + '<button class="link small" data-reset>Put the design back to how it started</button>';
          Designs.changed();
        }
        if (e.target.closest('[data-print]')) { await Designs.save(); Designs.print(); }
        if (e.target.closest('[data-archive]')) {
          if (!(await App.confirm('Archive this design?', 'It will be hidden from Your designs. Nothing is deleted.', 'Archive'))) return;
          S.design.archived_at = Data.nowIso(); await Data.save('entries', S.design, { quiet: true }); App.go('#/templates');
        }
      });
    },

    control(d) {
      const v = S.values.design[d.key];
      if (d.type === 'choice') return `<div class="dctl"><span class="dlabel">${esc(d.label)}</span><div class="choices">${d.options.map(o => `<button type="button" class="choice ${v === o.value ? 'on' : ''}" data-key="${d.key}" data-choice="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div></div>`;
      if (d.type === 'color') return `<div class="dctl"><span class="dlabel">${esc(d.label)}</span><div class="colors"><input type="color" data-d="${d.key}" value="${esc(v)}" aria-label="${esc(d.label)}">
        ${(d.swatches || []).map(s => `<button type="button" class="swatch-dot" data-key="${d.key}" data-swatch="${s}" style="background:${s}" title="${s}"></button>`).join('')}</div></div>`;
      if (d.type === 'range') return `<label class="range">${esc(d.label)} <output>${v}${d.unit || ''}</output><input type="range" data-d="${d.key}" min="${d.min}" max="${d.max}" step="${d.step || 1}" value="${v}"></label>`;
      if (d.type === 'font') return `<label>${esc(d.label)}<select data-d="${d.key}">${FONTS.map(f => `<option ${v === f ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></label>`;
      return '';
    },

    redraw() {
      const host = $('.design-host'); if (!host || !S.tpl) return;
      const stage = $('.design-stage');
      draw(host, S.tpl, S.values, { w: stage.clientWidth - 70, h: stage.clientHeight - 120 });
    },

    changed() {
      Designs.redraw();
      S.dirty = true; clearTimeout(S.saveT); S.saveT = setTimeout(Designs.save, 700);
    },

    async save() {
      clearTimeout(S.saveT);
      if (!S.dirty || !S.tpl) return;
      S.dirty = false;
      const title = ($('.design-title') || {}).value || S.tpl.name;
      const d = S.design || { kind: 'design', subtype: S.tpl.id, sort_order: Date.now() };
      d.title = title; d.data = { values: S.values };
      const saved = await Data.save('entries', d, { quiet: true });
      if (!S.design) { S.design = saved; history.replaceState(null, '', '#/templates/' + saved.id); }
    },

    print() {
      const tpl = S.tpl;
      const w = window.open('', '_blank');
      if (!w) return App.toast('Your browser blocked the print window. Allow pop-ups for this site and try again.');
      const base = location.href.replace(/#.*$/, '').replace(/[^/]*$/, '');
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(($('.design-title') || {}).value || tpl.name)}</title>
        <link rel="stylesheet" href="${base}fonts/fonts.css"><style>@page{size:${tpl.page.width}in ${tpl.page.height}in;margin:0}html,body{margin:0}</style></head><body><div id="h"></div>
        <script>document.fonts.ready.then(()=>setTimeout(()=>print(),400));<\/script></body></html>`);
      w.document.close();
      const host = w.document.getElementById('h');
      draw(host, tpl, S.values, null);
    },

    leave() { window.removeEventListener('resize', Designs.redraw); return Designs.save(); }
  };
  window.Designs = Designs;
})();
