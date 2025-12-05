// script.js - Fixed full version (core features, robust and complete)
// Replace any previous script.js with this file.

window.addEventListener('DOMContentLoaded', () => {
  // --- State ---
  const STATE = {
    files: [],           // {id, name, type, content}
    currentId: null,
    projectName: 'untitled'
  };

  // --- Helpers ---
  const $ = id => document.getElementById(id);
  const uid = () => 'f_' + Math.random().toString(36).slice(2,9);
  const nowStr = () => new Date().toLocaleString();

  function safeGet(id) {
    const el = $(id);
    if (!el) console.warn('Missing element:', id);
    return el;
  }

  function setStatus(text, busy = false) {
    const el = safeGet('statusText');
    if (!el) return;
    el.textContent = text || 'Idle';
    if (busy) {
      const s = document.createElement('span');
      s.className = 'loader';
      s.style.marginLeft = '8px';
      el.appendChild(s);
    }
  }

  // UTF-8-safe base64
  function toBase64Utf8(str) {
    const enc = new TextEncoder().encode(str);
    let bin = '';
    for (let i=0;i<enc.length;i++) bin += String.fromCharCode(enc[i]);
    return btoa(bin);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  function inferType(name, content) {
    const n = (name || '').toLowerCase();
    if (n.endsWith('.html') || n.endsWith('.htm') || (content && content.trim().startsWith('<'))) return 'html';
    if (n.endsWith('.css')) return 'css';
    if (n.endsWith('.js')) return 'js';
    return 'asset';
  }

  // --- File management ---
  function addFile(name, type, content) {
    const id = uid();
    STATE.files.push({ id, name, type: type || inferType(name, content), content: content || '' });
    renderFiles();
    setStatus('Added ' + name);
    return id;
  }

  function findFile(id) {
    return STATE.files.find(f => f.id === id);
  }

  function deleteFile(id) {
    STATE.files = STATE.files.filter(f => f.id !== id);
    if (STATE.currentId === id) {
      STATE.currentId = null;
      const ed = safeGet('editor'); if (ed) ed.value = '';
      const cfn = safeGet('currentFileName'); if (cfn) cfn.textContent = 'No file selected';
      const cfm = safeGet('currentFileMeta'); if (cfm) cfm.textContent = '—';
    }
    renderFiles();
    setStatus('Deleted file');
  }

  // --- Render file list ---
  function renderFiles() {
    const list = safeGet('filesList');
    if (!list) return;
    list.innerHTML = '';
    STATE.files.forEach(f => {
      const item = document.createElement('div');
      item.className = 'fileItem';

      const meta = document.createElement('div');
      meta.className = 'fileMeta';
      const nameEl = document.createElement('div'); nameEl.className = 'fileName'; nameEl.textContent = f.name;
      const typeEl = document.createElement('div'); typeEl.className = 'muted fileType'; typeEl.textContent = `${f.type}`;
      meta.appendChild(nameEl); meta.appendChild(typeEl);

      const actions = document.createElement('div'); actions.className = 'fileActions';
      const edit = document.createElement('button'); edit.className = 'editBtn small ghost'; edit.textContent = 'Edit';
      const insert = document.createElement('button'); insert.className = 'insertBtn small ghost'; insert.textContent = 'Insert';
      const del = document.createElement('button'); del.className = 'delBtn small ghost'; del.textContent = 'Delete';

      edit.addEventListener('click', (e) => { e.stopPropagation(); openFile(f.id); });
      insert.addEventListener('click', (e) => { e.stopPropagation(); insertFileIntoEditor(f.id); });
      del.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('Delete ' + f.name + '?')) deleteFile(f.id); });

      actions.appendChild(edit); actions.appendChild(insert); actions.appendChild(del);

      item.appendChild(meta); item.appendChild(actions);
      list.appendChild(item);

      // click on row selects for quick edit
      item.addEventListener('click', () => { openFile(f.id); });
    });
  }

  // --- Open / edit / insert ---
  function openFile(id) {
    const f = findFile(id);
    if (!f) return;
    STATE.currentId = id;
    const ed = safeGet('editor'); if (ed) ed.value = f.content;
    const nameEl = safeGet('currentFileName'); if (nameEl) nameEl.textContent = f.name;
    const metaEl = safeGet('currentFileMeta'); if (metaEl) metaEl.textContent = `${f.type} • ${f.content.length} bytes`;
    // set editor mode (if exists)
    const mode = safeGet('editorMode'); if (mode) mode.value = (f.type==='js'?'js':(f.type==='css'?'css':(f.type==='html'?'html':'text')));
    updateEditorInfo();
  }

  function insertFileIntoEditor(id) {
    const f = findFile(id); if (!f) return;
    const ed = safeGet('editor'); if (!ed) return;
    const pos = ed.selectionEnd || ed.value.length;
    const chunk = `\n\n/* --- ${f.name} --- */\n${f.content}\n`;
    ed.value = ed.value.slice(0,pos) + chunk + ed.value.slice(pos);
    if (STATE.currentId) {
      const cur = findFile(STATE.currentId); if (cur) cur.content = ed.value;
    }
    updateEditorInfo();
  }

  // --- Editor bindings ---
  const editorEl = safeGet('editor');
  if (editorEl) {
    editorEl.addEventListener('input', () => {
      if (STATE.currentId) {
        const cur = findFile(STATE.currentId); if (cur) cur.content = editorEl.value;
        const meta = safeGet('currentFileMeta'); if (meta) meta.textContent = `${cur.type} • ${cur.content.length} bytes`;
      }
      updateEditorInfo();
      // live preview if enabled
      const previewOpt = safeGet('optPreview');
      if (previewOpt && previewOpt.checked) {
        generatePreview();
      }
    });
  }

  function updateEditorInfo() {
    const info = safeGet('editorInfo');
    if (!info) return;
    if (!STATE.currentId) { info.textContent = 'No file selected'; return; }
    const f = findFile(STATE.currentId);
    info.textContent = `${f.name} — ${f.content.length} bytes`;
  }

  // Format and minify (basic)
  const formatBtn = safeGet('formatBtn');
  if (formatBtn) formatBtn.addEventListener('click', () => {
    if (!STATE.currentId) return alert('No file selected');
    const ed = safeGet('editor'); if (!ed) return;
    ed.value = ed.value.replace(/\t/g,'  ');
    findFile(STATE.currentId).content = ed.value;
    updateEditorInfo(); setStatus('Formatted (basic)');
  });

  const minifyBtn = safeGet('minifyBtn');
  if (minifyBtn) minifyBtn.addEventListener('click', () => {
    if (!STATE.currentId) return alert('No file selected');
    const ed = safeGet('editor'); if (!ed) return;
    ed.value = minifyBasic(ed.value);
    findFile(STATE.currentId).content = ed.value;
    updateEditorInfo(); setStatus('Minified (basic)');
  });

  function minifyBasic(s) {
    try {
      s = s.replace(/<!--[\s\S]*?-->/g,'');
      s = s.replace(/\/\*[\s\S]*?\*\//g,'');
      s = s.replace(/(^|[^:])\/\/.*$/gm,'$1');
      s = s.replace(/\s{2,}/g,' ');
      return s.trim();
    } catch (e) { return s; }
  }

  // --- Undo/redo simple handled by browser or via basic snapshots (omitted for simplicity) ---

  // --- Hidden file input handled ---
  const hiddenInput = safeGet('hiddenFileInput');
  if (hiddenInput) {
    hiddenInput.addEventListener('change', async (ev) => {
      const files = ev.target.files;
      if (!files || files.length === 0) return;
      setStatus('Loading files...', true);
      for (let i=0;i<files.length;i++) {
        try {
          const f = files[i];
          const txt = await readFileAsText(f);
          addFile(f.name, inferType(f.name, txt), txt);
        } catch (err) { console.error('Read error', err); alert('Read error: ' + err); }
      }
      setStatus('Files loaded');
      ev.target.value = '';
    });
  }

  const addFileBtn = safeGet('addFileBtn');
  if (addFileBtn) addFileBtn.addEventListener('click', () => {
    if (!hiddenInput) return alert('File input missing');
    hiddenInput.click();
  });

  const newFileBtn = safeGet('newFileBtn');
  if (newFileBtn) newFileBtn.addEventListener('click', () => {
    const type = prompt('File type (html/css/js/asset)', 'js');
    if (!type) return;
    const name = prompt('Filename', (type==='html'?'index.html':(type==='css'?'styles.css':(type==='js'?'app.js':'file.txt'))));
    if (!name) return;
    const content = prompt('Paste content (or leave blank)', '') || '';
    const id = addFile(name, inferType(name, content), content);
    openFile(id);
  });

  // --- Drag & drop support (files) ---
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!e.dataTransfer) return;
    const dtFiles = e.dataTransfer.files;
    if (!dtFiles || dtFiles.length === 0) return;
    setStatus('Dropping files...', true);
    for (let i=0;i<dtFiles.length;i++) {
      const f = dtFiles[i];
      try {
        const txt = await readFileAsText(f);
        addFile(f.name, inferType(f.name, txt), txt);
      } catch(err) { console.warn('drop read err', err); }
    }
    setStatus('Files dropped');
  });

  // --- Combine files into single HTML ---
  function chooseHtmlFile() {
    let maybe = STATE.files.find(f => f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm');
    if (!maybe) maybe = STATE.files.find(f => f.type === 'html' || /\.html?$/i.test(f.name));
    return maybe;
  }

  function combineAll() {
    let htmlFile = chooseHtmlFile();
    let doc = htmlFile ? htmlFile.content : '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<title>Untitled</title>\n</head>\n<body>\n<p>Empty</p>\n</body>\n</html>';
    // mobile meta
    const addMobile = safeGet('optMobile');
    if (addMobile && addMobile.checked && !/viewport/i.test(doc)) {
      doc = doc.replace(/<head([^>]*)>/i, match => match + '\n<meta name="viewport" content="width=device-width,initial-scale=1">');
    }
    // inject CSS
    const css = STATE.files.filter(f => f.type === 'css' || /\.css$/i.test(f.name)).map(f => f.content).join('\n');
    if (css) {
      if (/<\/head>/i.test(doc)) doc = doc.replace(/<\/head>/i, `<style>\n${css}\n</style>\n</head>`);
      else doc = `<head><style>\n${css}\n</style></head>\n` + doc;
    }
    // inject JS
    const js = STATE.files.filter(f => f.type === 'js' || /\.js$/i.test(f.name)).map(f => f.content).join('\n');
    if (js) {
      if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>/i, `<script>\n${js}\n</script>\n</body>`);
      else doc += `<script>\n${js}\n</script>`;
    }
    // optional minify
    const optMin = safeGet('optMinify');
    if (optMin && optMin.checked) doc = minifyBasic(doc);
    return doc;
  }

  // --- Preview generation ---
  function generatePreview() {
    try {
      const combined = combineAll();
      const frame = safeGet('previewFrame');
      if (frame) frame.srcdoc = combined;
      setStatus('Preview updated');
    } catch (e) {
      console.error(e);
      setStatus('Preview error');
    }
  }

  // previewToggle (show/hide) - toggles preview pane visibility by toggling a class/inline style
  const previewToggle = safeGet('previewToggle');
  if (previewToggle) {
    previewToggle.addEventListener('click', () => {
      const frame = safeGet('previewFrame');
      if (!frame) return;
      frame.style.display = (frame.style.display === 'none' ? '' : 'none');
      setStatus('Toggled preview');
    });
  }

  // --- Generate Data URL (UTF-8 safe) ---
  const generateBtn = safeGet('generateBtn');
  if (generateBtn) {
    generateBtn.addEventListener('click', () => {
      try {
        setStatus('Generating data URL...', true);
        const combined = combineAll();
        const b64 = toBase64Utf8(combined);
        const dataUrl = 'data:text/html;charset=utf-8;base64,' + b64;
        const out = safeGet('outputArea'); if (out) out.value = dataUrl;
        setStatus('Generated data URL');
        // set preview as well if option enabled
        const optPrev = safeGet('optPreview');
        if (optPrev && optPrev.checked) {
          const frame = safeGet('previewFrame'); if (frame) frame.srcdoc = combined;
        }
      } catch (e) {
        console.error(e);
        setStatus('Generate failed');
        alert('Generate failed: ' + e);
      }
    });
  }

  // --- Download .html ---
  const downloadBtn = safeGet('downloadBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      try {
        const combined = combineAll();
        const blob = new Blob([combined], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = (STATE.projectName || 'site') + '.html';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        setStatus('Download started');
      } catch (e) {
        console.error(e); setStatus('Download error'); alert('Download error: ' + e);
      }
    });
  }

  // --- Copy link ---
  const copyBtn = safeGet('copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const out = safeGet('outputArea'); if (!out || !out.value) return alert('No output to copy');
      try {
        await navigator.clipboard.writeText(out.value);
        setStatus('Copied to clipboard');
        alert('Copied to clipboard');
      } catch (e) {
        out.select(); document.execCommand('copy'); setStatus('Copied (fallback)'); alert('Copied (fallback)');
      }
    });
  }

  // --- Compress button (GZIP) ---
  const compressBtn = safeGet('compressBtn');
  if (compressBtn) {
    compressBtn.addEventListener('click', async () => {
      try {
        setStatus('Compressing...', true);
        const combined = combineAll();
        if (typeof CompressionStream === 'function') {
          const cs = new CompressionStream('gzip');
          const writer = cs.writable.getWriter();
          const enc = new TextEncoder();
          writer.write(enc.encode(combined));
          writer.close();
          const reader = cs.readable.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read(); if (done) break; chunks.push(value);
          }
          // flatten
          let total = 0; chunks.forEach(c => total += c.length);
          const outArr = new Uint8Array(total); let offset = 0; chunks.forEach(c => { outArr.set(c, offset); offset += c.length; });
          const b64 = btoa(String.fromCharCode(...outArr));
          const dataUrl = 'data:application/gzip;base64,' + b64;
          const out = safeGet('outputArea'); if (out) out.value = dataUrl;
          setStatus('Compressed to gzip (output updated)');
        } else {
          alert('CompressionStream not supported in this environment.');
          setStatus('Compression not available');
        }
      } catch (e) {
        console.error(e); setStatus('Compression error'); alert('Compression error: ' + e);
      }
    });
  }

  // --- Shorten (local) ---
  const shortenBtn = safeGet('shortenBtn');
  if (shortenBtn) {
    shortenBtn.addEventListener('click', () => {
      const out = safeGet('outputArea'); if (!out || !out.value) return alert('Generate output first');
      const map = JSON.parse(localStorage.getItem('koder_short_map') || '{}');
      const key = 's' + Math.random().toString(36).slice(2,8);
      map[key] = out.value;
      localStorage.setItem('koder_short_map', JSON.stringify(map));
      const link = location.origin + location.pathname + '?s=' + key;
      out.value = link;
      setStatus('Local short link created');
      alert('Local short link created. Open it in same browser to resolve.');
    });
  }

  // Resolve short on load
  (function resolveShort() {
    try {
      const params = new URLSearchParams(location.search);
      const s = params.get('s'); if (!s) return;
      const map = JSON.parse(localStorage.getItem('koder_short_map') || '{}');
      if (!map[s]) return;
      const data = map[s];
      if (data.startsWith('data:')) {
        // create blob
        const comma = data.indexOf(','); const header = data.substring(0, comma); const b64 = data.substring(comma+1);
        const bytes = atob(b64); const arr = new Uint8Array(bytes.length);
        for (let i=0;i<bytes.length;i++) arr[i] = bytes.charCodeAt(i);
        const mime = (header.split(':')[1]||'application/octet-stream').split(';')[0];
        const blob = new Blob([arr], { type: mime });
        const url = URL.createObjectURL(blob);
        window.location.href = url;
      } else {
        document.open(); document.write(data); document.close();
      }
    } catch (e) { console.warn('short resolve', e); }
  })();

  // --- Projects save/load ---
  const saveProjBtn = safeGet('saveProjectBtn');
  if (saveProjBtn) saveProjBtn.addEventListener('click', () => {
    const name = prompt('Project name', STATE.projectName || ('proj_' + Date.now()));
    if (!name) return;
    const obj = { name, files: STATE.files, updated: Date.now() };
    try {
      localStorage.setItem('kproj_' + name, JSON.stringify(obj));
      STATE.projectName = name;
      const pn = safeGet('projectName'); if (pn) pn.textContent = name;
      const pu = safeGet('projectUpdated'); if (pu) pu.textContent = 'Last saved: ' + nowStr();
      setStatus('Project saved: ' + name);
    } catch (e) { alert('Save failed: ' + e.message); }
  });

  const openProjBtn = safeGet('openProjectBtn');
  if (openProjBtn) openProjBtn.addEventListener('click', () => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('kproj_')).map(k => k.slice(6));
    if (keys.length === 0) return alert('No saved projects');
    const pick = prompt('Open project:\n' + keys.join('\n'));
    if (!pick) return;
    const raw = localStorage.getItem('kproj_' + pick);
    if (!raw) return alert('Project not found');
    try {
      const obj = JSON.parse(raw);
      STATE.files = obj.files || []; STATE.currentId = null; STATE.projectName = obj.name || pick;
      const pn = safeGet('projectName'); if (pn) pn.textContent = STATE.projectName;
      const pu = safeGet('projectUpdated'); if (pu) pu.textContent = 'Last saved: ' + new Date(obj.updated).toLocaleString();
      renderFiles(); setStatus('Loaded: ' + pick);
    } catch (e) { alert('Load failed: ' + e.message); }
  });

  // --- Library minimal: save current file to library and open library entries ---
  const openLibBtn = safeGet('openLibraryBtn');
  if (openLibBtn) openLibBtn.addEventListener('click', () => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('klib_')).map(k => k.slice(5));
    if (keys.length === 0) return alert('No library entries');
    const pick = prompt('Library entries:\n' + keys.join('\n') + '\n\nType name to insert', keys[0]);
    if (!pick) return;
    const raw = localStorage.getItem('klib_' + pick);
    if (!raw) return alert('Library item not found'); try {
      const obj = JSON.parse(raw); addFile(obj.name, obj.type, obj.content); setStatus('Added from library: ' + obj.name);
    } catch (e) { alert('Library read error: ' + e.message); }
  });

  const addToLibBtn = safeGet('addToLibraryBtn');
  if (addToLibBtn) addToLibBtn.addEventListener('click', () => {
    if (!STATE.currentId) return alert('Select a file then Save to library');
    const f = findFile(STATE.currentId);
    if (!f) return;
    const key = prompt('Library key name', f.name);
    if (!key) return;
    try {
      localStorage.setItem('klib_' + key, JSON.stringify({ name: f.name, type: f.type, content: f.content }));
      setStatus('Saved to library: ' + key);
      alert('Saved to library: ' + key);
    } catch (e) { alert('Library save error: ' + e.message); }
  });

  // --- QR (very small fallback) ---
  const qrBtn = safeGet('qrBtn');
  if (qrBtn) qrBtn.addEventListener('click', () => {
    const out = safeGet('outputArea'); if (!out || !out.value) return alert('Generate first');
    const canvas = safeGet('qrCanvas');
    const modal = safeGet('qrModal');
    if (!canvas || !modal) return alert('QR UI missing');
    // For huge strings, warn
    const bytes = new TextEncoder().encode(out.value).length;
    if (bytes > 800) {
      if (!confirm('Data is large (~' + bytes + ' bytes). QR may not be scannable. Continue?')) return;
    }
    // Very simple QR fallback: draw the text (not a real QR) if tiny generator missing
    try {
      // Try simple text rendering into canvas
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white'; ctx.fillRect(0,0,canvas.width, canvas.height);
      ctx.fillStyle = 'black'; ctx.font = '12px monospace';
      // trim to reasonable length per line
      const text = out.value;
      let y = 20;
      const maxW = canvas.width - 16;
      const words = text.split(' ');
      let line = '';
      for (let w of words) {
        const test = line + w + ' ';
        if (ctx.measureText(test).width > maxW) { ctx.fillText(line, 8, y); line = w + ' '; y += 14; }
        else line = test;
        if (y > canvas.height - 20) break;
      }
      if (line) ctx.fillText(line, 8, y);
      modal.setAttribute('aria-hidden', 'false'); modal.style.display = 'flex';
    } catch (e) {
      alert('QR draw failed: ' + e.message);
    }
  });
  const closeQr = safeGet('closeQr'); if (closeQr) closeQr.addEventListener('click', ()=>{ const m = safeGet('qrModal'); if (m){ m.setAttribute('aria-hidden','true'); m.style.display='none'; } });

  // --- Theme toggle ---
  const themeToggle = safeGet('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      if (cur === 'dark') { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('koder_theme','light'); }
      else { document.documentElement.setAttribute('data-theme','dark'); localStorage.setItem('koder_theme','dark'); }
    });
  }
  // apply stored theme
  (function applyTheme() {
    const t = localStorage.getItem('koder_theme') || 'light';
    if (t === 'dark') document.documentElement.setAttribute('data-theme','dark');
  })();

  // --- Validate (basic) ---
  const validateBtn = safeGet('validateBtn');
  if (validateBtn) validateBtn.addEventListener('click', () => {
    const combined = combineAll();
    const messages = [];
    if (!/<!doctype html>/i.test(combined)) messages.push('Missing <!DOCTYPE html>');
    if (!/<meta[^>]*charset/i.test(combined)) messages.push('Missing <meta charset>');
    if (combined.includes('eval(')) messages.push('Contains eval() — avoid');
    const consoleOut = safeGet('consoleOutput');
    if (messages.length === 0) { if (consoleOut) consoleOut.value = 'No obvious issues'; alert('No obvious issues'); }
    else { if (consoleOut) consoleOut.value = messages.join('\n'); alert('Validator: ' + messages.join('; ')); }
  });

  // --- Init with sample files for user convenience ---
  (function initSample() {
    if (STATE.files.length === 0) {
      addFile('index.html','html','<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>Demo</title>\n</head>\n<body>\n<h1>Demo Page</h1>\n<p>Edit files and generate.</p>\n</body>\n</html>');
      addFile('styles.css','css','body{font-family:system-ui;padding:20px;}h1{color:#2563eb;}');
      addFile('app.js','js','console.log(\"Demo app.js\");');
    }
    renderFiles();
  })();

  // --- Final: initial status ---
  setStatus('Ready');

}); // end DOMContentLoaded
