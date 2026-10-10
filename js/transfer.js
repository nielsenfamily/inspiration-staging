/* Backup, restore, sharing (export) and bringing in older work (import). */
(function () {
  const { $, $$, esc, fmt } = App;
  const C = window.APP_CONFIG;
  const TABLES = ['projects', 'nodes', 'snapshots', 'writing_log', 'suggestions', 'settings'];

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
    return loaded[src];
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const safeName = s => (s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'Untitled';

  /* ---------- Reading stored documents (Quill format) ---------- */
  function toLines(content) {
    const ops = (content && content.ops) || (Array.isArray(content) ? content : [{ insert: '\n' }]);
    const lines = []; let segs = [];
    ops.forEach(op => {
      if (typeof op.insert === 'object') {
        if (op.insert.scenebreak) { if (segs.length) { lines.push({ segs, attrs: {} }); segs = []; } lines.push({ segs: [], attrs: {}, scenebreak: true }); }
        return;
      }
      const parts = String(op.insert).split('\n');
      parts.forEach((part, i) => {
        if (part) segs.push({ text: part, attrs: op.attributes || {} });
        if (i < parts.length - 1) { lines.push({ segs, attrs: op.attributes || {} }); segs = []; }
      });
    });
    if (segs.length) lines.push({ segs, attrs: {} });
    // the line attributes only come from the newline op; inline attrs on newline ops are line formats
    return lines.map(l => ({ segs: l.segs, scenebreak: l.scenebreak, attrs: pick(l.attrs, ['header', 'blockquote', 'list', 'align', 'indent']) }));
  }
  const pick = (o, keys) => { const r = {}; keys.forEach(k => { if (o && o[k] != null) r[k] = o[k]; }); return r; };

  function segHtml(s) {
    let t = esc(s.text);
    if (s.attrs.bold) t = `<strong>${t}</strong>`;
    if (s.attrs.italic) t = `<em>${t}</em>`;
    if (s.attrs.underline) t = `<u>${t}</u>`;
    if (s.attrs.strike) t = `<s>${t}</s>`;
    return t;
  }
  function deltaToHtml(content) {
    const lines = toLines(content);
    let html = '', list = null;
    const closeList = () => { if (list) { html += list === 'ordered' ? '</ol>' : '</ul>'; list = null; } };
    lines.forEach(l => {
      if (l.scenebreak) { closeList(); html += '<p class="scene-break-out">❦</p>'; return; }
      const inner = l.segs.map(segHtml).join('') || '<br>';
      const style = l.attrs.align ? ` style="text-align:${l.attrs.align}"` : '';
      if (l.attrs.list) {
        const kind = l.attrs.list === 'ordered' ? 'ordered' : 'bullet';
        if (list !== kind) { closeList(); html += kind === 'ordered' ? '<ol>' : '<ul>'; list = kind; }
        html += `<li${style}>${inner}</li>`; return;
      }
      closeList();
      if (l.attrs.header) html += `<h${l.attrs.header}${style}>${inner}</h${l.attrs.header}>`;
      else if (l.attrs.blockquote) html += `<blockquote${style}>${inner}</blockquote>`;
      else html += `<p${style}>${inner}</p>`;
    });
    closeList();
    return html;
  }
  function deltaToText(content) {
    return toLines(content).map(l => l.scenebreak ? '* * *' : (l.attrs.list === 'bullet' ? '• ' : '') + l.segs.map(s => s.text).join('')).join('\n');
  }

  /* ---------- Backup ---------- */
  async function gather() {
    const out = {};
    for (const t of TABLES) {
      out[t] = (await DB.all(t)).filter(r => r.user_id === Data.userId).map(r => {
        const c = {}; Object.keys(r).forEach(k => { if (k[0] !== '_') c[k] = r[k]; }); return c;
      });
    }
    return out;
  }

  async function downloadBackup() {
    const tables = await gather();
    const data = { app: 'toolkit-inspiration', format: 1, version: C.VERSION, exported_at: new Date().toISOString(), tables };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    download(blob, `Inspiration backup ${Data.localDate()}.json`);
    const s = (await Data.settingsRecord()) || { id: Data.userId, prefs: {} };
    s.last_backup_at = new Date().toISOString();
    await Data.save('settings', s, { quiet: true });
    App.toast('Backup downloaded. Save it to a drive or cloud folder you trust.');
  }

  async function restoreBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return App.toast('That file isn’t an Inspiration backup.'); }
    if (!data || data.app !== 'toolkit-inspiration' || !data.tables) return App.toast('That file isn’t an Inspiration backup.');
    const T = data.tables;
    const ok = await App.confirm('Restore from this backup?',
      `From ${new Date(data.exported_at).toLocaleDateString()}: ${(T.projects || []).length} projects, ${(T.nodes || []).filter(n => n.kind === 'doc').length} documents. Anything missing here will be added back. Nothing you have now will be replaced; where a document differs, the backup’s version is added to its History.`,
      'Restore');
    if (!ok) return;
    let added = 0, kept = 0;
    const stamp = new Date(data.exported_at).toLocaleDateString();
    for (const t of ['projects', 'nodes', 'snapshots', 'suggestions', 'writing_log']) {
      for (const rec of (T[t] || [])) {
        const local = await DB.get(t, rec.id);
        if (!local || local.user_id !== Data.userId) {
          const copy = Object.assign({}, rec, { rev: 0, updated_at: undefined });
          await Data.save(t, copy, { quiet: true }); added++;
        } else if (t === 'nodes' && rec.kind === 'doc' && JSON.stringify(local.content) !== JSON.stringify(rec.content)) {
          await Data.save('snapshots', { node_id: rec.id, project_id: rec.project_id, name: 'From backup of ' + stamp, reason: 'restore', content: rec.content, word_count: rec.word_count || 0 }, { quiet: true });
          kept++;
        }
      }
    }
    Data.emit('remote', null);
    App.toast(`Restore finished: ${added} item${added === 1 ? '' : 's'} added${kept ? `, ${kept} older version${kept === 1 ? '' : 's'} put in History` : ''}.`, 7000);
    render();
  }

  /* ---------- Export ---------- */
  function treeOf(nodes) {
    const kids = pid => nodes.filter(n => (n.parent_id || null) === pid && !n.archived_at).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const walk = (pid, depth) => kids(pid).flatMap(n => [Object.assign({ depth }, n), ...(n.kind === 'folder' ? walk(n.id, depth + 1) : [])]);
    return walk(null, 0);
  }

  async function buildExport(project, chosenIds, opt) {
    const nodes = await Data.nodes(project.id);
    const flat = treeOf(nodes).filter(n => chosenIds.has(n.id));
    const prefs = App.prefs;
    const parts = []; // {type:'title'|'heading'|'doc', ...}
    if (opt.titlePage) parts.push({ type: 'title', title: project.title, subtitle: project.subtitle, author: prefs.penName });
    flat.forEach(n => {
      if (n.kind === 'folder') { if (opt.headings) parts.push({ type: 'heading', level: 1, text: n.title || 'Untitled' }); return; }
      if (opt.headings) parts.push({ type: 'heading', level: 2, text: n.title || 'Untitled' });
      if (opt.synopsis && n.synopsis) parts.push({ type: 'note', label: 'Synopsis', text: n.synopsis });
      parts.push({ type: 'doc', content: n.content || { ops: [{ insert: (n.plain || '') + '\n' }] } });
      if (opt.notes && n.notes) parts.push({ type: 'note', label: 'Notes', text: n.notes });
    });
    return parts;
  }

  async function exportDocx(project, parts, opt, filename) {
    await loadScript('lib/docx.min.js');
    const D = window.docx;
    const manuscript = opt.style === 'manuscript';
    const font = manuscript ? 'Times New Roman' : (App.prefs.writingFont === 'Courier Prime' ? 'Courier New' : 'Georgia');
    const size = manuscript ? 24 : 23;
    const line = manuscript ? 480 : 300;
    const children = [];
    const AL = { center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED };
    let firstAfterHeading = true;
    parts.forEach(p => {
      if (p.type === 'title') {
        children.push(new D.Paragraph({ spacing: { before: 3600 }, alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: p.title || 'Untitled', size: 48, bold: !manuscript, font })] }));
        if (p.subtitle) children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 200 }, children: [new D.TextRun({ text: p.subtitle, size: 28, italics: true, font })] }));
        if (p.author) children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 600 }, children: [new D.TextRun({ text: 'by ' + p.author, size: 28, font })] }));
        children.push(new D.Paragraph({ children: [new D.PageBreak()] }));
        return;
      }
      if (p.type === 'heading') {
        children.push(new D.Paragraph({ heading: p.level === 1 ? D.HeadingLevel.HEADING_1 : D.HeadingLevel.HEADING_2, alignment: D.AlignmentType.CENTER, pageBreakBefore: p.level === 1 || (manuscript && p.level === 2), spacing: { before: 480, after: 360 }, children: [new D.TextRun({ text: p.text, font })] }));
        firstAfterHeading = true; return;
      }
      if (p.type === 'note') {
        children.push(new D.Paragraph({ spacing: { before: 120, after: 120 }, indent: { left: 360 }, children: [new D.TextRun({ text: p.label + ': ', bold: true, size: size - 2, font }), new D.TextRun({ text: p.text, italics: true, size: size - 2, font })] }));
        return;
      }
      toLines(p.content).forEach(l => {
        if (l.scenebreak) { children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 240, after: 240 }, children: [new D.TextRun({ text: manuscript ? '#' : '* * *', font, size })] })); firstAfterHeading = true; return; }
        const runs = l.segs.map(s => new D.TextRun({ text: s.text, bold: !!s.attrs.bold, italics: !!s.attrs.italic, underline: s.attrs.underline ? {} : undefined, strike: !!s.attrs.strike, font, size }));
        const base = { children: runs, alignment: AL[l.attrs.align], spacing: { line, after: (App.prefs.paragraphStyle === 'spaced' && !manuscript) ? 200 : 0 } };
        if (l.attrs.header) { children.push(new D.Paragraph(Object.assign(base, { heading: l.attrs.header === 1 ? D.HeadingLevel.HEADING_1 : l.attrs.header === 2 ? D.HeadingLevel.HEADING_2 : D.HeadingLevel.HEADING_3, spacing: { before: 360, after: 240 } }))); firstAfterHeading = true; return; }
        if (l.attrs.list) { children.push(new D.Paragraph(Object.assign(base, l.attrs.list === 'ordered' ? { numbering: { reference: 'nums', level: 0 } } : { bullet: { level: 0 } }))); return; }
        if (l.attrs.blockquote) { children.push(new D.Paragraph(Object.assign(base, { indent: { left: 720, right: 720 } }))); return; }
        const indent = (manuscript || App.prefs.paragraphStyle !== 'spaced') && !firstAfterHeading && !l.attrs.align ? { firstLine: 720 } : undefined;
        children.push(new D.Paragraph(Object.assign(base, { indent })));
        if (l.segs.length) firstAfterHeading = false;
      });
    });
    const doc = new D.Document({
      creator: App.prefs.penName || 'Toolkit: Inspiration',
      title: project.title,
      styles: {
        default: { document: { run: { font, size } } },
        paragraphStyles: [
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: manuscript ? 24 : 36, bold: !manuscript, font } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: manuscript ? 24 : 30, bold: !manuscript, font } },
          { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: manuscript ? 24 : 26, italics: true, font } }
        ]
      },
      numbering: { config: [{ reference: 'nums', levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: '%1.', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
      sections: [{
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        headers: manuscript ? { default: new D.Header({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ text: (App.prefs.penName ? App.prefs.penName.split(/\s+/).pop() + ' / ' : '') + (project.title || '').slice(0, 30) + ' / ', font, size }), new D.TextRun({ children: [D.PageNumber.CURRENT], font, size })] })] }) } : undefined,
        children
      }]
    });
    download(await D.Packer.toBlob(doc), filename + '.docx');
  }

  function exportText(parts, filename) {
    const out = [];
    parts.forEach(p => {
      if (p.type === 'title') out.push(p.title.toUpperCase(), p.subtitle || '', p.author ? 'by ' + p.author : '', '', '');
      else if (p.type === 'heading') out.push('', p.level === 1 ? p.text.toUpperCase() : p.text, '');
      else if (p.type === 'note') out.push('[' + p.label + ': ' + p.text + ']', '');
      else out.push(deltaToText(p.content).replace(/\n+$/, ''), '');
    });
    download(new Blob([out.join('\n').replace(/\n{4,}/g, '\n\n\n')], { type: 'text/plain;charset=utf-8' }), filename + '.txt');
  }

  function exportPrint(parts, opt, title) {
    const manuscript = opt.style === 'manuscript';
    const body = parts.map(p => {
      if (p.type === 'title') return `<section class="title-page"><h1>${esc(p.title)}</h1>${p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ''}${p.author ? `<p class="by">by ${esc(p.author)}</p>` : ''}</section>`;
      if (p.type === 'heading') return `<h${p.level === 1 ? 1 : 2} class="${p.level === 1 ? 'part' : 'chap'}">${esc(p.text)}</h${p.level === 1 ? 1 : 2}>`;
      if (p.type === 'note') return `<p class="note"><strong>${esc(p.label)}:</strong> ${esc(p.text)}</p>`;
      return `<div class="doc">${deltaToHtml(p.content)}</div>`;
    }).join('');
    const w = window.open('', '_blank');
    if (!w) return App.toast('Your browser blocked the print window. Allow pop-ups for this site and try again.');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link rel="stylesheet" href="${location.href.replace(/#.*$/, '').replace(/[^/]*$/, '')}fonts/fonts.css">
      <style>
        @page { margin: 1in; }
        body { font-family: ${manuscript ? "'Times New Roman', serif" : `'${App.prefs.writingFont}', Georgia, serif`}; font-size: 12pt; line-height: ${manuscript ? 2 : 1.55}; color: #111; max-width: 6.5in; margin: 0 auto; }
        h1, h2 { text-align: center; font-weight: ${manuscript ? 400 : 600}; }
        h1.part, h2.chap { break-before: page; margin-top: ${manuscript ? '2in' : '1in'}; }
        .title-page { height: 9in; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; }
        .title-page h1 { font-size: 26pt; margin: 0; } .sub { font-style: italic; } .by { margin-top: .5in; }
        .doc p { margin: 0; text-indent: ${App.prefs.paragraphStyle === 'spaced' && !manuscript ? '0' : '0.5in'}; ${App.prefs.paragraphStyle === 'spaced' && !manuscript ? 'margin-bottom: .8em;' : ''} }
        .doc h1 + p, .doc h2 + p, .doc h3 + p, .scene-break-out + p, .doc > p:first-child { text-indent: 0; }
        .scene-break-out { text-align: center; text-indent: 0 !important; margin: 1em 0 !important; }
        blockquote { margin: .6em .5in; } .note { font-style: italic; color: #444; text-indent: 0; }
      </style></head><body>${body}<script>document.fonts.ready.then(()=>setTimeout(()=>print(),300));<\/script></body></html>`);
    w.document.close();
  }

  /* ---------- Import ---------- */
  function htmlToOps(html) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px';
    document.body.appendChild(host);
    const q = new Quill(host, { formats: ['bold', 'italic', 'underline', 'strike', 'header', 'blockquote', 'list', 'align', 'indent'] });
    const delta = q.clipboard.convert({ html });
    host.remove();
    return delta.ops;
  }
  function textToHtml(text, md) {
    return text.replace(/\r\n?/g, '\n').split(/\n{2,}|\n(?=#)/).map(p => {
      let t = esc(p.trim()); if (!t) return '';
      if (md) {
        const h = t.match(/^(#{1,3})\s+(.*)$/);
        t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>').replace(/_(.+?)_/g, '<em>$1</em>');
        if (h) return `<h${h[1].length}>${h[2]}</h${h[1].length}>`;
        if (/^(\*\s*){3,}$|^-{3,}$/.test(p.trim())) return '<p>* * *</p>';
      }
      return `<p>${t.replace(/\n/g, ' ')}</p>`;
    }).join('');
  }
  async function fileToOps(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx')) {
      await loadScript('lib/mammoth.min.js');
      const r = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      return htmlToOps(r.value);
    }
    const text = await file.text();
    if (/\.html?$/.test(name)) return htmlToOps(text);
    return htmlToOps(textToHtml(text, name.endsWith('.md')));
  }
  // Turn "* * *", "***", "#" lines into scene breaks; split into chapters if asked
  function splitOps(ops, split) {
    const lines = []; let cur = [];
    ops.forEach(op => {
      if (typeof op.insert !== 'string') { cur.push(op); return; }
      const parts = op.insert.split('\n');
      parts.forEach((part, i) => {
        if (part) cur.push({ insert: part, attributes: op.attributes });
        if (i < parts.length - 1) { lines.push({ ops: cur, attrs: op.attributes || {} }); cur = []; }
      });
    });
    if (cur.length) lines.push({ ops: cur, attrs: {} });
    const text = l => l.ops.map(o => typeof o.insert === 'string' ? o.insert : '').join('').trim();
    const pieces = []; let piece = { title: null, lines: [] };
    lines.forEach(l => {
      const t = text(l);
      const isChapter = split && (l.attrs.header === 1 || (/^(chapter\b|prologue\b|epilogue\b)/i.test(t) && t.length < 80));
      if (isChapter) { if (piece.lines.some(x => text(x)) || piece.title) pieces.push(piece); piece = { title: t, lines: [] }; return; }
      piece.lines.push(l);
    });
    pieces.push(piece);
    return pieces.filter(p => p.title || p.lines.some(l => text(l))).map(p => {
      const out = [];
      p.lines.forEach(l => {
        const t = text(l);
        if (/^(\*\s*){3,}$|^#$|^(-\s*){3,}$|^❦$/.test(t)) { out.push({ insert: { scenebreak: true } }); return; }
        l.ops.forEach(o => out.push(o));
        const la = pick(l.attrs, ['header', 'blockquote', 'list', 'align', 'indent']);
        out.push(Object.keys(la).length ? { insert: '\n', attributes: la } : { insert: '\n' });
      });
      while (out.length && out[0].insert === '\n' && !out[0].attributes) out.shift();
      if (!out.length || out[out.length - 1].insert !== '\n') out.push({ insert: '\n' });
      return { title: p.title, ops: out };
    });
  }

  async function runImport(files, targetId, split) {
    let project;
    const titleFromFile = f => f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    if (targetId === '__new') {
      project = await Data.save('projects', { title: files.length === 1 ? titleFromFile(files[0]) : 'Imported writing', kind: 'Novel', status: 'active', color: App.SPINES[Math.floor(Math.random() * App.SPINES.length)].id, sort_order: Date.now() });
      await Data.save('nodes', { project_id: project.id, parent_id: null, kind: 'folder', title: 'Manuscript', sort_order: 1, word_count: 0 });
      await Data.save('nodes', { project_id: project.id, parent_id: null, kind: 'folder', title: 'Notes & research', sort_order: 2, word_count: 0 });
    } else project = await DB.get('projects', targetId);
    const nodes = await Data.nodes(project.id);
    const ms = nodes.find(n => n.kind === 'folder' && !n.parent_id && !n.archived_at && /manuscript/i.test(n.title || ''));
    let parent = ms ? ms.id : null;
    let order = Math.max(0, ...nodes.filter(n => (n.parent_id || null) === parent).map(n => n.sort_order || 0)) + 1;
    let docs = 0, words = 0;
    for (const f of files) {
      let ops;
      try { ops = await fileToOps(f); } catch (e) { console.error(e); App.toast('Couldn’t read “' + f.name + '”. Try saving it as .docx or .txt first.'); continue; }
      const pieces = splitOps(ops, split);
      let dest = parent;
      if (split && pieces.length > 1 && files.length > 1) {
        const folder = await Data.save('nodes', { project_id: project.id, parent_id: parent, kind: 'folder', title: titleFromFile(f), sort_order: order++, word_count: 0 });
        dest = folder.id;
      }
      let o = dest === parent ? order : 1;
      for (const p of pieces) {
        const content = { ops: p.ops };
        const plain = deltaToText(content);
        const wc = Data.countWords(plain);
        await Data.save('nodes', { project_id: project.id, parent_id: dest, kind: 'doc', title: p.title || titleFromFile(f), sort_order: o++, content, plain, word_count: wc }, { quiet: true });
        docs++; words += wc;
      }
      if (dest === parent) order = o;
    }
    App.toast(`Imported ${docs} document${docs === 1 ? '' : 's'}, ${fmt(words)} words, into “${project.title}”.`, 6000);
    return project;
  }

  /* ---------- Screen ---------- */
  async function render() {
    const projects = (await Data.projects()).filter(p => !p.archived_at).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const s = await Data.settingsRecord();
    const last = s && s.last_backup_at;
    $('#app').innerHTML = `${App.topbar({ left: `<a class="icon-btn" href="#/" title="Back to your shelf">${App.ICON.shelf}<span>Library</span></a>` })}
      <main class="transfer">
        <h1>Backup &amp; sharing</h1>
        <section class="xfer">
          <div class="xfer-text"><h2>Back up everything</h2>
            <p>One file with every project, document, note and saved version. Keep a copy on a flash drive or cloud folder now and then.</p>
            <p class="muted">${last ? 'Last backup: ' + new Date(last).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'No backup downloaded yet.'}</p></div>
          <div class="xfer-act"><button class="btn primary" data-x="backup">Download backup</button></div>
        </section>
        <section class="xfer">
          <div class="xfer-text"><h2>Share or export</h2>
            <p>Choose a project, then pick exactly which parts to include. Word files are best for friends who want to leave comments.</p></div>
          <div class="xfer-form">
            ${projects.length ? `<label>Project<select data-x="exp-project">${projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>
            <div class="pick-tree" data-x="pick"></div>
            <div class="row2">
              <label>Format<select data-x="format"><option value="docx">Word document (.docx)</option><option value="print">Print or save as PDF</option><option value="txt">Plain text (.txt)</option></select></label>
              <label>Style<select data-x="style"><option value="reading">Easy reading</option><option value="manuscript">Standard manuscript (12 pt, double-spaced)</option></select></label>
            </div>
            <div class="checks">
              <label class="check"><input type="checkbox" data-o="titlePage" checked> Title page with pen name</label>
              <label class="check"><input type="checkbox" data-o="headings" checked> Use document names as chapter titles</label>
              <label class="check"><input type="checkbox" data-o="synopsis"> Include synopses</label>
              <label class="check"><input type="checkbox" data-o="notes"> Include notes</label>
            </div>
            <button class="btn primary" data-x="export">Export</button>` : '<p class="muted">Projects you create will be listed here.</p>'}
          </div>
        </section>
        <section class="xfer">
          <div class="xfer-text"><h2>Bring in earlier writing</h2>
            <p>Add Word (.docx), text (.txt), Markdown (.md) or web page (.html) files. Pages and Scrivener files can be exported to Word first.</p></div>
          <div class="xfer-form">
            <label>Put it in<select data-x="imp-project"><option value="__new">A new project</option>${projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>
            <label class="check"><input type="checkbox" data-x="split" checked> Split into separate chapters at chapter headings</label>
            <label class="btn file-btn">Choose files<input type="file" multiple accept=".docx,.txt,.md,.html,.htm" data-x="imp-files" hidden></label>
          </div>
        </section>
        <section class="xfer">
          <div class="xfer-text"><h2>Restore from a backup</h2>
            <p>Adds back anything that’s missing. It never replaces what you have now.</p></div>
          <div class="xfer-act"><label class="btn file-btn">Choose backup file<input type="file" accept=".json,application/json" data-x="restore" hidden></label></div>
        </section>
        <footer class="glory">${esc(C.TAGLINE)}</footer>
      </main>`;
    App.bindTopbar();
    const root = $('.transfer');

    const paintPick = async () => {
      const sel = $('[data-x=exp-project]'); if (!sel) return;
      const flat = treeOf(await Data.nodes(sel.value));
      $('[data-x=pick]').innerHTML = flat.length ? `<div class="pick-actions"><button class="link small" data-pick="all">Select all</button><button class="link small" data-pick="none">Clear</button></div>` +
        flat.map(n => `<label class="pick" style="--depth:${n.depth}"><input type="checkbox" value="${n.id}" data-parent="${n.parent_id || ''}" ${/notes|research/i.test(n.title || '') && n.kind === 'folder' ? '' : 'checked'}>
          <span class="${n.kind}">${esc(n.title || 'Untitled')}</span>${n.kind === 'doc' ? `<span class="muted">${fmt(n.word_count)}</span>` : ''}</label>`).join('') : '<p class="muted">This project is empty.</p>';
      // unchecked folders uncheck their contents
      $$('[data-x=pick] input').forEach(i => { const par = $(`[data-x=pick] input[value="${i.dataset.parent}"]`); if (par && !par.checked) i.checked = false; });
    };
    paintPick();

    root.addEventListener('change', async e => {
      const t = e.target;
      if (t.matches('[data-x=exp-project]')) paintPick();
      if (t.matches('[data-x=pick] input')) {
        // checking a folder checks everything inside it
        const setKids = (id, v) => $$(`[data-x=pick] input[data-parent="${id}"]`).forEach(k => { k.checked = v; setKids(k.value, v); });
        setKids(t.value, t.checked);
      }
      if (t.matches('[data-x=imp-files]') && t.files.length) {
        const files = Array.from(t.files);
        const p = await runImport(files, $('[data-x=imp-project]').value, $('[data-x=split]').checked);
        t.value = '';
        if (p) App.go('#/project/' + p.id);
      }
      if (t.matches('[data-x=restore]') && t.files[0]) { await restoreBackup(t.files[0]); t.value = ''; }
    });
    root.addEventListener('click', async e => {
      const pk = e.target.closest('[data-pick]');
      if (pk) $$('[data-x=pick] input').forEach(i => { i.checked = pk.dataset.pick === 'all'; });
      const b = e.target.closest('[data-x]');
      if (!b || b.tagName !== 'BUTTON') return;
      if (b.dataset.x === 'backup') { await downloadBackup(); render(); }
      if (b.dataset.x === 'export') {
        const project = await DB.get('projects', $('[data-x=exp-project]').value);
        const chosen = new Set($$('[data-x=pick] input:checked').map(i => i.value));
        if (!chosen.size) return App.toast('Choose at least one document to include.');
        const opt = { style: $('[data-x=style]').value };
        $$('[data-o]').forEach(i => { opt[i.dataset.o] = i.checked; });
        const parts = await buildExport(project, chosen, opt);
        const fmtSel = $('[data-x=format]').value;
        const name = safeName(project.title) + (chosen.size < $$('[data-x=pick] input').length ? ' (selection)' : '');
        b.disabled = true; b.textContent = 'Preparing…';
        try {
          if (fmtSel === 'docx') await exportDocx(project, parts, opt, name);
          else if (fmtSel === 'txt') exportText(parts, name);
          else exportPrint(parts, opt, project.title);
        } catch (err) { console.error(err); App.toast('The export didn’t finish. Try again, or choose a different format.'); }
        b.disabled = false; b.textContent = 'Export';
      }
    });
  }

  window.Transfer = { render, downloadBackup, restoreBackup, deltaToHtml, deltaToText, toLines, buildExport, exportDocx, splitOps, fileToOps, runImport };
})();
