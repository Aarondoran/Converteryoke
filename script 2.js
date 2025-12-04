// START FILE: script.js
/* Offline Builder — Mini IDE script.js
   CHANGES MADE (minimal & localised):
   - Added "Delete Project" button (moves project to trash) -> id: delete-project
   - Replaced prompt-based Add File and Insert File with real file pickers:
       - add-file uses #add-file-input (multiple) to import files (filename -> path)
       - insert-file uses #insert-file-input (multiple) to insert file contents into current file or create new file
   - Improved file-tree building + rendering:
       - hides `.keep` marker files
       - more accurate folder vs file detection
   - Added small internal checklist and inline comments where changes are present.
   Nothing else in original app logic was altered.
*/

(async function(){
  'use strict';

  /* ---------- Internal checklist (for maintenance) ----------
   [x] Add Delete Project button and wire to existing deleteProject()
   [x] Add add-file-input and insert-file-input elements and handlers
   [x] Use file.text() to read content (async)
   [x] Use file.name as path (if file name exists, will overwrite unless user changes)
   [x] Improve buildTree() to hide .keep and handle folders properly
   [x] Render file tree with toggleable folders and click-to-open files
   [x] Ensure original behaviors (autosave, preview, zip etc.) remain untouched
  ------------------------------------------------------------ */

  /* ---------- IndexedDB helper ---------- */
  function openDB(name='offline-builder', version=1){
    return new Promise((resolve,reject)=>{
      const r = indexedDB.open(name, version);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains('projects')) db.createObjectStore('projects',{keyPath:'id'});
        if(!db.objectStoreNames.contains('libraries')) db.createObjectStore('libraries',{keyPath:'id'});
        if(!db.objectStoreNames.contains('trash')) db.createObjectStore('trash',{keyPath:'id'});
      };
      r.onsuccess = e => resolve(e.target.result);
      r.onerror = e => reject(e.target.error);
    });
  }
  function idbPut(db,store,val){ return new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(val); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e.target.error); }); }
  function idbGet(db,store,key){ return new Promise((res,rej)=>{ const tx=db.transaction(store,'readonly'); const rq=tx.objectStore(store).get(key); rq.onsuccess=()=>res(rq.result); rq.onerror=e=>rej(e.target.error); }); }
  function idbGetAll(db,store){ return new Promise((res,rej)=>{ const tx=db.transaction(store,'readonly'); const rq=tx.objectStore(store).getAll(); rq.onsuccess=()=>res(rq.result); rq.onerror=e=>rej(e.target.error); }); }
  function idbDelete(db,store,key){ return new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e.target.error); }); }

  const db = await openDB();

  /* ---------- DOM refs ---------- */
  const $ = id => document.getElementById(id);
  const projectSelect = $('project-select');
  const newProjectBtn = $('new-project');
  const importFolderBtn = $('import-folder');
  const folderInput = $('folder-input');
  const downloadZipBtn = $('download-zip');
  const downloadHtmlBtn = $('download-html');
  const generateLinkBtn = $('generate-link');
  const liveToggle = $('live-toggle');
  const autoInsertCheckbox = $('auto-insert');
  const addFileBtn = $('add-file');
  const addFolderBtn = $('add-folder');
  const deleteFileBtn = $('delete-file');
  const fileTreeEl = $('file-tree');
  const libraryList = $('library-list');
  const addLibBtn = $('add-lib');
  const delLibBtn = $('del-lib');
  const errorBox = $('error-box');
  const editor = $('editor');
  const preview = $('preview');
  const previewPane = $('preview-pane');
  const editorPane = $('editor-pane');
  const resizer = $('resizer');
  const toggleEditorBtn = $('toggle-editor');
  const togglePreviewBtn = $('toggle-preview');
  const previewCurrentBtn = $('preview-current');
  const copyBtn = $('copy-html');
  const insertFileBtn = $('insert-file');
  const outputEl = $('output');

  // NEW hidden file inputs (created in HTML)
  const addFileInput = $('add-file-input');
  const insertFileInput = $('insert-file-input');

  // NEW Delete Project button
  const deleteProjectBtn = $('delete-project');

  /* ---------- State ---------- */
  let projects = [];
  let libs = [];
  let currentProject = null;
  let currentPath = null; // path string
  let autosaveTimer = null;
  let editorVisible = true;
  let previewVisible = true;

  /* ---------- Utilities ---------- */
  function uid(prefix='id'){ return prefix + '-' + Math.random().toString(36).slice(2,9); }
  function now(){ return new Date().toISOString(); }
  function showError(msg){ errorBox.textContent = msg; errorBox.style.display = 'block'; console.error(msg); }
  function clearError(){ errorBox.textContent = ''; errorBox.style.display = 'none'; }
  function showMessage(msg){ outputEl.value = msg; setTimeout(()=>{ if(outputEl.value===msg) outputEl.value=''; },2000); }

  /* ---------- Project CRUD ---------- */
  async function loadProjects(){ projects = await idbGetAll(db,'projects'); renderProjectSelect(); }
  function renderProjectSelect(){ projectSelect.innerHTML = '<option value="">-- Select Project --</option>'; projects.forEach(p=>{ const o=document.createElement('option'); o.value=p.id; o.textContent=p.name; projectSelect.appendChild(o); }); }
  async function createProject(name='Project'){ const p={id:uid('proj'),name,files:{},meta:{created:now(),updated:now(),snapshots:[]}}; await idbPut(db,'projects',p); projects.push(p); renderProjectSelect(); projectSelect.value=p.id; await openProject(p.id); }
  async function openProject(id){ if(!id) return; const p = await idbGet(db,'projects',id); if(!p) return; currentProject = p; currentPath = null; renderFileTree(); renderLibrary(); clearError(); editor.value = ''; }
  async function saveProject(){ if(!currentProject) return showError('No project open'); currentProject.meta.updated = now(); await idbPut(db,'projects',currentProject); const idx = projects.findIndex(x=>x.id===currentProject.id); if(idx>=0) projects[idx]=currentProject; }
  async function deleteProject(id){ if(!id) return; const p = await idbGet(db,'projects',id); if(!p) return; p.deletedAt = now(); await idbPut(db,'trash',p); await idbDelete(db,'projects',id); await loadProjects(); currentProject = null; currentPath = null; editor.value = ''; renderFileTree(); showMessage('Moved to trash'); }

  projectSelect.addEventListener('change', async ()=>{ const id = projectSelect.value; if(!id) return; await openProject(id); });
  newProjectBtn.addEventListener('click', async ()=>{ const name = prompt('Project name','My Project'); if(name) await createProject(name); });

  // NEW: Delete project button UI handler (minimal confirm)
  deleteProjectBtn.addEventListener('click', async ()=>{
    if(!currentProject) return showError('No project open to delete');
    if(!confirm(`Delete project "${currentProject.name}"? This moves it to trash.`)) return;
    await deleteProject(currentProject.id);
  });

  /* ---------- File tree helpers (IMPROVED) ---------- */
  function pathParts(path){ return path.split('/').filter(Boolean); }

  // buildTree: returns nested object with metadata per node
  function buildTree(files){
    const root = {};
    Object.keys(files||{}).forEach(path=>{
      // hide folder marker files like ".keep"
      if(path.endsWith('/.keep') || path === '.keep') {
        // ensure folder exists but do not display .keep as file
        const parts = pathParts(path.replace(/\/?\.keep$/, ''));
        let node = root;
        parts.forEach((part)=>{
          if(!node[part]) node[part] = { __children: {}, __isFile: false, __name: part };
          node = node[part].__children;
        });
        return;
      }

      const parts = pathParts(path);
      let node = root;
      parts.forEach((p, i)=>{
        const isLast = i === parts.length - 1;
        if(!node[p]) node[p] = { __children: {}, __isFile: false, __name: p, __path: null };
        if(isLast){
          // mark as file
          node[p].__isFile = true;
          node[p].__path = path;
        }
        node = node[p].__children;
      });
    });
    return root;
  }

  function renderFileTree(){
    fileTreeEl.innerHTML = '';
    if(!currentProject) { fileTreeEl.innerHTML = '<div style="color:var(--muted)">No project open</div>'; return; }
    const tree = buildTree(currentProject.files);

    function renderNode(node, container, base=''){
      // sort keys: folders first, then files, alphabetically
      const keys = Object.keys(node).sort((a,b)=>{
        const A = node[a], B = node[b];
        if(A.__isFile !== B.__isFile) return A.__isFile ? 1 : -1;
        return a.localeCompare(b);
      });

      keys.forEach(key=>{
        const itm = node[key];
        const isFile = !!itm.__isFile;
        const row = document.createElement('div');
        row.className = 'file-item';
        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '8px';

        const name = document.createElement('div');
        name.textContent = key;
        name.style.cursor = 'pointer';
        name.title = isFile ? (itm.__path || '') : 'Folder';
        name.onclick = ()=>{
          const full = (base?base+'/':'') + key;
          if(isFile){
            openFile(itm.__path);
          } else {
            // toggle children
            const child = row.querySelector('.children');
            if(child) child.style.display = child.style.display === 'none' ? 'block' : 'none';
          }
        };

        left.appendChild(name);
        row.appendChild(left);

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.gap = '6px';
        // file actions: Edit / Insert (for files)
        if(isFile){
          const editBtn = document.createElement('button');
          editBtn.className = 'btn small';
          editBtn.textContent = 'Edit';
          editBtn.onclick = (ev)=>{
            ev.stopPropagation();
            openFile(itm.__path);
          };
          const insertBtn = document.createElement('button');
          insertBtn.className = 'btn small';
          insertBtn.textContent = 'Insert';
          insertBtn.onclick = (ev)=>{
            ev.stopPropagation();
            if(!currentProject || !currentPath) return showError('Select file to insert into');
            // insert file content into current active file
            const content = currentProject.files[itm.__path] || '';
            currentProject.files[currentPath] = (currentProject.files[currentPath] || '') + '\n' + content;
            editor.value = currentProject.files[currentPath];
            saveProject();
            showMessage('Inserted ' + itm.__path);
          };
          right.appendChild(editBtn);
          right.appendChild(insertBtn);
        } else {
          // folder indicator
          const ctr = document.createElement('div');
          ctr.style.opacity = '0.6';
          ctr.style.fontSize = '12px';
          ctr.textContent = 'folder';
          right.appendChild(ctr);
        }

        row.appendChild(right);

        if(!isFile && Object.keys(itm.__children).length){
          const childrenWrap = document.createElement('div');
          childrenWrap.className = 'children';
          childrenWrap.style.paddingLeft = '12px';
          childrenWrap.style.display = 'none';
          row.appendChild(childrenWrap);
          renderNode(itm.__children, childrenWrap, (base?base+'/':'') + key);
        }

        container.appendChild(row);
      });
    }

    renderNode(tree, fileTreeEl, '');
  }

  async function openFile(path){
    currentPath = path;
    editor.value = currentProject.files[path]||'';
    editor.focus();
  }

  // ORIGINAL addFile used prompt; now we trigger file picker and import selected files
  async function addFileFromPicker(filesList){
    if(!currentProject) return showError('Open/create a project');
    const files = Array.from(filesList);
    if(!files.length) return;
    for(const f of files){
      // prefer webkitRelativePath if available, otherwise use name
      const p = f.webkitRelativePath && f.webkitRelativePath.trim() !== '' ? f.webkitRelativePath : f.name;
      try{
        const txt = await f.text();
        currentProject.files[p] = txt;
      } catch(err){
        currentProject.files[p] = '';
      }
    }
    await saveProject();
    renderFileTree();
    showMessage('Added ' + files.length + ' file(s)');
  }

  // Keep addFolder behavior as-is (creates .keep marker)
  async function addFolder(){
    if(!currentProject) return showError('Open/create a project');
    const name = prompt('Folder name');
    if(!name) return;
    const p = name.replace(/\/$/,'') + '/.keep';
    currentProject.files[p] = currentProject.files[p] || '';
    await saveProject();
    renderFileTree();
  }

  async function deleteSelectedFile(){
    if(!currentProject || !currentPath) return showError('No file selected');
    if(!confirm('Delete '+currentPath+' ?')) return;
    delete currentProject.files[currentPath];
    currentPath = null;
    editor.value = '';
    await saveProject();
    renderFileTree();
  }

  // Wire the Add File button to open the hidden file input
  addFileBtn.addEventListener('click', ()=>{
    addFileInput.value = null;
    addFileInput.click();
  });
  // When user selects files, import them into the current project
  addFileInput.addEventListener('change', async (e)=>{
    const files = Array.from(e.target.files || []);
    if(!files.length) return;
    if(!currentProject) await createProject('Imported');
    await addFileFromPicker(files);
    addFileInput.value = '';
  });

  addFolderBtn.addEventListener('click', addFolder);
  deleteFileBtn.addEventListener('click', deleteSelectedFile);

  /* ---------- Folder import (unchanged) ---------- */
  folderInput.addEventListener('change', async (e)=>{
    const files = Array.from(e.target.files);
    if(!files.length) return;
    if(!currentProject) await createProject('Imported');
    for(const f of files){ const path = f.webkitRelativePath || f.name; try{ const txt = await f.text(); currentProject.files[path] = txt; }catch(err){ currentProject.files[path] = ''; } }
    await saveProject(); renderFileTree(); showMessage('Folder imported'); folderInput.value='';
  });
  importFolderBtn.addEventListener('click', ()=> folderInput.click());

  /* ---------- Library (unchanged logic) ---------- */
  async function loadLibs(){ libs = await idbGetAll(db,'libraries'); renderLibrary(); }
  function renderLibrary(){ libraryList.innerHTML=''; libs.forEach(item=>{ const d=document.createElement('div'); d.className='lib-item'; d.textContent = item.name; const actions=document.createElement('div'); const ins=document.createElement('button'); ins.textContent='Insert'; ins.className='btn small'; ins.onclick=()=>{ if(!currentProject || !currentPath) return showError('Select file to insert into'); currentProject.files[currentPath] = (currentProject.files[currentPath]||'') + '\n' + item.content; editor.value = currentProject.files[currentPath]; saveProject(); }; const del=document.createElement('button'); del.textContent='Delete'; del.className='btn small'; del.onclick=async ()=>{ if(!confirm('Delete library item?')) return; await idbDelete(db,'libraries',item.id); await loadLibs(); }; actions.appendChild(ins); actions.appendChild(del); d.appendChild(actions); libraryList.appendChild(d); }); }
  addLibBtn.addEventListener('click', async ()=>{ const name = prompt('Library name'); if(!name) return; const content = prompt('Paste content (code/snippet)'); const item = {id:uid('lib'),name,content,created:now()}; await idbPut(db,'libraries',item); await loadLibs(); });

  /* ---------- Autosave editor (unchanged) ---------- */
  function scheduleSave(){ if(autosaveTimer) clearTimeout(autosaveTimer); autosaveTimer = setTimeout(async ()=>{ if(currentProject && currentPath){ currentProject.files[currentPath] = editor.value; // snapshot
        currentProject.meta.snapshots = currentProject.meta.snapshots || []; currentProject.meta.snapshots.unshift({path:currentPath,content:editor.value,at:now()}); if(currentProject.meta.snapshots.length>5) currentProject.meta.snapshots.pop(); await saveProject(); if(liveToggle.checked) refreshPreview(); } }, 700); }
  editor.addEventListener('input', ()=>{ clearError(); scheduleSave(); });

  /* ---------- Preview & error capture (unchanged) ---------- */
  function wrapForPreview(html){
    return html.replace('</body>', `\n<script>\n(function(){\n  function send(m){ parent.postMessage({type:'preview-error', message:m}, '*'); }\n  var orig=console.error; console.error=function(){ send(Array.from(arguments).join(' ')); orig.apply(console,arguments); }\n  window.onerror=function(msg,url,line,col,err){ send(msg + ' at ' + (url||'') + ':' + (line||'?')); }\n})();\n<\/script>\n</body>`);
  }
  window.addEventListener('message', e=>{ if(e.data && e.data.type==='preview-error'){ showError('[preview] '+ e.data.message); } });

  function refreshPreview(){ if(!currentProject) return; clearError(); let doc=''; if(currentProject.files['index.html']){ doc = currentProject.files['index.html']; } else { const css = Object.keys(currentProject.files).filter(p=>p.endsWith('.css')).map(p=>'/* '+p+' */\n'+currentProject.files[p]).join('\n'); const js = Object.keys(currentProject.files).filter(p=>p.endsWith('.js')).map(p=>'// '+p+'\n'+currentProject.files[p]).join('\n'); doc = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="app"></div><script>try{${js}}catch(e){parent.postMessage({type:'preview-error',message:e.message},'*')}<\/script></body></html>`; }
    preview.srcdoc = wrapForPreview(doc);
  }

  previewCurrentBtn.addEventListener('click', ()=>{
    if(!currentPath) return showError('No file selected'); clearError(); const content = editor.value; if(currentPath.endsWith('.html')){ preview.srcdoc = wrapForPreview(content); } else if(currentPath.endsWith('.css')){ preview.srcdoc = wrapForPreview(`<!doctype html><html><head><style>${content}</style></head><body><div>CSS Preview</div></body></html>`); } else if(currentPath.endsWith('.js')){ preview.srcdoc = wrapForPreview(`<!doctype html><html><body><script>try{${content}}catch(e){parent.postMessage({type:'preview-error',message:e.message},'*')}</script></body></html>`); } else { preview.srcdoc = wrapForPreview(`<!doctype html><body><pre>${escapeHtml(content)}</pre></body></html>`); } });

  function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  liveToggle.addEventListener('change', ()=>{ if(liveToggle.checked) refreshPreview(); });

  /* ---------- Pane toggles & resizer (unchanged) ---------- */
  function updatePanes(){ editorPane.style.display = editorVisible? 'flex':'none'; previewPane.style.display = previewVisible? 'flex':'none'; if(!editorVisible && previewVisible){ previewPane.style.flex = '1 1 100%'; } else if(editorVisible && !previewVisible){ editorPane.style.flex = '1 1 100%'; } else { editorPane.style.flex='1'; previewPane.style.flex='1'; } }
  toggleEditorBtn.addEventListener('click', ()=>{ editorVisible = !editorVisible; updatePanes(); }); togglePreviewBtn.addEventListener('click', ()=>{ previewVisible = !previewVisible; updatePanes(); }); updatePanes();

  (function(){ let dragging=false; let startX=0; let startWidth=0; resizer.addEventListener('pointerdown', e=>{ dragging=true; startX=e.clientX; startWidth = editorPane.getBoundingClientRect().width; resizer.setPointerCapture(e.pointerId); }); window.addEventListener('pointermove', e=>{ if(!dragging) return; const dx = e.clientX - startX; const newW = Math.max(120, startWidth + dx); editorPane.style.flex = '0 0 '+ newW + 'px'; previewPane.style.flex = '1'; }); window.addEventListener('pointerup', e=>{ dragging=false; }); })();

  /* ---------- Insert file (REPLACED prompt with file picker) ---------- */
  // When Insert File button is clicked, open the hidden input
  insertFileBtn.addEventListener('click', ()=>{
    insertFileInput.value = null;
    insertFileInput.click();
  });

  // On picking files, if there is a current file selected -> insert content into that file.
  // Otherwise, create new files in the project with the chosen filenames and open the first one.
  insertFileInput.addEventListener('change', async (e)=>{
    const files = Array.from(e.target.files || []);
    if(!files.length) return;
    if(!currentProject) await createProject('Imported');
    // If there is a selected file to insert into
    if(currentPath){
      for(const f of files){
        try{
          const txt = await f.text();
          currentProject.files[currentPath] = (currentProject.files[currentPath] || '') + '\n' + txt;
        } catch(err){
          // ignore
        }
      }
      editor.value = currentProject.files[currentPath];
      await saveProject();
      if(liveToggle.checked) refreshPreview();
      showMessage('Inserted into ' + currentPath);
    } else {
      // create new files in project
      for(const f of files){
        const p = f.webkitRelativePath && f.webkitRelativePath.trim() !== '' ? f.webkitRelativePath : f.name;
        try{ const txt = await f.text(); currentProject.files[p] = txt; } catch(err){ currentProject.files[p] = ''; }
      }
      await saveProject();
      renderFileTree();
      showMessage('Inserted ' + files.length + ' file(s) into project');
    }
    insertFileInput.value = '';
  });

  /* ---------- Copy output (data URL) ---------- */
  copyBtn.addEventListener('click', async ()=>{ if(!outputEl.value) return showError('No output generated'); try{ await navigator.clipboard.writeText(outputEl.value); showMessage('Copied'); }catch(e){ showError('Clipboard failed: '+e.message); } });

  /* ---------- Generate Data URL / Download HTML / ZIP (unchanged) ---------- */
  function combineProjectHtml(proj){ if(proj.files['index.html']) return proj.files['index.html']; const css = Object.keys(proj.files).filter(p=>p.endsWith('.css')).map(p=>'/* '+p+' */\n'+proj.files[p]).join('\n'); const js = Object.keys(proj.files).filter(p=>p.endsWith('.js')).map(p=>'// '+p+'\n'+proj.files[p]).join('\n'); return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="app"></div><script>${js}<\/script></body></html>`; }

  generateLinkBtn.addEventListener('click', ()=>{
    if(!currentProject) return showError('Open a project'); clearError(); const html = combineProjectHtml(currentProject); try{ const b64 = btoa(unescape(encodeURIComponent(html))); const data = 'data:text/html;base64,' + b64; outputEl.value = data; showMessage('Generated data URL'); }catch(e){ showError('Encode failed: '+e.message); } });

  downloadHtmlBtn.addEventListener('click', ()=>{ if(!currentProject) return showError('Open a project'); clearError(); const html = combineProjectHtml(currentProject); const blob = new Blob([html], {type:'text/html'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download = (currentProject.name||'project') + '.html'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); showMessage('Download started'); });

  /* ---------- ZIP generation (unchanged) ---------- */
  function crc32(buf){ const table = crc32.table || (crc32.table=(function(){ const t=new Uint32Array(256); for(let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)); t[i]=c>>>0; } return t; })()); let crc = 0 ^ (-1); for(let i=0;i<buf.length;i++) crc = (crc>>>8) ^ table[(crc ^ buf[i]) & 0xFF]; return (crc ^ (-1)) >>> 0; }
  function le(n,bytes){ const a=new Uint8Array(bytes); for(let i=0;i<bytes;i++) a[i] = (n >>> (8*i)) & 0xFF; return a; }
  async function createZip(proj){ const encoder=new TextEncoder(); const local=[]; const central=[]; let offset=0; for(const path of Object.keys(proj.files)){ const txt = proj.files[path]||''; const data = encoder.encode(txt); const crc = crc32(data); const compSize = data.length; const uncompSize = data.length; const nameBuf = encoder.encode(path);
      const localHeader = new Uint8Array(30 + nameBuf.length);
      let p=0; localHeader.set(le(0x04034b50,4),p); p+=4; localHeader.set(le(20,2),p); p+=2; localHeader.set(le(0,2),p); p+=2; localHeader.set(le(0,2),p); p+=2; localHeader.set(le(0,2),p); p+=2; localHeader.set(le(crc,4),p); p+=4; localHeader.set(le(compSize,4),p); p+=4; localHeader.set(le(uncompSize,4),p); p+=4; localHeader.set(le(nameBuf.length,2),p); p+=2; localHeader.set(le(0,2),p); p+=2; localHeader.set(nameBuf,p); p+=nameBuf.length; local.push(localHeader); local.push(data);
      const cent = new Uint8Array(46 + nameBuf.length); p=0; cent.set(le(0x02014b50,4),p); p+=4; cent.set(le(20,2),p); p+=2; cent.set(le(20,2),p); p+=2; cent.set(le(0,2),p); p+=2; cent.set(le(0,2),p); p+=2; cent.set(le(0,2),p); p+=2; cent.set(le(crc,4),p); p+=4; cent.set(le(compSize,4),p); p+=4; cent.set(le(uncompSize,4),p); p+=4; cent.set(le(nameBuf.length,2),p); p+=2; cent.set(le(0,2),p); p+=2; cent.set(le(0,2),p); p+=2; cent.set(le(0,2),p); p+=2; cent.set(le(0,4),p); p+=4; cent.set(le(offset,4),p); p+=4; cent.set(nameBuf,p); p+=nameBuf.length; central.push(cent);
      offset += localHeader.length + data.length; }
    const centralOffset = offset; for(const c of central) offset += c.length; const end = new Uint8Array(22); let q=0; end.set(le(0x06054b50,4),q); q+=4; end.set(le(0,2),q); q+=2; end.set(le(0,2),q); q+=2; end.set(le(central.length,2),q); q+=2; end.set(le(central.length,2),q); q+=2; end.set(le(offset - centralOffset,4),q); q+=4; end.set(le(centralOffset,4),q); q+=4; end.set(le(0,2),q); q+=2; const parts = [...local, ...central, end]; return new Blob(parts,{type:'application/zip'}); }

  downloadZipBtn.addEventListener('click', async ()=>{ if(!currentProject) return showError('Open a project'); clearError(); try{ const zip = await createZip(currentProject); const url=URL.createObjectURL(zip); const a=document.createElement('a'); a.href=url; a.download = (currentProject.name||'project') + '.zip'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); showMessage('ZIP download started'); }catch(e){ showError('ZIP failed: '+e.message); } });

  /* ---------- Simple linters (unchanged) ---------- */
  function lintHTML(s){ try{ const doc = new DOMParser().parseFromString(s,'text/html'); const err = doc.querySelector('parsererror'); if(err) return err.textContent.slice(0,200); return null; }catch(e){ return e.message; } }
  function lintJS(s){ try{ new Function(s); return null; }catch(e){ return e.message; } }

  /* ---------- Generate initial state (unchanged except we clear file tree on load) ---------- */
  await loadProjects(); await loadLibs(); if(projects.length){ projectSelect.value = projects[0].id; await openProject(projects[0].id); }

  /* ---------- Misc actions ---------- */
  window.addEventListener('keydown', (e)=>{ if((e.ctrlKey||e.metaKey) && e.key==='s'){ e.preventDefault(); if(currentProject && currentPath){ currentProject.files[currentPath] = editor.value; saveProject(); showMessage('Saved'); } } if((e.ctrlKey||e.metaKey) && e.key==='p'){ e.preventDefault(); previewCurrentBtn.click(); } });

  // delete project via prompt (kept for compatibility)
  window.deleteProjectByPrompt = async ()=>{ const id = prompt('Enter project id to delete'); if(!id) return; await deleteProject(id); };

})();
 // END FILE: script.js
