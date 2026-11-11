'use strict';
// SFTP 模块 — 由 build_single.ps1 内联到 index.html
(function(){
if (typeof el === 'undefined') return;

// ===================== SFTP =====================
var _sftpCtxTabId = null;

function newSftpTab(label, conn, sshTabId) {
  var id = 't' + Date.now();
  var div = document.createElement('div');
  div.id = 'tab_' + id;
  div.className = 'tab sftp-tab';
  var displayLabel = '\uD83D\uDCC1 ' + label;
  div.innerHTML = '<span class="tab-dot" id="tdot_' + id + '" style="background:#4fc3f7;"></span><span class="tab-label">' + esc(displayLabel) + '</span><button class="tab-close">\u00D7</button>';
  el('tabs').appendChild(div);

  var panel = el('sftpPanel').cloneNode(true);
  panel.id = 'sftp_' + id;
  panel.style.display = '';
  el('terminals').appendChild(panel);

  tabs[id] = {
    term: null, termDiv: panel,
    ws: sshTabId && tabs[sshTabId] ? tabs[sshTabId].ws : null,
    conn: conn, label: label,
    isSftp: true, sftpPath: '/',
    sshTabId: sshTabId || null
  };

  var closeBtn = div.querySelector('.tab-close');
  if (closeBtn) closeBtn.onclick = function(){ closeTab(id); };
  div.onclick = function(){ if (tabs[id]) activateTab(id); };

  activateTab(id);
  updateCloseAllBtn();
  bindSftpPanel(id, panel);
  sftpList(id, '/');
  if (!tabs[id].ws || tabs[id].ws.readyState !== 1) {
    showSftpStatus(id, '\u26A0 无 SSH 连接，无法使用 SFTP', true);
  }
}

function bindSftpPanel(tabId, panel) {
  var homeBtn = panel.querySelector('#sftpHome');
  var upBtn = panel.querySelector('#sftpUp');
  var mkdirBtn = panel.querySelector('#sftpMkdir');
  var uploadBtn = panel.querySelector('#sftpUpload');
  if (homeBtn) homeBtn.onclick = function(){ sftpList(tabId, '/'); };
  if (upBtn) upBtn.onclick = function(){
    var p = tabs[tabId].sftpPath;
    if (p === '/') return;
    var up = p.split('/').slice(0,-1).join('/') || '/';
    sftpList(tabId, up);
  };
  if (mkdirBtn) mkdirBtn.onclick = function(){
    var name = prompt('\u8BF7\u8F93\u5165\u76EE\u5F55\u540D\u79F0:');
    if (!name) return;
    var path = tabs[tabId].sftpPath === '/' ? '/' + name : tabs[tabId].sftpPath + '/' + name;
    sftpMkdir(tabId, path);
  };
  if (uploadBtn) {
    uploadBtn.onclick = function(){ panel.querySelector('#sftpUploadInput').click(); };
    var uploadInput = panel.querySelector('#sftpUploadInput');
    if (uploadInput) {
      uploadInput.onchange = function(e){
        var files = e.target.files;
        if (!files.length) return;
        for (var i = 0; i < files.length; i++) sftpUploadFile(tabId, files[i]);
        uploadInput.value = '';
      };
    }
  }
}

function sftpList(tabId, path) {
  var tab = tabs[tabId];
  if (!tab) return;
  var ws = tab.ws;
  if (!ws || ws.readyState !== 1) { showSftpStatus(tabId, '\u26A0 无 SSH 连接，无法使用 SFTP', true); return; }
  showSftpLoading(tabId);
  var reqId = 's' + Date.now();
  tab._sftpReqId = reqId;
  ws.send(JSON.stringify({ type: 'sftp-list', id: reqId, path: path }));
  var handler = function(e){
    var m = JSON.parse(e.data);
    if (m.id !== reqId) return;
    ws.removeEventListener('message', handler);
    tab._sftpReqId = null;
    if (m.type === 'sftp-list') {
      tab.sftpPath = m.path;
      renderSftpList(tabId, m.items, m.path);
    } else if (m.type === 'sftp-error') {
      showSftpError(tabId, m.data);
    }
  };
  ws.addEventListener('message', handler);
  setTimeout(function(){
    if (tab._sftpReqId === reqId) {
      ws.removeEventListener('message', handler);
      tab._sftpReqId = null;
      showSftpError(tabId, '\u8BF7\u6C42\u8D85\u65F6');
    }
  }, 15000);
}

function showSftpLoading(tabId) {
  var panel = tabs[tabId] && tabs[tabId].termDiv;
  if (!panel) return;
  var list = panel.querySelector('#sftpFileList');
  var pathBar = panel.querySelector('#sftpPathBar');
  if (pathBar) pathBar.innerHTML = '<span style="color:#888;font-size:12px;padding:2px 4px;">\u52A0\u8F7D\u4E2D\u2026</span>';
  if (list) list.innerHTML = '<div class=sftp-loading>\u23F3 \u52A0\u8F7D\u4E2D\u2026</div>';
}

function showSftpError(tabId, msg) {
  var panel = tabs[tabId] && tabs[tabId].termDiv;
  if (!panel) return;
  var list = panel.querySelector('#sftpFileList');
  if (list) list.innerHTML = '<div class=sftp-error>\u274C ' + esc(msg) + '</div>';
}

function showSftpStatus(tabId, msg, isError) {
  var panel = tabs[tabId] && tabs[tabId].termDiv;
  if (!panel) return;
  var s = panel.querySelector('#sftpStatus');
  if (s) { s.textContent = msg; s.style.color = isError ? '#f48771' : '#888'; }
}

function renderSftpList(tabId, items, path) {
  var tab = tabs[tabId];
  if (!tab) return;
  var panel = tab.termDiv;
  var list = panel.querySelector('#sftpFileList');
  var pathBar = panel.querySelector('#sftpPathBar');
  var pathEl = panel.querySelector('#sftpPath');
  if (!list) return;
  if (pathEl) pathEl.textContent = path;

  // 面包屑
  if (pathBar) {
    var parts = path.split('/').filter(Boolean);
    var html = '<span class="sftp-breadcrumb" data-path="/">/</span>';
    var cur = '';
    parts.forEach(function(p){ cur += '/' + p; html += '<span class="sftp-breadcrumb sep">/</span><span class="sftp-breadcrumb" data-path="' + esc(cur) + '">' + esc(p) + '</span>'; });
    pathBar.innerHTML = html;
    pathBar.querySelectorAll('.sftp-breadcrumb:not(.sep)').forEach(function(span){
      span.onclick = function(){ sftpList(tabId, span.dataset.path); };
    });
  }

  items.sort(function(a,b){
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  if (!items.length) {
    list.innerHTML = '<div class=sftp-empty>\uD83D\uDCC2 \u7A7A\u76EE\u5F55</div>';
    showSftpStatus(tabId, '\u7A7A\u76EE\u5F55');
    return;
  }

  var html = '<div class=sftp-header><span class=sftp-name>\u540D\u79F0</span><span class=sftp-size>\u5927\u5C0F</span><span class=sftp-mtime>\u4FEE\u6539\u65F6\u95F4</span></div>';
  items.forEach(function(f){
    var size = f.isDir ? '-' : formatSize(f.size);
    var mtime = formatDate(f.mtime);
    var nameCls = f.isDir ? 'dir-name' : '';
    var icon = f.isDir ? '\uD83D\uDCC1' : '\uD83D\uDCC4';
    var rowPath = (path === '/' ? '' : path) + '/' + f.name;
    html += '<div class=sftp-row data-path="' + esc(rowPath) + '" data-dir="' + (f.isDir ? '1' : '0') + '" data-name="' + esc(f.name) + '">';
    html += '<span class="sftp-name ' + nameCls + '">' + icon + ' ' + esc(f.name) + '</span>';
    html += '<span class=sftp-size>' + size + '</span>';
    html += '<span class=sftp-mtime>' + mtime + '</span>';
    html += '<span class=sftp-actions>';
    if (!f.isDir) html += '<button class=dl onclick="sftpDownloadFromBtn(\'' + tabId + '\',\'' + escAttr(rowPath) + '\',\'' + escAttr(f.name) + '\')">\u4E0B\u8F7D</button>';
    html += '<button class=rm onclick="sftpDeleteItem(\'' + tabId + '\',\'' + escAttr(rowPath) + '\',\'' + escAttr(f.name) + '\')">\u5220\u9664</button>';
    html += '</span></div>';
  });
  list.innerHTML = html;

  list.querySelectorAll('.sftp-row').forEach(function(row){
    row.onclick = function(e){
      if (e.target.tagName === 'BUTTON' || e.target.closest('.sftp-actions')) return;
      if (row.dataset.dir === '1') sftpList(tabId, row.dataset.path);
      else sftpDownloadFromBtn(tabId, row.dataset.path, row.dataset.name);
    };
  });
  showSftpStatus(tabId, items.length + ' \u9879');
}

function sftpDownloadFromBtn(tabId, filePath, fileName) { sftpDownload(tabId, filePath, fileName); }

function sftpDeleteItem(tabId, filePath, fileName) {
  if (!confirm('\u786E\u8BA4\u5220\u9664 ' + fileName + '\uFF1F')) return;
  var tab = tabs[tabId];
  if (!tab) return;
  var ws = tab.ws;
  if (!ws || ws.readyState !== 1) { showMsg('\u65E0\u8FDE\u63A5'); return; }
  var isDir = filePath.split('/').pop() !== fileName;
  var reqId = 's' + Date.now();
  tab._sftpReqId = reqId;
  var msgType = isDir ? 'sftp-rmdir' : 'sftp-rm';
  ws.send(JSON.stringify({ type: msgType, id: reqId, path: filePath }));
  var handler = function(e){
    var m = JSON.parse(e.data);
    if (m.id !== reqId) return;
    ws.removeEventListener('message', handler);
    tab._sftpReqId = null;
    if (m.type === 'sftp-error') showMsg('\u5220\u9664\u5931\u8D25: ' + m.data);
    else { showMsg('\u5DF2\u5220\u9664: ' + fileName); sftpList(tabId, tab.sftpPath); }
  };
  ws.addEventListener('message', handler);
  setTimeout(function(){ if (tab._sftpReqId === reqId) { ws.removeEventListener('message', handler); tab._sftpReqId = null; } }, 10000);
}

function sftpDownload(tabId, filePath, fileName) {
  var tab = tabs[tabId];
  if (!tab) return;
  var ws = tab.ws;
  if (!ws || ws.readyState !== 1) { showMsg('\u65E0\u8FDE\u63A5'); return; }
  showSftpStatus(tabId, '\u6B63\u5728\u4E0B\u8F7D: ' + fileName);
  var reqId = 's' + Date.now();
  tab._sftpReqId = reqId;
  ws.send(JSON.stringify({ type: 'sftp-download', id: reqId, path: filePath }));
  var handler = function(e){
    var m = JSON.parse(e.data);
    if (m.id !== reqId) return;
    ws.removeEventListener('message', handler);
    tab._sftpReqId = null;
    if (m.type === 'sftp-download') {
      try {
        var bin = atob(m.data);
        var buf = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        var blob = new Blob([buf]);
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
        showSftpStatus(tabId, '\u5DF2\u4E0B\u8F7D: ' + fileName);
        showMsg('\u5DF2\u4E0B\u8F7D: ' + fileName);
      } catch(err) { showMsg('\u4E0B\u8F7D\u5931\u8D25: ' + err.message); }
    } else if (m.type === 'sftp-error') {
      showSftpError(tabId, m.data);
      showMsg('\u4E0B\u8F7D\u5931\u8D25: ' + m.data);
    }
  };
  ws.addEventListener('message', handler);
  setTimeout(function(){ if (tab._sftpReqId === reqId) { ws.removeEventListener('message', handler); tab._sftpReqId = null; showMsg('\u4E0B\u8F7D\u8D85\u65F6'); } }, 60000);
}

function sftpUploadFile(tabId, file) {
  var tab = tabs[tabId];
  if (!tab) return;
  var remotePath = (tab.sftpPath === '/' ? '' : tab.sftpPath) + '/' + file.name;
  var ws = tab.ws;
  if (!ws || ws.readyState !== 1) { showMsg('\u65E0\u8FDE\u63A5'); return; }
  showSftpStatus(tabId, '\u6B63\u5728\u4E0A\u4F20: ' + file.name);
  var reader = new FileReader();
  reader.onload = function(ev){
    var binary = ev.target.result;
    var uint8 = new Uint8Array(binary);
    var b64 = '';
    for (var i = 0; i < uint8.length; i++) b64 += String.fromCharCode(uint8[i]);
    var reqId = 's' + Date.now();
    tab._sftpReqId = reqId;
    ws.send(JSON.stringify({ type: 'sftp-upload', id: reqId, path: remotePath, data: btoa(b64) }));
    var handler = function(e){
      var m = JSON.parse(e.data);
      if (m.id !== reqId) return;
      ws.removeEventListener('message', handler);
      tab._sftpReqId = null;
      if (m.type === 'sftp-error') { showMsg('\u4E0A\u4F20\u5931\u8D25: ' + m.data); showSftpStatus(tabId, '\u4E0A\u4F20\u5931\u8D25: ' + file.name); }
      else { showMsg('\u5DF2\u4E0A\u4F20: ' + file.name); sftpList(tabId, tab.sftpPath); }
    };
    ws.addEventListener('message', handler);
    setTimeout(function(){ if (tab._sftpReqId === reqId) { ws.removeEventListener('message', handler); tab._sftpReqId = null; showMsg('\u4E0A\u4F20\u8D85\u65F6'); } }, 60000);
  };
  reader.readAsArrayBuffer(file);
}

function sftpMkdir(tabId, path) {
  var tab = tabs[tabId];
  if (!tab) return;
  var ws = tab.ws;
  if (!ws || ws.readyState !== 1) { showMsg('\u65E0\u8FDE\u63A5'); return; }
  var reqId = 's' + Date.now();
  tab._sftpReqId = reqId;
  ws.send(JSON.stringify({ type: 'sftp-mkdir', id: reqId, path: path }));
  var handler = function(e){
    var m = JSON.parse(e.data);
    if (m.id !== reqId) return;
    ws.removeEventListener('message', handler);
    tab._sftpReqId = null;
    if (m.type === 'sftp-error') showMsg('\u521B\u5EFA\u76EE\u5F55\u5931\u8D25: ' + m.data);
    else { showMsg('\u5DF2\u521B\u5EFA: ' + path.split('/').pop()); sftpList(tabId, tab.sftpPath); }
  };
  ws.addEventListener('message', handler);
  setTimeout(function(){ if (tab._sftpReqId === reqId) { ws.removeEventListener('message', handler); tab._sftpReqId = null; } }, 10000);
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
  return (bytes/1024/1024/1024).toFixed(2) + ' GB';
}

function formatDate(ts) {
  if (!ts) return '-';
  var d = new Date(ts);
  var pad = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function escAttr(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ---- Tab 右键菜单 ----
var _tabCtxMenu = el('tabCtxMenu');
if (_tabCtxMenu) {
  _tabCtxMenu.style.display = 'none';
  el('tabCtxSftp').onclick = function(){
    var tid = _sftpCtxTabId;
    _tabCtxMenu.style.display = 'none';
    if (!tid || !tabs[tid]) return;
    var tab = tabs[tid];
    if (tab.isSftp) { showMsg('\u5F53\u524D\u5DF2\u662F SFTP \u6807\u7B7E'); return; }
    var label = tab.label || (tab.conn ? (tab.conn.user + '@' + tab.conn.host) : 'SFTP');
    newSftpTab(label, tab.conn, tid);
  };
  el('tabCtxClose').onclick = function(){
    var tid = _sftpCtxTabId;
    _tabCtxMenu.style.display = 'none';
    if (tid && tabs[tid]) closeTab(tid);
  };
  el('tabCtxCloseAll').onclick = function(){
    var tid = _sftpCtxTabId;
    _tabCtxMenu.style.display = 'none';
    if (!tid || !tabs[tid]) return;
    Object.keys(tabs).forEach(function(id){
      if (id !== tid && !tabs[id].isWelcome) closeTab(id, true);
    });
  };
}

// Tab 右键检测
document.addEventListener('contextmenu', function(e){
  var tabEl = e.target.closest && e.target.closest('.tab');
  if (!tabEl) return;
  e.preventDefault();
  var tid = tabEl.id.replace('tab_', '');
  if (!tabs[tid] || tabs[tid].isWelcome) return;
  _sftpCtxTabId = tid;
  var menu = el('tabCtxMenu');
  var sftpItem = el('tabCtxSftp');
  if (sftpItem) sftpItem.style.display = tabs[tid].isSftp ? 'none' : '';
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 170) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 100) + 'px';
});

// 侧栏右键：ctxSftp 绑定（在 renderConnList 里会动态追加，这里设置全局引用）
window.newSftpTab = newSftpTab;

// 导出给内联 onclick（renderSftpList 生成的按钮）和 app.js（_autoSftp/reconnect）
window.sftpDownloadFromBtn = sftpDownloadFromBtn;
window.sftpDeleteItem = sftpDeleteItem;
window.sftpList = sftpList;
window.newSftpTab = newSftpTab;

})();
