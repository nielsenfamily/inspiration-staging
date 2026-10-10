/* Writing check: spelling and grammar with Harper, which runs entirely on this device (nothing is sent anywhere).
   Names in the Story Atlas and words in the project dictionary are never flagged. */
(function () {
  const { $, $$, esc, fmt } = App;
  let linter = null, loading = null, mod = null;
  let lints = [], text = '';

  async function ensure() {
    if (linter) return linter;
    if (!loading) loading = (async () => {
      mod = await import(new URL('lib/harper/index.js', location.href).href);
      const bin = await import(new URL('lib/harper/binary.js', location.href).href);
      const l = new mod.LocalLinter({ binary: bin.binary, dialect: mod.Dialect.American });
      await l.setup();
      linter = l;
      return l;
    })();
    return loading;
  }

  // Editor text with each embed (scene break) counted as one character, so positions match the editor
  function editorText(q) {
    return q.getContents().ops.map(op => typeof op.insert === 'string' ? op.insert : '\n').join('');
  }

  const Grammar = {
    async open() {
      const st = Editor.state;
      if (!st.quill) return App.toast('Open a document to check its writing.');
      const ws = $('.ws');
      if (ws.classList.contains('no-inspector')) { st.inspector = true; ws.classList.remove('no-inspector'); }
      const box = $('.inspector');
      box.innerHTML = `<div class="insp-sec"><div class="insp-head"><h3>Writing check</h3><button class="btn small" data-g="close">Done</button></div>
        <p class="muted small">${linter ? 'Checking…' : 'Getting the checker ready. The first time takes a moment.'}</p></div>`;
      box.onclick = Grammar.onClick;
      try {
        await ensure();
        await Grammar.run();
      } catch (e) {
        console.error(e);
        box.innerHTML = `<div class="insp-sec"><div class="insp-head"><h3>Writing check</h3><button class="btn small" data-g="close">Done</button></div>
          <p>The checker couldn’t start on this device${navigator.onLine ? '' : ' while offline (it needs to be opened once with internet)'}. Your writing is fine; try again later.</p></div>`;
      }
    },

    async run() {
      const st = Editor.state, q = st.quill;
      if (!q) return;
      await Editor.flush();
      await linter.clearWords();
      const words = await Atlas.wordsFor(st.project.id);
      if (words.length) await linter.importWords(words);
      text = editorText(q);
      const raw = await linter.lint(text, { language: 'plaintext' });
      lints = raw.map((l, i) => {
        const sp = l.span();
        return { i, lint: l, start: sp.start, end: sp.end, problem: l.get_problem_text(), message: l.message(), kind: l.lint_kind_pretty(), rawKind: l.lint_kind(),
          sugg: l.suggestions().slice(0, 3).map(s => ({ s, kind: s.kind(), text: s.get_replacement_text() })) };
      }).sort((a, b) => a.start - b.start);
      Grammar.render();
    },

    render() {
      const box = $('.inspector'); if (!box) return;
      const ctx = l => {
        const a = Math.max(0, l.start - 40), z = Math.min(text.length, l.end + 40);
        return `${a > 0 ? '…' : ''}${esc(text.slice(a, l.start).replace(/\n/g, ' '))}<mark>${esc(text.slice(l.start, l.end))}</mark>${esc(text.slice(l.end, z).replace(/\n/g, ' '))}${z < text.length ? '…' : ''}`;
      };
      const label = s => s.kind === 1 ? 'Remove' : s.kind === 2 ? `Add “${s.text}”` : (s.text ? s.text : 'Remove');
      box.innerHTML = `<div class="insp-sec"><div class="insp-head"><h3>Writing check</h3><button class="btn small" data-g="close">Done</button></div>
        <p class="muted small">${lints.length ? `${fmt(lints.length)} thing${lints.length === 1 ? '' : 's'} to look at. Click one to find it on the page.` : 'Nothing flagged. Lovely.'}</p>
        <div class="g-actions"><button class="link small" data-g="rerun">Check again</button><button class="link small" data-g="dict">Project dictionary</button></div></div>
        <ul class="g-list">${lints.map(l => `<li class="g-item" data-gi="${l.i}">
          <div class="g-top"><span class="tag">${esc(l.kind)}</span></div>
          <p class="g-msg">${esc(l.message)}</p>
          <p class="g-ctx">${ctx(l)}</p>
          <div class="g-btns">${l.sugg.map((s, j) => `<button class="btn small primary" data-g="fix" data-j="${j}">${esc(label(s))}</button>`).join('')}
            ${/spell/i.test(l.rawKind) || /spell/i.test(l.kind) ? `<button class="btn small" data-g="learn">Add to dictionary</button>` : ''}
            <button class="btn small quiet" data-g="ignore">Ignore</button></div></li>`).join('')}</ul>`;
    },

    async onClick(e) {
      const b = e.target.closest('[data-g]');
      const item = e.target.closest('[data-gi]');
      const l = item ? lints.find(x => x.i === +item.dataset.gi) : null;
      const q = Editor.state.quill;
      if (!b && l && q) { q.setSelection(l.start, l.end - l.start, 'user'); const bnd = q.getBounds(l.start); $('.desk-scroll').scrollTop += bnd.top - 200; return; }
      if (!b) return;
      const act = b.dataset.g;
      if (act === 'close') return Editor.renderInspector();
      if (act === 'rerun') return Grammar.run();
      if (act === 'dict') return Grammar.dictionary();
      if (!l || !q) return;
      if (act === 'fix') {
        // make sure the text hasn't moved since the check
        if (editorText(q).slice(l.start, l.end) !== text.slice(l.start, l.end)) return Grammar.run();
        const s = l.sugg[+b.dataset.j];
        if (s.kind === 2) q.insertText(l.end, s.text, 'user');
        else { q.deleteText(l.start, l.end - l.start, 'user'); if (s.kind === 0 && s.text) q.insertText(l.start, s.text, 'user'); }
        return Grammar.run();
      }
      if (act === 'ignore') { await linter.ignoreLint(text, l.lint); lints = lints.filter(x => x !== l); return Grammar.render(); }
      if (act === 'learn') {
        const word = l.problem.trim();
        const p = Editor.state.project;
        p.dictionary = Array.from(new Set([...(p.dictionary || []), word]));
        await Data.save('projects', p, { quiet: true });
        App.toast('“' + word + '” added to this project’s dictionary.');
        return Grammar.run();
      }
    },

    async dictionary() {
      const p = Editor.state.project;
      const atlasWords = (await Atlas.wordsFor(p.id)).filter(w => !(p.dictionary || []).includes(w));
      const m = App.modal(`<h2>Project dictionary</h2>
        <p class="muted">Words here are never flagged in <em>${esc(p.title)}</em>. Names from the Story Atlas are included automatically.</p>
        <form class="inline-form" id="dict-add"><label>Add a word<input name="w" autocomplete="off"></label><button class="btn">Add</button></form>
        <ul class="dict-list">${(p.dictionary || []).map(w => `<li><span>${esc(w)}</span><button class="link small" data-rm="${esc(w)}">Remove</button></li>`).join('') || '<li class="muted">No words yet.</li>'}</ul>
        ${atlasWords.length ? `<h3>From the Story Atlas</h3><p class="muted small">${atlasWords.map(esc).join(', ')}</p>` : ''}
        <div class="modal-actions"><span class="spacer"></span><button class="btn primary" data-close>Done</button></div>`, { onClose: () => { if (linter && Editor.state.quill) Grammar.run(); } });
      $('#dict-add', m.el).addEventListener('submit', async e => {
        e.preventDefault(); const w = e.target.w.value.trim(); if (!w) return;
        p.dictionary = Array.from(new Set([...(p.dictionary || []), w])); await Data.save('projects', p, { quiet: true });
        m.close(); Grammar.dictionary();
      });
      m.el.addEventListener('click', async e => {
        const rm = e.target.closest('[data-rm]'); if (!rm) return;
        p.dictionary = (p.dictionary || []).filter(w => w !== rm.dataset.rm); await Data.save('projects', p, { quiet: true });
        m.close(); Grammar.dictionary();
      });
    }
  };
  window.Grammar = Grammar;
})();
