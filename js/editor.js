/* The writing workspace: binder (project outline), page editor, and inspector. */
(function () {
  const { $, $$, esc, fmt, ICON } = App;
  const LABELS = ['', 'Idea', 'To do', 'First draft', 'Revised', 'Final'];
  const SNAP_EVERY_MS = 2 * 60 * 60 * 1000;

  // Scene break: a centered ornament between scenes
  const BlockEmbed = Quill.import('blots/block/embed');
  class SceneBreak extends BlockEmbed { }
  SceneBreak.blotName = 'scenebreak'; SceneBreak.tagName = 'hr'; SceneBreak.className = 'scene-break';
  Quill.register(SceneBreak);

  const S = {
    project: null, nodes: new Map(), current: null, quill: null,
    dirty: false, metaDirty: false, saveT: null, metaT: null, lastCount: 0, lastSnapAt: 0,
    openFolders: new Set(), showArchived: false, binder: true, inspector: true, unsub: null, keyHandler: null
  };

  const Editor = {
    get state() { return S; },

    async open(projectId, nodeId) {
      const project = await DB.get('projects', projectId);
      if (!project || project.user_id !== Data.userId) { App.toast('That project couldn’t be found on this device.'); return App.go('#/'); }
      // Re-opening the same project with a different document: just switch documents
      if (S.project && S.project.id === projectId && $('.ws')) {
        await Editor.flush();
        S.project = project;
        const pn = $('.proj-name'); if (pn) pn.textContent = project.title;
        if (project.archived_at) return App.go('#/');
        return Editor.select(nodeId || await Editor.defaultNodeId());
      }
      await Editor.close();
      S.project = project;
      S.nodes = new Map((await Data.nodes(projectId)).map(n => [n.id, n]));
      S.openFolders = new Set((await DB.meta.get('open:' + projectId)) || [...S.nodes.values()].filter(n => n.kind === 'folder' && !n.parent_id).map(n => n.id));
      const narrow = innerWidth < 900;
      S.binder = narrow ? false : (await DB.meta.get('ws:binder')) !== false;
      S.inspector = narrow ? false : (await DB.meta.get('ws:inspector')) !== false;
      Editor.renderShell();
      Editor.renderBinder();
      S.unsub = Data.onChange(Editor.onDataChange);
      S.keyHandler = Editor.onKey;
      document.addEventListener('keydown', S.keyHandler);
      window.addEventListener('beforeunload', Editor.flushSync);
      Editor.select(nodeId || await Editor.defaultNodeId());
    },

    async defaultNodeId() {
      const last = await DB.meta.get('lastNode:' + S.project.id);
      if (last && S.nodes.has(last) && !S.nodes.get(last).archived_at) return last;
      const docs = Editor.ordered().filter(n => n.kind === 'doc');
      return docs.length ? docs[0].id : null;
    },

    async close() {
      if (!S.project) return;
      await Editor.flush();
      if (S.unsub) S.unsub();
      document.removeEventListener('keydown', S.keyHandler);
      window.removeEventListener('beforeunload', Editor.flushSync);
      document.body.classList.remove('focus-mode');
      S.project = null; S.current = null; S.quill = null; S.nodes = new Map();
    },

    /* ---------------- Layout ---------------- */
    renderShell() {
      const p = S.project;
      $('#app').innerHTML = `<div class="ws ${S.binder ? '' : 'no-binder'} ${S.inspector ? '' : 'no-inspector'}">
        ${App.topbar({
          cls: 'ws-top',
          left: `<a class="icon-btn" href="#/" title="Back to your shelf">${ICON.shelf}<span>Library</span></a>
                 <button class="icon-btn only" data-ws="toggle-binder" title="Show or hide the outline">${ICON.panel}</button>
                 <button class="proj-name" data-ws="project" title="Project details">${esc(p.title)}</button>`,
          mid: Atlas.switcher(p.id, 'manuscript'),
          right: `<button class="icon-btn" data-ws="focus" title="Focus mode (Ctrl+Shift+F)">${ICON.focus}<span>Focus</span></button>
                  <button class="icon-btn only" data-ws="toggle-inspector" title="Show or hide notes and history">${ICON.panel}</button>`
        })}
        <div class="ws-body">
          <aside class="binder" aria-label="Project outline">
            <div class="binder-head">
              <button class="btn small" data-ws="new-doc">${ICON.plus} Document</button>
              <button class="btn small quiet" data-ws="new-folder">${ICON.plus} Folder</button>
            </div>
            <div class="tree" role="tree"></div>
            <div class="binder-foot"><button class="link small" data-ws="archived"></button></div>
          </aside>
          <main class="desk">
            <div class="desk-scroll"><div class="page-col"></div></div>
            <footer class="statusbar"></footer>
          </main>
          <aside class="inspector" aria-label="Notes and history"></aside>
        </div>
        <div class="focus-exit"><span class="fx-words"></span><button class="btn small" data-ws="focus">Leave focus</button></div>
      </div>`;
      const root = $('.ws');
      App.bindTopbar();
      root.addEventListener('click', Editor.onClick);
      Editor.bindTree();
    },

    async onClick(e) {
      const b = e.target.closest('[data-ws]');
      if (!b) return;
      const a = b.dataset.ws;
      if (a === 'toggle-binder') { S.binder = !S.binder; $('.ws').classList.toggle('no-binder', !S.binder); DB.meta.set('ws:binder', S.binder); }
      else if (a === 'toggle-inspector') { S.inspector = !S.inspector; $('.ws').classList.toggle('no-inspector', !S.inspector); DB.meta.set('ws:inspector', S.inspector); }
      else if (a === 'focus') Editor.toggleFocus();
      else if (a === 'project') { await Editor.flush(); App.editProject(S.project.id); }
      else if (a === 'new-doc') Editor.addNode('doc');
      else if (a === 'new-folder') Editor.addNode('folder');
      else if (a === 'archived') { S.showArchived = !S.showArchived; Editor.renderBinder(); }
    },

    toggleFocus(force) {
      const on = force != null ? force : !document.body.classList.contains('focus-mode');
      document.body.classList.toggle('focus-mode', on);
      if (on && S.quill) S.quill.focus();
      Editor.paintStatus();
    },

    onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); Editor.toggleFocus(); }
      else if (e.key === 'Escape' && document.body.classList.contains('focus-mode') && !$('.modal-wrap')) Editor.toggleFocus(false);
      else if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); Editor.flush().then(() => App.toast('Saved.', 1500)); }
      else if (mod && e.altKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); Editor.addNode('doc'); }
    },

    /* ---------------- Binder ---------------- */
    children(parentId, archived) {
      return [...S.nodes.values()]
        .filter(n => (n.parent_id || null) === (parentId || null) && (archived ? true : !n.archived_at))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    },
    ordered() {
      const out = [];
      const walk = pid => Editor.children(pid).forEach(n => { out.push(n); if (n.kind === 'folder') walk(n.id); });
      walk(null);
      return out;
    },
    folderWords(id) {
      return Editor.children(id).reduce((a, n) => a + (n.kind === 'folder' ? Editor.folderWords(n.id) : (n.word_count || 0)), 0);
    },
    projectWords() { return Editor.ordered().filter(n => n.kind === 'doc').reduce((a, n) => a + (n.word_count || 0), 0); },

    renderBinder() {
      const tree = $('.tree');
      if (!tree || S.renaming) return;
      const row = (n, depth) => {
        const isF = n.kind === 'folder';
        const open = S.openFolders.has(n.id);
        const kids = isF ? Editor.children(n.id) : [];
        const words = isF ? Editor.folderWords(n.id) : (n.word_count || 0);
        return `<div class="tn ${isF ? 'folder' : 'doc'} ${S.current && S.current.id === n.id ? 'on' : ''}" role="treeitem" ${isF ? `aria-expanded="${open}"` : ''}
            data-id="${n.id}" draggable="true" style="--depth:${depth}" tabindex="-1">
            ${isF ? `<button class="caret ${open ? 'open' : ''}" data-caret tabindex="-1" aria-label="${open ? 'Collapse' : 'Expand'}">${ICON.chevron}</button>` : '<span class="caret-pad"></span>'}
            <span class="tn-icon">${isF ? ICON.folder : ICON.doc}</span>
            <span class="tn-title">${esc(n.title || 'Untitled')}</span>
            ${n.label ? `<span class="tn-label" title="${esc(n.label)}">${esc(n.label)}</span>` : ''}
            <span class="tn-words">${words ? fmt(words) : ''}</span>
            <button class="tn-more" data-more tabindex="-1" aria-label="More actions">${ICON.more}</button>
          </div>${isF && open ? kids.map(k => row(k, depth + 1)).join('') : ''}`;
      };
      const top = Editor.children(null);
      tree.innerHTML = top.length ? top.map(n => row(n, 0)).join('') : `<p class="tree-empty">Add a document to begin.</p>`;

      const archived = [...S.nodes.values()].filter(n => n.archived_at && !(n.parent_id && S.nodes.get(n.parent_id) && S.nodes.get(n.parent_id).archived_at));
      const foot = $('[data-ws=archived]');
      foot.textContent = archived.length ? (S.showArchived ? 'Hide archived items' : `Archived items (${archived.length})`) : '';
      if (S.showArchived && archived.length) {
        tree.insertAdjacentHTML('beforeend', `<div class="archived-list"><h4>Archived</h4>${archived.map(n =>
          `<div class="arch-row"><span>${esc(n.title || 'Untitled')}</span><button class="link small" data-restore="${n.id}">Restore</button></div>`).join('')}</div>`);
      }
    },

    bindTree() {
      const tree = $('.tree');
      tree.addEventListener('click', async e => {
        const restore = e.target.closest('[data-restore]');
        if (restore) return Editor.restoreNode(restore.dataset.restore);
        const tn = e.target.closest('.tn');
        if (!tn) return;
        const id = tn.dataset.id;
        if (e.target.closest('[data-caret]')) return Editor.toggleFolder(id);
        if (e.target.closest('[data-more]')) return Editor.nodeMenu(id, e.target.closest('[data-more]'));
        // two quick clicks on the same item = rename (works even while the outline redraws)
        const now = Date.now(), last = Editor._lastClick;
        Editor._lastClick = { id, t: now };
        if (last && last.id === id && now - last.t < 450 && !e.target.closest('button')) { Editor._lastClick = null; return Editor.renameInline(id); }
        if (S.current && S.current.id === id) return; // already open (and keeps a double-click rename steady)
        await Editor.flush();
        App.go('#/project/' + S.project.id + '/' + id);
        if (innerWidth < 900) { S.binder = false; $('.ws').classList.add('no-binder'); }
      });
      tree.addEventListener('dblclick', e => { const tn = e.target.closest('.tn'); if (tn && !e.target.closest('button')) Editor.renameInline(tn.dataset.id); });
      tree.addEventListener('contextmenu', e => { const tn = e.target.closest('.tn'); if (tn) { e.preventDefault(); Editor.nodeMenu(tn.dataset.id, tn, e); } });
      tree.addEventListener('keydown', e => {
        const tn = e.target.closest('.tn'); if (!tn) return;
        const rows = $$('.tn', tree), i = rows.indexOf(tn);
        if (e.key === 'ArrowDown' && rows[i + 1]) { e.preventDefault(); rows[i + 1].focus(); }
        else if (e.key === 'ArrowUp' && rows[i - 1]) { e.preventDefault(); rows[i - 1].focus(); }
        else if (e.key === 'Enter') tn.click();
        else if (e.key === 'F2') Editor.renameInline(tn.dataset.id);
        else if (e.key === 'ArrowRight' && tn.classList.contains('folder') && !S.openFolders.has(tn.dataset.id)) Editor.toggleFolder(tn.dataset.id);
        else if (e.key === 'ArrowLeft' && tn.classList.contains('folder') && S.openFolders.has(tn.dataset.id)) Editor.toggleFolder(tn.dataset.id);
      });

      // Drag to reorder or move into folders
      let dragId = null;
      tree.addEventListener('dragstart', e => { const tn = e.target.closest('.tn'); if (!tn) return; dragId = tn.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); tn.classList.add('dragging'); });
      tree.addEventListener('dragend', () => { dragId = null; $$('.tn', tree).forEach(t => t.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-into')); });
      const zone = (tn, e) => {
        const r = tn.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
        if (tn.classList.contains('folder') && y > 0.28 && y < 0.72) return 'into';
        return y < 0.5 ? 'before' : 'after';
      };
      tree.addEventListener('dragover', e => {
        const tn = e.target.closest('.tn'); if (!tn || !dragId || tn.dataset.id === dragId) return;
        e.preventDefault();
        $$('.tn', tree).forEach(t => t.classList.remove('drop-before', 'drop-after', 'drop-into'));
        tn.classList.add('drop-' + zone(tn, e));
      });
      tree.addEventListener('drop', async e => {
        const tn = e.target.closest('.tn'); if (!tn || !dragId) return;
        e.preventDefault();
        await Editor.moveNode(dragId, tn.dataset.id, zone(tn, e));
      });
    },

    toggleFolder(id) {
      if (S.openFolders.has(id)) S.openFolders.delete(id); else S.openFolders.add(id);
      DB.meta.set('open:' + S.project.id, [...S.openFolders]);
      Editor.renderBinder();
    },

    isInside(id, ancestorId) {
      let n = S.nodes.get(id);
      while (n && n.parent_id) { if (n.parent_id === ancestorId) return true; n = S.nodes.get(n.parent_id); }
      return false;
    },

    async moveNode(id, targetId, where) {
      const n = S.nodes.get(id), t = S.nodes.get(targetId);
      if (!n || !t || id === targetId || Editor.isInside(targetId, id)) return;
      if (where === 'into') {
        const kids = Editor.children(t.id);
        n.parent_id = t.id;
        n.sort_order = kids.length ? (kids[kids.length - 1].sort_order || 0) + 1 : 1;
        S.openFolders.add(t.id);
      } else {
        const sibs = Editor.children(t.parent_id).filter(s => s.id !== id);
        const i = sibs.findIndex(s => s.id === t.id);
        const before = where === 'before' ? sibs[i - 1] : sibs[i];
        const after = where === 'before' ? sibs[i] : sibs[i + 1];
        const a = before ? (before.sort_order || 0) : (after ? (after.sort_order || 0) - 2 : 0);
        const b = after ? (after.sort_order || 0) : a + 2;
        n.parent_id = t.parent_id || null;
        n.sort_order = (a + b) / 2;
      }
      await Data.save('nodes', n, { quiet: true });
      Editor.renderBinder();
    },

    async addNode(kind, parentOverride) {
      await Editor.flush();
      let parent = null, order;
      const cur = S.current;
      if (parentOverride !== undefined) parent = parentOverride;
      else if (cur && cur.kind === 'folder') parent = cur.id;
      else if (cur) parent = cur.parent_id || null;
      else { const ms = Editor.children(null).find(n => n.kind === 'folder'); parent = ms ? ms.id : null; }
      const sibs = Editor.children(parent);
      if (cur && cur.kind === 'doc' && (cur.parent_id || null) === parent && parentOverride === undefined) {
        const i = sibs.findIndex(s => s.id === cur.id);
        const next = sibs[i + 1];
        order = next ? ((cur.sort_order || 0) + (next.sort_order || 0)) / 2 : (cur.sort_order || 0) + 1;
      } else order = sibs.length ? (sibs[sibs.length - 1].sort_order || 0) + 1 : 1;
      const n = await Data.save('nodes', {
        project_id: S.project.id, parent_id: parent, kind, sort_order: order,
        title: kind === 'folder' ? 'New folder' : 'Untitled', content: null, plain: '', word_count: 0
      }, { quiet: true });
      S.nodes.set(n.id, n);
      if (parent) S.openFolders.add(parent);
      App.go('#/project/' + S.project.id + '/' + n.id);
      setTimeout(() => { const t = $('.doc-title'); if (t) { t.focus(); t.select(); } }, 60);
    },

    nodeMenu(id, anchor, ev) {
      const n = S.nodes.get(id);
      const items = [['rename', 'Rename']];
      if (n.kind === 'folder') items.push(['add-doc', 'New document inside'], ['add-folder', 'New folder inside']);
      items.push(['up', 'Move up'], ['down', 'Move down'], ['archive', 'Archive']);
      Editor.popMenu(anchor, ev, items, async act => {
        if (act === 'rename') Editor.renameInline(id);
        else if (act === 'add-doc') { S.openFolders.add(id); Editor.addNode('doc', id); }
        else if (act === 'add-folder') { S.openFolders.add(id); Editor.addNode('folder', id); }
        else if (act === 'up' || act === 'down') {
          const sibs = Editor.children(n.parent_id); const i = sibs.findIndex(s => s.id === id);
          const j = act === 'up' ? i - 1 : i + 1;
          if (sibs[j]) await Editor.moveNode(id, sibs[j].id, act === 'up' ? 'before' : 'after');
        } else if (act === 'archive') Editor.archiveNode(id);
      });
    },

    popMenu(anchor, ev, items, onPick) {
      $$('.pop-menu').forEach(m => m.remove());
      const m = document.createElement('div');
      m.className = 'pop-menu'; m.setAttribute('role', 'menu');
      m.innerHTML = items.map(([a, l]) => `<button role="menuitem" data-a="${a}">${esc(l)}</button>`).join('');
      document.body.appendChild(m);
      const r = anchor.getBoundingClientRect();
      const x = ev && ev.clientX ? ev.clientX : r.right - 4, y = ev && ev.clientY ? ev.clientY : r.bottom + 2;
      m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px';
      m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
      m.querySelector('button').focus();
      const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } };
      setTimeout(() => document.addEventListener('mousedown', off, true), 0);
      m.addEventListener('keydown', e => { if (e.key === 'Escape') m.remove(); });
      m.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) { m.remove(); onPick(b.dataset.a); } });
    },

    renameInline(id, tries) {
      const tn = $(`.tn[data-id="${id}"] .tn-title`);
      const n = S.nodes.get(id);
      if (!n) return;
      if (!tn) { if ((tries || 0) < 5) setTimeout(() => Editor.renameInline(id, (tries || 0) + 1), 60); return; }
      if (S.renaming) return;
      S.renaming = true;
      const input = document.createElement('input');
      input.className = 'tn-rename'; input.value = n.title || '';
      tn.replaceWith(input); input.focus(); input.select();
      let done = false;
      const finish = async save => {
        if (done) return; done = true; S.renaming = false;
        if (save && input.value.trim() && input.value.trim() !== n.title) {
          n.title = input.value.trim();
          await Data.save('nodes', n, { quiet: true });
          if (S.current && S.current.id === id) { const t = $('.doc-title'); if (t) t.value = n.title; }
        }
        Editor.renderBinder();
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
      input.addEventListener('blur', () => finish(true));
    },

    async archiveNode(id) {
      const n = S.nodes.get(id);
      await Editor.flush();
      n.archived_at = Data.nowIso();
      await Data.save('nodes', n, { quiet: true });
      App.toast('“' + (n.title || 'Untitled') + '” archived. You can restore it from the bottom of the outline.');
      if (S.current && (S.current.id === id || Editor.isInside(S.current.id, id))) {
        S.current = null;
        App.go('#/project/' + S.project.id + '/' + (await Editor.defaultNodeId() || ''));
      }
      Editor.renderBinder();
    },

    async restoreNode(id) {
      const n = S.nodes.get(id);
      n.archived_at = null;
      if (n.parent_id && (!S.nodes.has(n.parent_id) || S.nodes.get(n.parent_id).archived_at)) n.parent_id = null;
      await Data.save('nodes', n, { quiet: true });
      App.toast('“' + (n.title || 'Untitled') + '” restored.');
      Editor.renderBinder();
    },

    /* ---------------- Selecting a document or folder ---------------- */
    async select(id) {
      const n = id ? S.nodes.get(id) : null;
      S.current = n || null;
      S.dirty = false;
      if (n) {
        DB.meta.set('lastNode:' + S.project.id, n.id);
        DB.meta.set('lastOpened:' + Data.userId, { projectId: S.project.id, nodeId: n.id });
        // open its parent folders so it is visible
        let p = n.parent_id; while (p) { S.openFolders.add(p); p = (S.nodes.get(p) || {}).parent_id; }
      }
      Editor.renderBinder();
      const col = $('.page-col');
      if (!n) {
        S.quill = null;
        col.innerHTML = `<div class="page empty-page"><h2>${esc(S.project.title)}</h2><p>Choose a document from the outline, or add one to begin.</p>
          <button class="btn primary" data-ws="new-doc">${ICON.plus} New document</button></div>`;
        Editor.renderInspector(); Editor.paintStatus();
        return;
      }
      if (n.kind === 'folder') { S.quill = null; Editor.renderFolder(n); Editor.renderInspector(); Editor.paintStatus(); return; }

      col.innerHTML = `
        <div class="toolbar" id="tb" role="toolbar" aria-label="Formatting">
          <span class="tb-group">
            <select class="ql-header" title="Paragraph style"><option selected>Body text</option><option value="1">Chapter title</option><option value="2">Heading</option><option value="3">Subheading</option></select>
          </span>
          <span class="tb-group">
            <button class="ql-bold" title="Bold (Ctrl+B)"><b>B</b></button>
            <button class="ql-italic" title="Italic (Ctrl+I)"><i>I</i></button>
            <button class="ql-underline" title="Underline (Ctrl+U)"><u>U</u></button>
            <button class="ql-strike" title="Strikethrough"><s>S</s></button>
          </span>
          <span class="tb-group">
            <button class="ql-align" value="" title="Align left">${TB.left}</button>
            <button class="ql-align" value="center" title="Center">${TB.center}</button>
            <button class="ql-align" value="right" title="Align right">${TB.right}</button>
            <button class="ql-align" value="justify" title="Justify">${TB.justify}</button>
          </span>
          <span class="tb-group">
            <button class="ql-list" value="bullet" title="Bulleted list">${TB.bullet}</button>
            <button class="ql-list" value="ordered" title="Numbered list">${TB.ordered}</button>
            <button class="ql-blockquote" title="Block quote">${TB.quote}</button>
            <button class="ql-scenebreak" title="Scene break">${TB.scene}</button>
          </span>
          <span class="tb-group">
            <button class="ql-clean" title="Clear formatting">${TB.clean}</button>
            <button class="tb-undo" title="Undo (Ctrl+Z)">${TB.undo}</button>
            <button class="tb-redo" title="Redo (Ctrl+Y)">${TB.redo}</button>
          </span>
          <span class="tb-group">
            <button class="tb-check" title="Check spelling and grammar">${TB.check}<span>Check</span></button>
          </span>
        </div>
        <article class="page">
          <input class="doc-title" value="${esc(n.title || '')}" placeholder="Untitled" aria-label="Document title" maxlength="200">
          <div id="quill"></div>
        </article>`;

      const q = new Quill('#quill', {
        modules: {
          toolbar: { container: '#tb', handlers: { scenebreak() { Editor.insertSceneBreak(); } } },
          history: { delay: 800, maxStack: 500, userOnly: true }
        },
        formats: ['bold', 'italic', 'underline', 'strike', 'header', 'blockquote', 'list', 'align', 'indent', 'scenebreak'],
        placeholder: 'Begin here…'
      });
      S.quill = q;
      if (n.content && n.content.ops) q.setContents(n.content.ops, 'silent');
      else if (n.plain) q.setText(n.plain, 'silent');
      q.history.clear();
      Editor.applySpellcheck();
      S.lastCount = n.word_count || Data.countWords(q.getText());
      const snaps = await Data.snapshots(n.id);
      S.lastSnapAt = snaps.length ? new Date(snaps[0].created_at).getTime() : 0;

      q.on('text-change', (d, old, source) => {
        if (source === 'silent') return;
        S.dirty = true;
        clearTimeout(S.saveT);
        S.saveT = setTimeout(() => Editor.save(), 900);
        Editor.paintStatusSoon();
      });
      $('.tb-undo').onclick = () => q.history.undo();
      $('.tb-redo').onclick = () => q.history.redo();
      $('.tb-check').onclick = () => Grammar.open();
      const title = $('.doc-title');
      title.addEventListener('input', () => { n.title = title.value; S.metaDirty = true; Editor.saveMetaSoon(); const t = $(`.tn[data-id="${n.id}"] .tn-title`); if (t) t.textContent = n.title || 'Untitled'; });
      title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q.focus(); q.setSelection(0, 0); } });

      Editor.renderInspector();
      Editor.paintStatus();
      $('.desk-scroll').scrollTop = 0;
      if (n.title && n.title !== 'Untitled') setTimeout(() => { if (!S.renaming) q.focus(); }, 30);
    },

    insertSceneBreak() {
      const q = S.quill; if (!q) return;
      const r = q.getSelection(true);
      let i = r.index;
      const [, offset] = q.getLine(i);
      if (offset > 0) { q.insertText(i, '\n', 'user'); i++; }
      q.insertEmbed(i, 'scenebreak', true, 'user');
      q.setSelection(i + 1, 0, 'user');
    },

    applySpellcheck() { if (S.quill) S.quill.root.spellcheck = !!App.prefs.spellcheck; },

    /* Folder view: index cards for what's inside */
    renderFolder(f) {
      const kids = Editor.children(f.id);
      $('.page-col').innerHTML = `<div class="folder-view">
        <div class="folder-head"><input class="doc-title" value="${esc(f.title || '')}" aria-label="Folder name">
          <span class="muted">${fmt(Editor.folderWords(f.id))} words</span></div>
        <div class="cards">
          ${kids.map(k => `<button class="card ${k.kind}" data-card="${k.id}">
            <span class="card-title">${k.kind === 'folder' ? ICON.folder : ''}${esc(k.title || 'Untitled')}</span>
            <span class="card-syn">${esc(k.synopsis || (k.kind === 'doc' ? (k.plain || '').slice(0, 180) : ''))}</span>
            <span class="card-foot">${k.label ? `<span class="tn-label">${esc(k.label)}</span>` : '<span></span>'}<span>${fmt(k.kind === 'folder' ? Editor.folderWords(k.id) : k.word_count)} words</span></span>
          </button>`).join('')}
          <button class="card add" data-card-add>${ICON.plus}<span>New document here</span></button>
        </div></div>`;
      const title = $('.doc-title');
      title.addEventListener('input', () => { f.title = title.value; S.metaDirty = true; Editor.saveMetaSoon(); const t = $(`.tn[data-id="${f.id}"] .tn-title`); if (t) t.textContent = f.title || 'Untitled'; });
      $('.folder-view').addEventListener('click', e => {
        const c = e.target.closest('[data-card]');
        if (c) App.go('#/project/' + S.project.id + '/' + c.dataset.card);
        if (e.target.closest('[data-card-add]')) Editor.addNode('doc', f.id);
      });
    },

    /* ---------------- Inspector ---------------- */
    async renderInspector() {
      const box = $('.inspector'); if (!box) return;
      const n = S.current;
      if (!n) { box.innerHTML = `<div class="insp-sec"><h3>Project</h3><p class="muted">${fmt(Editor.projectWords())} words${S.project.word_goal ? ` of ${fmt(S.project.word_goal)}` : ''}</p></div>`; return; }
      const snaps = n.kind === 'doc' ? await Data.snapshots(n.id) : [];
      const reasonName = { auto: 'Automatic', manual: '', conflict: '', restore: '', import: '' };
      box.innerHTML = `
        <div class="insp-sec">
          <h3>Synopsis</h3>
          <textarea class="syn" rows="4" placeholder="A line or two about what happens here">${esc(n.synopsis || '')}</textarea>
        </div>
        <div class="insp-sec">
          <h3>Label</h3>
          <select class="lbl">${LABELS.map(l => `<option value="${l}" ${(n.label || '') === l ? 'selected' : ''}>${l || 'None'}</option>`).join('')}</select>
        </div>
        <div class="insp-sec">
          <h3>Notes</h3>
          <textarea class="notes" rows="7" placeholder="Reminders, questions, research for this ${n.kind === 'folder' ? 'folder' : 'document'}">${esc(n.notes || '')}</textarea>
        </div>
        ${n.kind === 'doc' ? `<div class="insp-sec">
          <div class="insp-head"><h3>History</h3><button class="btn small" data-snap>Save a version</button></div>
          ${snaps.length ? `<ul class="snaps">${snaps.slice(0, 40).map(s => `<li><button data-view="${s.id}"><span>${esc(s.name || reasonName[s.reason] || 'Version')}</span>
            <span class="muted">${new Date(s.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, ${fmt(s.word_count)} words</span></button></li>`).join('')}</ul>`
            : '<p class="muted small">Versions are saved automatically every couple of hours while you write. Save one yourself before big changes.</p>'}
        </div>` : ''}`;
      const syn = $('.syn', box), notes = $('.notes', box), lbl = $('.lbl', box);
      syn.addEventListener('input', () => { n.synopsis = syn.value; S.metaDirty = true; Editor.saveMetaSoon(); });
      notes.addEventListener('input', () => { n.notes = notes.value; S.metaDirty = true; Editor.saveMetaSoon(); });
      lbl.addEventListener('change', () => { n.label = lbl.value; S.metaDirty = true; Editor.saveMetaSoon(0); Editor.renderBinder(); });
      box.onclick = async e => {
        if (e.target.closest('[data-snap]')) {
          const name = await App.prompt('Name this version', 'Before revisions', 'Save version');
          if (name === null) return;
          await Editor.flush();
          await Editor.snapshot(n, name || 'Saved version', 'manual');
          Editor.renderInspector(); App.toast('Version saved.');
        }
        const v = e.target.closest('[data-view]');
        if (v) Editor.viewSnapshot(v.dataset.view);
      };
    },

    async snapshot(n, name, reason) {
      const s = await Data.save('snapshots', {
        node_id: n.id, project_id: n.project_id, name, reason,
        content: n.content || { ops: [{ insert: n.plain || '\n' }] }, word_count: n.word_count || 0
      }, { quiet: true });
      if (reason === 'auto' || reason === 'manual') S.lastSnapAt = Date.now();
      return s;
    },

    async viewSnapshot(id) {
      const s = await DB.get('snapshots', id);
      if (!s) return;
      const html = Transfer.deltaToHtml(s.content);
      const m = App.modal(`<h2>${esc(s.name || 'Saved version')}</h2>
        <p class="muted">${new Date(s.created_at).toLocaleString()}, ${fmt(s.word_count)} words</p>
        <div class="snap-preview page-text">${html}</div>
        <div class="modal-actions"><span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" data-restore-snap>Use this version</button></div>`, { wide: true, noFocus: true });
      $('[data-restore-snap]', m.el).onclick = async () => {
        const n = S.current; if (!n || n.id !== s.node_id) return m.close();
        await Editor.flush();
        await Editor.snapshot(n, 'Before using “' + (s.name || 'an earlier version') + '”', 'restore');
        n.content = s.content; n.plain = Transfer.deltaToText(s.content); n.word_count = Data.countWords(n.plain);
        await Data.save('nodes', n, { quiet: true });
        m.close();
        Editor.select(n.id);
        App.toast('Earlier version restored. What you had is saved in History.');
      };
    },

    /* ---------------- Saving ---------------- */
    saveMetaSoon(delay) {
      clearTimeout(S.metaT);
      S.metaT = setTimeout(() => Editor.saveMeta(), delay == null ? 700 : delay);
    },
    async saveMeta() {
      if (!S.metaDirty || !S.current) return;
      S.metaDirty = false;
      await Data.save('nodes', S.current, { quiet: true });
    },

    async save() {
      clearTimeout(S.saveT);
      const n = S.current, q = S.quill;
      if (!S.dirty || !n || !q || n.kind !== 'doc') return;
      S.dirty = false;
      const text = q.getText();
      const count = Data.countWords(text);
      n.content = { ops: q.getContents().ops };
      n.plain = text;
      n.word_count = count;
      const delta = count - S.lastCount;
      S.lastCount = count;
      S.metaDirty = false;
      await Data.save('nodes', n, { quiet: true });
      Data.logWords(delta);
      if (count >= 50 && Date.now() - S.lastSnapAt > SNAP_EVERY_MS) await Editor.snapshot(n, '', 'auto');
      const w = $(`.tn[data-id="${n.id}"] .tn-words`); if (w) w.textContent = count ? fmt(count) : '';
      Editor.paintStatus();
    },

    async flush() {
      clearTimeout(S.metaT);
      await Editor.save();
      await Editor.saveMeta();
    },
    flushSync() { if (S.dirty || S.metaDirty) Editor.flush(); },

    onDataChange(table) {
      if (table !== 'remote' || !S.project) return;
      // Another device changed something: refresh what's shown unless she's mid-edit
      Data.nodes(S.project.id).then(list => {
        list.forEach(r => {
          const local = S.nodes.get(r.id);
          if (S.current && S.current.id === r.id) {
            if (!S.dirty && !S.metaDirty && local && (r.rev || 0) > (local.rev || 0)) { S.nodes.set(r.id, r); Editor.select(r.id); }
          } else S.nodes.set(r.id, r);
        });
        Editor.renderBinder();
      });
    },

    /* ---------------- Status bar ---------------- */
    paintStatusSoon() { clearTimeout(Editor._ps); Editor._ps = setTimeout(Editor.paintStatus, 250); },
    async paintStatus() {
      const bar = $('.statusbar'); if (!bar) return;
      const n = S.current;
      const docWords = n && n.kind === 'doc' && S.quill ? Data.countWords(S.quill.getText()) : null;
      const total = Editor.projectWords() - (n && n.kind === 'doc' ? (n.word_count || 0) : 0) + (docWords || 0);
      const today = await Data.wordsOn(Data.localDate()) + (docWords != null ? docWords - S.lastCount : 0);
      const goal = App.prefs.dailyGoal;
      const pg = S.project.word_goal;
      bar.innerHTML = `${docWords != null ? `<span><strong>${fmt(docWords)}</strong> words here</span>` : ''}
        <span>${fmt(total)}${pg ? ` of ${fmt(pg)}` : ''} in this project</span>
        ${goal ? `<span class="sb-goal">Today <strong>${fmt(Math.max(0, today))}</strong> of ${fmt(goal)}<i style="--p:${Math.min(100, Math.max(0, today) / goal * 100)}%"></i></span>` : ''}`;
      const fx = $('.fx-words'); if (fx) fx.textContent = docWords != null ? fmt(docWords) + ' words' : '';
    }
  };

  const ti = p => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const TB = {
    left: ti('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
    center: ti('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
    right: ti('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
    justify: ti('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>'),
    bullet: ti('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    ordered: ti('<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5a1.5 1.5 0 1 1 2.6 1L3.5 19h3"/>'),
    quote: ti('<path d="M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6"/>'),
    scene: ti('<path d="M5 12h.01M12 12h.01M19 12h.01"/><path d="M3 5h18M3 19h18" opacity=".35"/>'),
    clean: ti('<path d="M6 4h12M12 4l-3 16M4 20l16-16" />'),
    undo: ti('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
    redo: ti('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
    check: ti('<path d="M4 12l5 5L20 6"/>')
  };

  window.Editor = Editor;
})();
