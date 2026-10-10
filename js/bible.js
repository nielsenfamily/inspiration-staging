/* Bible tools: KJV with Strong's numbers, WEB and ASV, search, cross-references, notes.
   All texts are public domain. Data files live in data/bible and are loaded only when needed. */
(function () {
  const { $, $$, esc, fmt } = App;
  const BASE = 'data/bible/';
  const TRANS = { kjv: 'King James Version', web: 'World English Bible', asv: 'American Standard Version' };
  const ABBR = { jn: 'John', jhn: 'John', mt: 'Matt', mk: 'Mark', mrk: 'Mark', lk: 'Luke', ps: 'Ps', psa: 'Ps', psalm: 'Ps', sos: 'Song', songofsongs: 'Song', canticles: 'Song',
    phm: 'Phlm', philem: 'Phlm', jas: 'Jas', jm: 'Jas', jdg: 'Judg', jude: 'Jude', rv: 'Rev', revelations: 'Rev', ez: 'Ezek', eze: 'Ezek', ezr: 'Ezra', dt: 'Deut', nm: 'Num', ex: 'Exod', lv: 'Lev', gn: 'Gen', pr: 'Prov', prv: 'Prov', ecc: 'Eccl', qoh: 'Eccl', is: 'Isa', jr: 'Jer', hb: 'Hab', zp: 'Zeph', zc: 'Zech', ml: 'Mal' };

  const S = { books: null, byId: {}, data: {}, loading: {}, dict: {}, index: null, trans: 'kjv', parallel: '', showNums: false,
    book: 'John', chapter: 1, verse: null, notes: new Map() };

  async function load(name) {
    if (S.data[name]) return S.data[name];
    if (!S.loading[name]) S.loading[name] = fetch(BASE + name + '.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => (S.data[name] = d));
    return S.loading[name];
  }
  async function books() {
    if (!S.books) { S.books = await load('books'); S.books.forEach(b => { S.byId[b.id] = b; }); }
    return S.books;
  }
  const verseText = (t, b, c, v) => {
    const d = S.data[t]; const ch = d && d[b] && d[b][c - 1]; const vv = ch && ch[v - 1];
    if (vv == null) return '';
    return t === 'kjv' ? vv.map(s => s[0]).join(' ') : vv;
  };
  const bookName = (b, single) => (b === 'Ps' && single ? 'Psalm' : (S.byId[b] || { name: b }).name);
  const refLabel = (b, c, v, v2) => `${bookName(b, true)} ${c}${v ? ':' + v + (v2 && v2 !== v ? '–' + v2 : '') : ''}`;
  function parseOsis(r) { // "John.3.16" or "John.3.16-John.3.18"
    const [a, z] = r.split('-'); const [b, c, v] = a.split('.'); const e = z ? z.split('.') : null;
    return { b, c: +c, v: +v || null, v2: e && e[1] == c ? +e[2] : null };
  }

  function parseRef(q) {
    const m = q.trim().toLowerCase().replace(/\s+/g, ' ').match(/^((?:[1-3]\s?)?[a-z][a-z .]*?)\.?\s*(\d+)(?:\s*[:.\s]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
    if (!m) return null;
    const key = m[1].replace(/[\s.]/g, '');
    let book = ABBR[key] ? S.byId[ABBR[key]] : null;
    if (!book) book = S.books.find(b => b.id.toLowerCase() === key || b.name.toLowerCase().replace(/\s/g, '') === key);
    if (!book) book = S.books.find(b => b.name.toLowerCase().replace(/\s/g, '').startsWith(key) || b.id.toLowerCase().startsWith(key));
    if (!book) return null;
    const c = Math.min(+m[2], book.chapters);
    return { b: book.id, c, v: m[3] ? +m[3] : null, v2: m[4] ? +m[4] : null };
  }

  const Bible = {
    async open(ref) {
      await Editor.close();
      const pos = (await DB.meta.get('bible:pos')) || {};
      S.trans = pos.trans || S.trans; S.parallel = pos.parallel || ''; S.showNums = !!pos.showNums;
      $('#app').innerHTML = `${App.topbar({ section: 'bible' })}
        <main class="bible">
          <div class="bible-bar">
            <div class="bb-group">
              <select data-b="book" aria-label="Book"></select>
              <select data-b="chapter" aria-label="Chapter"></select>
              <button class="icon-btn only" data-b="prev" title="Previous chapter">${App.ICON.back}</button>
              <button class="icon-btn only flip" data-b="next" title="Next chapter">${App.ICON.back}</button>
            </div>
            <div class="bb-group">
              <select data-b="trans" aria-label="Translation">${Object.entries(TRANS).map(([k, n]) => `<option value="${k}" ${S.trans === k ? 'selected' : ''}>${n}${k === 'kjv' ? " with Strong's" : ''}</option>`).join('')}</select>
              <select data-b="parallel" aria-label="Side by side"><option value="">Side by side: off</option>${Object.entries(TRANS).map(([k, n]) => `<option value="${k}" ${S.parallel === k ? 'selected' : ''}>Beside: ${k.toUpperCase()}</option>`).join('')}</select>
              <label class="check small"><input type="checkbox" data-b="nums" ${S.showNums ? 'checked' : ''}> Strong's numbers</label>
            </div>
            <form class="bb-search" data-b="search"><input type="search" name="q" placeholder="Search words, a reference (John 3:16), or a number (G25)" aria-label="Search the Bible"><button class="btn small">Search</button></form>
          </div>
          <div class="bible-body">
            <article class="bible-page"><p class="muted">Opening the Bible…</p></article>
            <aside class="bible-panel"></aside>
          </div>
        </main>`;
      App.bindTopbar();
      Bible.bind();
      try {
        await books();
        await Bible.loadNotes();
        let target = ref ? parseOsis(ref) : (pos.book ? { b: pos.book, c: pos.chapter } : { b: 'John', c: 1 });
        if (!S.byId[target.b]) target = { b: 'John', c: 1 };
        $('[data-b=book]').innerHTML = `<optgroup label="Old Testament">${S.books.filter(b => b.testament === 'OT').map(b => `<option value="${b.id}">${b.name}</option>`).join('')}</optgroup>
          <optgroup label="New Testament">${S.books.filter(b => b.testament === 'NT').map(b => `<option value="${b.id}">${b.name}</option>`).join('')}</optgroup>`;
        await Bible.go(target.b, target.c, target.v);
        Bible.panelHome();
      } catch (e) {
        console.error(e);
        $('.bible-page').innerHTML = `<p>The Bible files couldn’t be loaded. Check that the <code>data/bible</code> folder was uploaded, then reload.</p>`;
      }
    },

    bind() {
      const root = $('.bible');
      root.addEventListener('change', e => {
        const t = e.target.dataset.b;
        if (t === 'book') Bible.go(e.target.value, 1);
        if (t === 'chapter') Bible.go(S.book, +e.target.value);
        if (t === 'trans') { S.trans = e.target.value; Bible.go(S.book, S.chapter, S.verse); }
        if (t === 'parallel') { S.parallel = e.target.value; Bible.go(S.book, S.chapter, S.verse); }
        if (t === 'nums') { S.showNums = e.target.checked; Bible.go(S.book, S.chapter, S.verse); }
      });
      root.addEventListener('submit', e => { if (e.target.dataset.b === 'search') { e.preventDefault(); Bible.search(e.target.q.value); } });
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-b]');
        if (b && b.dataset.b === 'prev') return Bible.step(-1);
        if (b && b.dataset.b === 'next') return Bible.step(1);
        const w = e.target.closest('.w[data-s]');
        if (w) { Bible.selectVerse(+w.closest('[data-v]').dataset.v, true); return Bible.word(w.dataset.s.split(' ')[w.dataset.s.split(' ').length - 1], w.textContent); }
        const v = e.target.closest('[data-v]');
        if (v && e.target.closest('.bible-page')) return Bible.selectVerse(+v.dataset.v);
        const go = e.target.closest('[data-go]');
        if (go) { const r = parseOsis(go.dataset.go); return Bible.go(r.b, r.c, r.v); }
        const sn = e.target.closest('[data-strong]');
        if (sn) return Bible.word(sn.dataset.strong);
        const act = e.target.closest('[data-pa]');
        if (act) Bible.panelAction(act.dataset.pa, act);
      });
    },

    async go(b, c, v) {
      const book = S.byId[b]; if (!book) return;
      c = Math.max(1, Math.min(c || 1, book.chapters));
      S.book = b; S.chapter = c; S.verse = v || null;
      DB.meta.set('bible:pos', { book: b, chapter: c, trans: S.trans, parallel: S.parallel, showNums: S.showNums });
      history.replaceState(null, '', `#/bible/${b}.${c}${v ? '.' + v : ''}`);
      $('[data-b=book]').value = b;
      $('[data-b=chapter]').innerHTML = Array.from({ length: book.chapters }, (_, i) => `<option value="${i + 1}" ${i + 1 === c ? 'selected' : ''}>Chapter ${i + 1}</option>`).join('');
      const page = $('.bible-page');
      if (!S.data[S.trans] || (S.parallel && !S.data[S.parallel])) page.innerHTML = `<p class="muted">Opening the ${TRANS[S.trans]}…</p>`;
      await load(S.trans); if (S.parallel) await load(S.parallel);
      const verses = S.data[S.trans][b][c - 1] || [];
      const vHtml = (t, i) => {
        const vv = S.data[t][b][c - 1][i];
        if (vv == null) return '';
        if (t !== 'kjv') return esc(vv);
        return vv.map(sg => sg[1] ? `<span class="w" data-s="${sg[1]}">${esc(sg[0])}</span>${S.showNums ? `<sup class="sn">${sg[1].split(' ').map(n => n.slice(1)).join(' ')}</sup>` : ''}` : esc(sg[0])).join(' ');
      };
      const noteFor = n => S.notes.has(`${b}.${c}.${n}`) ? ' has-note' : '';
      let body;
      if (S.parallel && S.parallel !== S.trans) {
        body = `<table class="bpar"><thead><tr><th>${S.trans.toUpperCase()}</th><th>${S.parallel.toUpperCase()}</th></tr></thead><tbody>
          ${verses.map((_, i) => `<tr class="v${noteFor(i + 1)}" data-v="${i + 1}"><td><sup class="vn">${i + 1}</sup> ${vHtml(S.trans, i)}</td><td><sup class="vn">${i + 1}</sup> ${vHtml(S.parallel, i)}</td></tr>`).join('')}</tbody></table>`;
      } else {
        body = `<div class="bverses">${verses.map((_, i) => `<span class="v${noteFor(i + 1)}" data-v="${i + 1}"><sup class="vn">${i + 1}</sup>${vHtml(S.trans, i)} </span>`).join('')}</div>`;
      }
      page.innerHTML = `<header class="bp-head"><h1>${esc(bookName(b, true))} ${c}</h1><span class="muted">${TRANS[S.trans]}</span></header>${body}
        <nav class="bp-foot"><button class="btn small" data-b="prev">${App.ICON.back} Previous</button><button class="btn small" data-b="next">Next chapter</button></nav>`;
      if (v) Bible.selectVerse(v); else page.scrollTop = 0;
    },

    step(d) {
      const i = S.books.findIndex(x => x.id === S.book);
      let b = S.book, c = S.chapter + d;
      if (c < 1 && i > 0) { b = S.books[i - 1].id; c = S.books[i - 1].chapters; }
      else if (c > S.byId[b].chapters && i < S.books.length - 1) { b = S.books[i + 1].id; c = 1; }
      Bible.go(b, c);
    },

    selectVerse(v, quiet) {
      S.verse = v;
      $$('.bible-page [data-v]').forEach(n => n.classList.toggle('sel', +n.dataset.v === v));
      const el = $(`.bible-page [data-v="${v}"]`);
      if (el && !quiet) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      history.replaceState(null, '', `#/bible/${S.book}.${S.chapter}.${v}`);
      if (!quiet) Bible.panelVerse();
    },

    /* ---------- Study panel ---------- */
    panel(html) { const p = $('.bible-panel'); p.innerHTML = html; p.scrollTop = 0; },
    async panelHome() {
      const notes = [...S.notes.values()].sort((a, b) => (a.updated_at || a.created_at) < (b.updated_at || b.created_at) ? 1 : -1).slice(0, 8);
      Bible.panel(`<h2>Study</h2>
        <p class="muted">Click a verse number to copy it, take notes, or see related verses. In the King James text, click any word to see the Hebrew or Greek behind it.</p>
        ${notes.length ? `<h3>Recent notes</h3><ul class="bnote-list">${notes.map(n => `<li><button class="link" data-go="${n.data.ref}">${esc(refLabel(...Object.values(parseOsis(n.data.ref)).slice(0, 3)))}</button><p>${esc((n.body || '').slice(0, 140))}</p></li>`).join('')}</ul>` : ''}`);
    },
    async panelVerse() {
      const { book: b, chapter: c, verse: v } = S;
      const ref = `${b}.${c}.${v}`;
      const note = S.notes.get(ref);
      Bible.panel(`<h2>${esc(refLabel(b, c, v))}</h2>
        <blockquote class="bquote">${esc(verseText(S.trans, b, c, v))}</blockquote>
        <div class="bp-actions">
          <button class="btn small" data-pa="copy">Copy with reference</button>
          <button class="btn small" data-pa="card">Make a Scripture card</button>
        </div>
        <h3>My note</h3>
        <textarea class="bnote" rows="4" placeholder="Thoughts, connections, ideas for a story…">${esc(note ? note.body : '')}</textarea>
        <h3>Related verses</h3><div class="xrefs"><p class="muted small">Loading…</p></div>`);
      const ta = $('.bnote');
      ta.addEventListener('input', () => { clearTimeout(Bible._nt); Bible._nt = setTimeout(() => Bible.saveNote(ref, ta.value), 600); });
      try {
        const x = await load('xref');
        const list = (x[b] && x[b][`${c}.${v}`]) || [];
        $('.xrefs').innerHTML = list.length ? list.map(r => {
          const p = parseOsis(r);
          return `<button class="xref" data-go="${r.split('-')[0]}"><strong>${esc(refLabel(p.b, p.c, p.v, p.v2))}</strong><span>${esc(verseText(S.trans, p.b, p.c, p.v).slice(0, 160))}</span></button>`;
        }).join('') + '<p class="muted small attrib">Cross-references from OpenBible.info</p>' : '<p class="muted small">No related verses listed.</p>';
      } catch (e) { $('.xrefs').innerHTML = '<p class="muted small">Related verses aren’t available right now.</p>'; }
    },
    async panelAction(a) {
      const { book: b, chapter: c, verse: v } = S;
      const text = verseText(S.trans, b, c, v);
      if (a === 'copy') {
        const s = `“${text}” (${refLabel(b, c, v)}, ${S.trans.toUpperCase()})`;
        try { await navigator.clipboard.writeText(s); App.toast('Copied. Paste it anywhere in your writing.'); }
        catch (e) { App.modal(`<h2>Copy this verse</h2><textarea rows="4" readonly>${esc(s)}</textarea><div class="modal-actions"><span class="spacer"></span><button class="btn primary" data-close>Done</button></div>`); }
      }
      if (a === 'card') {
        await DB.meta.set('cardVerse', { text, ref: `${refLabel(b, c, v)} ${S.trans.toUpperCase()}` });
        App.go('#/templates/new/scripture-card');
      }
      if (a === 'every') Bible.findStrong(S.lastStrong);
    },

    async loadNotes() {
      S.notes = new Map((await Data.entries('bible_note')).filter(n => !n.archived_at && n.data && n.data.ref).map(n => [n.data.ref, n]));
    },
    async saveNote(ref, body) {
      let n = S.notes.get(ref);
      if (!n) { if (!body.trim()) return; n = { kind: 'bible_note', subtype: 'verse', title: ref, data: { ref } }; }
      n.body = body;
      await Data.save('entries', n, { quiet: true });
      S.notes.set(ref, n);
      const [b, c, v] = ref.split('.');
      if (b === S.book && +c === S.chapter) { const el = $(`.bible-page [data-v="${v}"]`); if (el) el.classList.toggle('has-note', !!body.trim()); }
    },

    async word(num, shown) {
      const lang = num[0] === 'H' ? 'hebrew' : 'greek';
      Bible.panel(`<h2>${esc(num)}</h2><p class="muted">Looking it up…</p>`);
      const d = await load('strongs-' + lang);
      const e = d[num];
      S.lastStrong = num;
      if (!e) return Bible.panel(`<h2>${esc(num)}</h2><p class="muted">No entry for this number.</p>`);
      const idx = S.index ? (S.index[num] || []).length : null;
      const linkify = s => esc(s || '').replace(/\b([HG]\d+)\b/g, '<button class="link" data-strong="$1">$1</button>');
      Bible.panel(`<p class="muted small">${shown ? '“' + esc(shown) + '” ' : ''}Strong’s ${esc(num)}, ${lang === 'hebrew' ? 'Hebrew' : 'Greek'}</p>
        <h2 class="lemma" ${lang === 'hebrew' ? 'dir="rtl" lang="he"' : 'lang="grc"'}>${esc(e.l)}</h2>
        <p class="translit">${esc(e.x)}${e.p ? ` <span class="muted">(${esc(e.p)})</span>` : ''}</p>
        <h3>Meaning</h3><p>${linkify(e.d)}</p>
        ${e.k ? `<h3>Translated in the KJV as</h3><p>${linkify(e.k)}</p>` : ''}
        ${e.v ? `<h3>Root</h3><p>${linkify(e.v)}</p>` : ''}
        <button class="btn small primary" data-pa="every">Find every verse with this word${idx != null ? ` (${fmt(idx)})` : ''}</button>
        <p class="muted small attrib">Strong’s dictionary, public domain. Text tagging from the CrossWire KJV.</p>`);
    },

    async findStrong(num) {
      Bible.panel(`<h2>${esc(num)}</h2><p class="muted">Searching…</p>`);
      if (!S.index) S.index = await load('strongs-index');
      await load('kjv');
      const refs = S.index[num] || [];
      Bible.results(`Every verse with ${num}`, refs.map(r => { const p = parseOsis(r); return { r, p, text: verseText('kjv', p.b, p.c, p.v), mark: num }; }));
    },

    async search(q) {
      q = (q || '').trim(); if (!q) return;
      if (/^[HG]\d+$/i.test(q)) return Bible.findStrong(q.toUpperCase().replace(/^([HG])0*/, '$1'));
      const ref = parseRef(q);
      if (ref) return Bible.go(ref.b, ref.c, ref.v);
      Bible.panel(`<h2>Searching…</h2>`);
      await load(S.trans);
      const phrase = q.match(/^"(.+)"$/);
      const terms = phrase ? [phrase[1].toLowerCase()] : q.toLowerCase().split(/\s+/).filter(Boolean);
      const out = [];
      for (const bk of S.books) {
        const chs = S.data[S.trans][bk.id];
        chs.forEach((vs, ci) => vs.forEach((_, vi) => {
          const t = verseText(S.trans, bk.id, ci + 1, vi + 1);
          const low = t.toLowerCase();
          if (terms.every(w => low.includes(w))) out.push({ r: `${bk.id}.${ci + 1}.${vi + 1}`, p: { b: bk.id, c: ci + 1, v: vi + 1 }, text: t, terms });
        }));
      }
      Bible.results(`“${q}” in the ${S.trans.toUpperCase()}`, out);
    },

    results(title, list) {
      const shown = list.slice(0, 250);
      const hi = (t, terms) => { let h = esc(t); (terms || []).forEach(w => { if (w.length > 1) h = h.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); }); return h; };
      Bible.panel(`<h2>${esc(title)}</h2><p class="muted">${fmt(list.length)} verse${list.length === 1 ? '' : 's'}${list.length > shown.length ? `, showing the first ${shown.length}` : ''}</p>
        <div class="bresults">${shown.map(x => `<button class="xref" data-go="${x.r}"><strong>${esc(refLabel(x.p.b, x.p.c, x.p.v))}</strong><span>${hi(x.text, x.terms)}</span></button>`).join('') || '<p class="muted">Nothing found. Try fewer words.</p>'}</div>`);
    }
  };

  window.Bible = Bible;
})();
