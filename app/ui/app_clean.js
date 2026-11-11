'use strict';
(function () {
  function el(id) {
    return document.getElementById(id);
  }
  function diag(t) {
    var d = el('diagContent');
    if (d) {
      d.textContent += '\n' + t;
      d.scrollTop = d.scrollHeight;
    }
  }
  function setDot(tab, cls) {
    var d = el(tab.id + '-dot');
    if (d) { d.className = 'tab-dot ' + cls; }
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }
  // token 存储(sessionStorage 不可用时回退内存)
  var _tok = null;
  function getToken() {
    try {
      return sessionStorage.getItem('sshx_token') || _tok || '';
    } catch (e) {
      return _tok || '';
    }
  }
  function setToken(t) {
    _tok = t;
    try {
      if (t) sessionStorage.setItem('sshx_token', t);
      else sessionStorage.removeItem('sshx_token');
    } catch (e) {}
  }
  var tabs = [];
  var activeId = null;
  var tabSeq = 0;
  var locked = null;
  var searchQuery = '';
  var sidebarCollapsed = false;
  // 面板输入锁：点"连接"后禁用按钮直到 ready/error，防连点丢包
  var connectPending = false;
  // SFTP tabs
  var sftpTabs = [];
  var sftpActiveId = null;
  var sftpSeq = 0;
  function api(method, q, body) {
    var u = '/app/sshx/api/' + q;
    var hd = { 'Content-Type': 'application/json' };
    var tk = getToken();
    if (tk) hd['X-App-Token'] = tk;
    var opt = { method: method, headers: hd };
    if (body) opt.body = JSON.stringify(body);
    return fetch(u, opt).then(function (r) {
      return r.json().then(function (j) {
        return { ok: r.ok, data: j };
      });
    });
  }
  // ---- 左侧栏 ----
  function renderLeft() {
    var lock = el('lock'),
      setArea = el('setArea'),
      connList = el('connList'),
      addBtn = el('addConnBtn'),
      logoutBtn = el('logoutBtn');
    if (locked === false) {
      lock.style.display = 'none';
      setArea.style.display = 'block';
      connList.style.display = 'none';
      var sa = el('connSearchArea'); if (sa) sa.style.display = 'none';
      addBtn.style.display = 'none';
      logoutBtn.style.display = 'none';
      return;
    }
    if (!getToken()) {
      lock.style.display = 'block';
      setArea.style.display = 'none';
      connList.style.display = 'none';
      var sa = el('connSearchArea'); if (sa) sa.style.display = 'none';
      addBtn.style.display = 'none';
      logoutBtn.style.display = 'none';
      return;
    }
    lock.style.display = 'none';
    setArea.style.display = 'none';
    connList.style.display = 'block';
    var sa = el('connSearchArea'); if (sa) sa.style.display = 'block';
    addBtn.style.display = 'block';
    logoutBtn.style.display = 'block';
    loadConns();
  }
  function loadConns() {
    api('GET', 'connections').then(function (r) {
      if (!r.ok) {
        if (r.data.error === 'unauthorized') {
          setToken('');
          renderLeft();
        }
        return;
      }
      var list = r.data.connections || [];
      var q = searchQuery.toLowerCase().trim();
      if (q) {
        list = list.filter(function (c) {
          var name = (c.name || c.host || '').toLowerCase();
          var host = (c.host || '').toLowerCase();
          var user = (c.username || '').toLowerCase();
          var group = (c.group || '').toLowerCase();
          return name.indexOf(q) >= 0 || host.indexOf(q) >= 0 || user.indexOf(q) >= 0 || group.indexOf(q) >= 0;
        });
      }
      var box = el('connList');
      box.innerHTML = '';
      if (!list.length) {
        box.innerHTML = '<div style="padding:14px;color:#888;font-size:12px;">' + (q ? '无匹配连接' : '暂无连接') + '</div>';
        return;
      }
      list.forEach(function (c) {
        var d = document.createElement('div');
        d.className = 'conn-item';
        d.innerHTML =
          '<div class="ci-name">' +
          esc(c.name || c.host) +
          '</div><div class="ci-sub">' +
          esc(c.username + '@' + c.host + ':' + c.port) +
          (c.group ? ' · ' + esc(c.group) : '') +
          '</div>';
        d.onclick = function () {
          openSaved(c);
        };
        d.oncontextmenu = function (e) {
          e.preventDefault();
          var menu = el('ctxMenu');
          if (!menu) return;
          menu.style.display = 'block';
          menu.style.left = e.clientX + 'px';
          menu.style.top = e.clientY + 'px';
          menu._conn = c;
        };
        box.appendChild(d);
      });
    });
  }
  function doLogin() {
    var pw = el('lockInput').value;
    fetch('/app/sshx/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, data: j };
        });
      })
      .then(function (r) {
        if (r.ok) {
          setToken(r.data.token);
          renderLeft();
        } else {
          el('lockMsg').textContent = '密码错误';
        }
      });
  }
  function doSet() {
    var pw = el('setInput').value;
    api('POST', 'settings', { appPassword: pw }).then(function (r) {
      if (r.ok) {
        setToken(r.data.token);
        locked = true;
        renderLeft();
      } else {
        el('setMsg').textContent = r.data.error || '设置失败';
      }
    });
  }
  function doLogout() {
    setToken('');
    renderLeft();
  }
  function openSaved(c) {
    if (!getToken()) {
      renderLeft();
      return;
    }
    if (connectPending) {
      return;
    }
    var needPw = !c.hasPassword && !c.hasKey;
    function go(pw) {
      connectPending = true;
      var tab = newTab(c.name || c.host);
      ensureWs(tab, function () {
        var msg = { type: 'connectSaved', id: c.id, password: pw, cols: tab.term.cols, rows: tab.term.rows };
        tab._pendingConnect = msg;
        wsSend(tab, msg);
      });
      setTimeout(function () { connectPending = false; }, 20000);
    }
    if (needPw) {
      var pw = prompt('请输入密码连接 ' + c.username + '@' + c.host + ':');
      if (pw === null) return;
      go(pw);
    } else {
      go(null);
    }
  }
  // ---- tab 管理 ----
  function newTab(title) {
    var id = 'tab' + ++tabSeq;
    var pane = document.createElement('div');
    pane.className = 'term-pane';
    pane.id = id + '-pane';
    el('terminals').appendChild(pane);
    var term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas,Menlo,Monaco,"Courier New",monospace',
      theme: { background: '#1e1e1e', foreground: '#e0e0e0' },
    });
    var fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    var tab = { id: id, title: title || '新标签', term: term, fit: fit, ws: null, connected: false, pane: pane };
    tabs.push(tab);
    var t = document.createElement('div');
    t.className = 'tab';
    t.id = id + '-tab';
    t.dataset.id = id;
    var dot = document.createElement('span');
    dot.className = 'tab-dot gray';
    dot.id = id + '-dot';
    var span = document.createElement('span');
    span.textContent = title || '新标签';
    span.className = 'tab-title';
    var close = document.createElement('span');
    close.textContent = '×';
    close.className = 'tab-close';
    t.appendChild(dot);
    t.appendChild(span);
    t.appendChild(close);
    close.onclick = function (e) {
      e.stopPropagation();
      closeTab(id);
    };
    t.onclick = function () {
      activateTab(id);
    };
    el('tabs').appendChild(t);
    term.open(pane);
    term.onData(function (d) {
      wsSend(tab, { type: 'data', data: btoa(d) });
    });
    term.onResize(function (sz) {
      wsSend(tab, { type: 'resize', cols: sz.cols, rows: sz.rows });
    });
    setTimeout(function () {
      try {
        fit.fit();
      } catch (e) {}
    }, 0);
    activateTab(id);
    return tab;
  }
  function activateTab(id) {
    // 清除 SSH 和 SFTP 所有 active
    tabs.forEach(function (t) {
      t.pane.classList.remove('active');
      var tb = el(t.id + '-tab');
      if (tb) tb.classList.remove('active');
    });
    sftpTabs.forEach(function (t) {
      t.pane.classList.remove('active');
      var tb = el(t.id + '-tab');
      if (tb) tb.classList.remove('active');
    });
    var tab = tabs.find(function (t) { return t.id === id; });
    if (!tab) return;
    tab.pane.classList.add('active');
    var tb = el(id + '-tab');
    if (tb) tb.classList.add('active');
    activeId = id;
    sftpActiveId = null;
    setTimeout(function () {
      try { tab.fit.fit(); } catch (e) {}
    }, 0);
    scrollTabsIntoView(tab);
  }
  // 激活/新建时把 tab 滚到可见区域(隐藏的在左右)
  function scrollTabsIntoView(tab) {
    var bar = el('tabs'), tb = el(tab.id + '-tab');
    if (!bar || !tb) return;
    var bl = bar.getBoundingClientRect();
    var tl = tb.getBoundingClientRect();
    if (tl.left < bl.left) bar.scrollBy({ left: tl.left - bl.left - 4, behavior: 'smooth' });
    else if (tl.right > bl.right) bar.scrollBy({ left: tl.right - bl.right + 4, behavior: 'smooth' });
  }
  function closeTab(id) {
    var tab = tabs.find(function (t) { return t.id === id; });
    if (!tab) return;
    if (tab.ws) {
      try { tab.ws.onopen = tab.ws.onmessage = tab.ws.onclose = tab.ws.onerror = null; } catch (e) {}
      try { tab.ws.close(); } catch (e) {}
      tab.ws = null;
    }
    tab._wsQueue = [];
    tab._pendingConnect = null;
    try { tab.term.dispose(); } catch (e) {}
    if (tab.pane.parentNode) tab.pane.parentNode.removeChild(tab.pane);
    var tb = el(id + '-tab');
    if (tb && tb.parentNode) tb.parentNode.removeChild(tb);
    tabs = tabs.filter(function (t) { return t.id !== id; });
    if (activeId === id) {
      var nxt = tabs[tabs.length - 1];
      if (nxt) activateTab(nxt.id);
      else activeId = null;
    }
  }
  function closeAllTabs() {
    if (!tabs.length) return;
    var ids = tabs.map(function (t) { return t.id; });
    ids.forEach(closeTab);
    
// ---- SFTP ----
  function openSftpTab(connId) {
    // 复用已有 SSH ws
    var sshTab = tabs.find(function (t) { return t._connId === connId && t.ws && t.ws.readyState === WebSocket.OPEN; });
    if (sshTab) {
      var sftpTab = newSftpTab(connId);
      sftpTab.ws = sshTab.ws;
      sftpListDir(sftpTab, '/');
    } else {
      // 新建隐藏 SSH tab 用于 SFTP
      connectPending = true;
      var btn = el('connectBtn'); if (btn) btn.disabled = true;
      var sshTab2 = newTab('SSH');
      sshTab2._hidden = true;
      sshTab2.pane.style.display = 'none';
      sshTab2.term.element.style.display = 'none';
      sshTab2.querySelector ? null : null; // noop
      var sshTabEl = document.getElementById(sshTab2.id + '-tab');
      if (sshTabEl) sshTabEl.style.display = 'none';
      var sftpTab = newSftpTab(connId);
      ensureWs(sshTab2, function () {
        wsSend(sshTab2, { type: 'connectSaved', id: connId, password: '' });
        sshTab2._sftpCallback = function () {
          sftpTab.ws = sshTab2.ws;
          sftpListDir(sftpTab, '/');
          connectPending = false; if (btn) btn.disabled = false;
        };
      });
    }
  }
  function newSftpTab(connId) {
    var id = 'sftp' + ++sftpSeq;
    var pane = document.createElement('div');
    pane.className = 'term-pane sftp-pane';
    pane.id = id + '-pane';
    el('terminals').appendChild(pane);
    pane.innerHTML = '<div class=sftp-bar><span class=sftp-path>/</span></div><div class=sftp-list></div><div class=sftp-foot><button class=sftp-upbtn>上传</button><button class=sftp-newdir>新建目录</button></div>';
    var tab = { id: id, connId: connId, path: '/', pane: pane, ws: null };
    sftpTabs.push(tab);
    var t = document.createElement('div');
    t.className = 'tab sftp-tab';
    t.id = id + '-tab';
    t.innerHTML = '<span class=tab-dot></span><span class=tab-title>SFTP</span><span class=tab-close>×</span>';
    t.querySelector('.tab-close').onclick = function (e) { e.stopPropagation(); closeSftpTab(id); };
    t.onclick = function () { activateSftpTab(id); };
    el('tabs').appendChild(t);
    // upload/newdir buttons
    pane.querySelector('.sftp-upbtn').onclick = function () { sftpUpload(tab); };
    pane.querySelector('.sftp-newdir').onclick = function () {
      showPrompt('新建目录', '目录名称', '', function (name) {
        if (!name) return;
        var fullPath = tab.path === '/' ? '/' + name : tab.path + '/' + name;
        wsSend(tab, { type: 'sftp-mkdir', id: tab.id, path: fullPath });
      });
    };
    activateSftpTab(id);
    return tab;
  }
  function activateSftpTab(id) {
    // 清除 SSH 和 SFTP 所有 active
    tabs.forEach(function (t) {
      t.pane.classList.remove('active');
      var tb = el(t.id + '-tab');
      if (tb) tb.classList.remove('active');
    });
    sftpTabs.forEach(function (t) {
      t.pane.classList.remove('active');
      var tb = el(t.id + '-tab');
      if (tb) tb.classList.remove('active');
    });
    var tab = sftpTabs.find(function (t) { return t.id === id; });
    if (!tab) return;
    tab.pane.classList.add('active');
    var tb = el(id + '-tab');
    if (tb) tb.classList.add('active');
    sftpActiveId = id;
    activeId = null;
    if (tab.items) renderSftpList(tab);
    else sftpListDir(tab, tab.path);
  }
  function closeSftpTab(id) {
    var tab = sftpTabs.find(function (t) { return t.id === id; });
    if (!tab) return;
    if (tab.pane.parentNode) tab.pane.parentNode.removeChild(tab.pane);
    var tb = el(id + '-tab');
    if (tb && tb.parentNode) tb.parentNode.removeChild(tb);
    sftpTabs = sftpTabs.filter(function (t) { return t.id !== id; });
    if (sftpActiveId === id) {
      var nxt = sftpTabs[sftpTabs.length - 1];
      if (nxt) activateSftpTab(nxt.id);
      else sftpActiveId = null;
    }
  }
  function sftpListDir(tab, dirPath) {
    tab.path = dirPath;
    tab.pending = 'list';
    wsSend(tab, { type: 'sftp-list', id: tab.id, path: dirPath });
  }
  function renderSftpList(tab) {
    var pane = tab.pane;
    pane.querySelector('.sftp-path').textContent = tab.path;
    var list = pane.querySelector('.sftp-list');
    if (!tab.items || !tab.items.length) {
      list.innerHTML = '<div class=sftp-empty>空目录</div>';
      return;
    }
    var html = '<table class=sftp-tbl><thead><tr><th>名称</th><th>大小</th><th>修改时间</th><th></th></tr></thead><tbody>';
    if (tab.path !== '/') {
      html += '<tr class=sftp-row data-dir=".." data-name=".."><td>..</td><td></td><td></td><td></td></tr>';
    }
    tab.items.forEach(function (e) {
      html += '<tr class="sftp-row' + (e.isDir ? ' sftp-dir' : '') + '" data-dir="' + esc(e.isDir ? e.name : '') + '" data-name="' + esc(e.name) + '" data-size="' + e.size + '">';
      html += '<td>' + esc(e.name) + (e.isDir ? '/' : '') + '</td>';
      html += '<td>' + (e.isDir ? '' : formatSize(e.size)) + '</td>';
      html += '<td>' + formatTime(e.mtime) + '</td>';
      html += '<td><button class=sftp-dl>下载</button></td></tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = html;
    // row click
    list.querySelectorAll('.sftp-row[data-dir]').forEach(function (row) {
      row.style.cursor = 'pointer';
      row.onclick = function () {
        var name = row.dataset.name;
        if (name === '..') {
          var parent = tab.path.replace(/\/[^/]+\/?$/, '') || '/';
          sftpListDir(tab, parent);
        } else if (row.dataset.dir) {
          var newPath = tab.path === '/' ? '/' + name : tab.path + '/' + name;
          sftpListDir(tab, newPath);
        }
      };
    });
    // download click
    list.querySelectorAll('.sftp-dl').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var name = btn.closest('.sftp-row').dataset.name;
        var fullPath = tab.path === '/' ? '/' + name : tab.path + '/' + name;
        sftpDownload(tab, fullPath, name);
      };
    });
  }
  function sftpDownload(tab, fullPath, name) {
    tab.pending = 'download:' + fullPath;
    wsSend(tab, { type: 'sftp-download', id: tab.id, path: fullPath });
  }
  function formatSize(s) {
    if (s < 1024) return s + ' B';
    if (s < 1024 * 1024) return (s / 1024).toFixed(1) + ' KB';
    if (s < 1024 * 1024 * 1024) return (s / 1024 / 1024).toFixed(1) + ' MB';
    return (s / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }
  function formatTime(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function sftpUpload(tab) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.onchange = function () {
      var file = inp.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        var data = ev.target.result.split(',')[1];
        var fullPath = tab.path === '/' ? '/' + file.name : tab.path + '/' + file.name;
        tab.pending = 'upload:' + fullPath;
        wsSend(tab, { type: 'sftp-upload', id: tab.id, path: fullPath, data: data });
      };
      reader.readAsDataURL(file);
    };
    inp.click();
  }
  function ensureWs(tab, cb) {
    if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
      try { cb(); } catch (e) { diag('cb err ' + e); }
      return;
    }
    if (tab.ws && tab.ws.readyState === WebSocket.CONNECTING) {
      // 排队不丢包:给多个 cb 排队,打开后逐个调用
      tab._wsQueue = tab._wsQueue || [];
      tab._wsQueue.push(cb);
      return;
    }
    // 清掉上个死的 socket
    if (tab.ws) {
      try { tab.ws.onopen = tab.ws.onmessage = tab.ws.onclose = tab.ws.onerror = null; } catch (e) {}
      try { tab.ws.close(); } catch (e) {}
      tab.ws = null;
    }
    tab._wsQueue = [cb];
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var w = new WebSocket(proto + '//' + location.host + '/app/sshx/ws?v=' + Date.now());
    w.binaryType = 'arraybuffer';
    tab.ws = w;
    w.onopen = function () {
      var q = tab._wsQueue || [];
      tab._wsQueue = [];
      for (var i = 0; i < q.length; i++) {
        try { q[i](); } catch (e) { diag('cb err ' + e); }
      }
    };
    w.onmessage = function (ev) {
      onWs(tab, ev);
    };
    w.onclose = function () {
      tab._wsQueue = [];
      if (tab.ws === w) tab.ws = null;
    };
    w.onerror = function () {
      diag('WS 错误');
      connectPending = false;
      var cb5 = el('connectBtn'); if (cb5) cb5.disabled = false;
    };
  }
  function onWs(tab, ev) {
    var msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    if (msg.type === 'data') {
      try {
        var bin = atob(msg.data);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        tab.term.write(arr);
      } catch (e) {}
    } else if (msg.type === 'ready') {
      tab._pendingConnect = null;
      connectPending = false;
      var cb = el('connectBtn'); if (cb) cb.disabled = false;
      setDot(tab, 'green');
      if (tab._sftpCallback) { var cbk = tab._sftpCallback; delete tab._sftpCallback; cbk(); }
    } else if (msg.type === 'error') {
      connectPending = false;
      var cb2 = el('connectBtn'); if (cb2) cb2.disabled = false;
      setDot(tab, 'red');
      diag('错误: ' + msg.data);
      if (tab._pendingConnect && (tab.retryCount || 0) < 3) {
        tab.retryCount = (tab.retryCount || 0) + 1;
        diag('2秒后自动重试...');
        setTimeout(function () {
          diag('自动重试...');
          wsSend(tab, tab._pendingConnect);
        }, 2000);
        return;
      }
      tab._pendingConnect = null;
    } else if (msg.type === 'close' || msg.type === 'closed') {
      connectPending = false;
      var cb3 = el('connectBtn'); if (cb3) cb3.disabled = false;
      setDot(tab, 'red');
    // ---- SFTP 响应路由 ----
    } else if (msg.type && msg.type.indexOf('sftp-') === 0) {
      var st = sftpTabs.find(function (t) { return t.id === msg.id; });
      if (!st) return;
      if (msg.type === 'sftp-list') {
        st.items = msg.items;
        tab = st;
        renderSftpList(st);
      } else if (msg.type === 'sftp-download') {
        var bin = atob(msg.data);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var blob = new Blob([arr]);
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = msg.path.split('/').pop();
        a.click();
        URL.revokeObjectURL(a.href);
      } else if (msg.type === 'sftp-upload') {
        diag('[SFTP] 上传完成: ' + msg.path);
        sftpListDir(st, st.path);
      } else if (msg.type === 'sftp-error') {
        diag('[SFTP] 错误: ' + msg.data);
      }
    }
  }
  function wsSend(tab, o) {
    if (tab && tab.ws && tab.ws.readyState === WebSocket.OPEN) tab.ws.send(JSON.stringify(o));
  }
  function connectForm() {
    if (connectPending) {
      return;
    }
    var host = el('host').value.trim(),
      port = Number(el('port').value) || 22,
      user = el('user').value.trim(),
      pass = el('pass').value;
    if (!host || !user) {
      return;
    }
    connectPending = true;
    var btn = el('connectBtn');
    if (btn) btn.disabled = true;
    var tab = newTab(user + '@' + host);
    ensureWs(tab, function () {
      var msg = {
        type: 'connect',
        host: host,
        port: port,
        username: user,
        password: pass,
        cols: tab.term.cols,
        rows: tab.term.rows,
      };
      tab._pendingConnect = msg;
      wsSend(tab, msg);
    });
    // 20s 超时后备:避免 connect 卡死时按钮永远 disabled
    setTimeout(function () {
      connectPending = false;
      if (btn) btn.disabled = false;
    }, 20000);
  }
  function localTerm() {
    if (connectPending) {
      return;
    }
    connectPending = true;
    var tab = newTab('本地终端');
    ensureWs(tab, function () {
      wsSend(tab, { type: 'local', cols: tab.term.cols, rows: tab.term.rows });
    });
    setTimeout(function () { connectPending = false; }, 20000);
  }
  // ---- 新增连接模态 ----
  function openConnModal() {
    el('connModal').style.display = 'flex';
    el('connName').value = '';
    el('connHost').value = '';
    el('connPort').value = '22';
    el('connUser').value = '';
    el('connPass').value = '';
    el('connGroup').value = '';
    el('connRemember').checked = false;
    el('connName').focus();
  }
  function saveConn() {
    var conn = {
      name: el('connName').value.trim() || el('connUser').value + '@' + el('connHost').value,
      host: el('connHost').value.trim(),
      port: Number(el('connPort').value) || 22,
      username: el('connUser').value.trim(),
      password: el('connRemember').checked ? el('connPass').value : '',
      group: el('connGroup').value.trim(),
    };
    if (!conn.host || !conn.username) {
      alert('请填写主机和用户名');
      return;
    }
    api('POST', 'connections', conn).then(function (r) {
      if (r.ok) {
        el('connModal').style.display = 'none';
        loadConns();
      } else {
        alert('保存失败: ' + (r.data.error || ''));
      }
    });
  }
  // ---- 侧栏折叠/展开 ----
  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    var s = el('sidebar');
    if (s) s.classList.toggle('collapsed', sidebarCollapsed);
    // 展开/收拢后让 terminal 重新适配
    setTimeout(function () {
      var tab = tabs.find(function (t) { return t.id === activeId; });
      if (tab) { try { tab.fit.fit(); } catch (e) {} }
    }, 100);
  }
function expandSidebar() {
    if (sidebarCollapsed) toggleSidebar();
  }
  // ---- 绑定 ----
  el('connectBtn').onclick = connectForm;
  el('localBtn').onclick = localTerm;
  el('closeAllBtn').onclick = function () {
    if (!tabs.length) return;
    var modal = el('confirmModal'), msg = el('confirmMsg');
    if (!modal || !msg) { closeAllTabs(); return; }
    msg.textContent = '确定关闭全部 ' + tabs.length + ' 个标签?';
    modal.style.display = 'flex';
    var ok = el('confirmOk'), cancel = el('confirmCancel');
    ok.onclick = function () {
      modal.style.display = 'none';
      closeAllTabs();
    };
    cancel.onclick = function () {
      modal.style.display = 'none';
    };
  };
  el('tabsLeft').onclick = function () {
    var b = el('tabs'); b.scrollBy({ left: -160, behavior: 'smooth' });
  };
  el('tabsRight').onclick = function () {
    var b = el('tabs'); b.scrollBy({ left: 160, behavior: 'smooth' });
  };
  el('sidebarToggle').onclick = toggleSidebar;
  el('sidebarExpand').onclick = expandSidebar;
  el('connSearch').oninput = function () {
    searchQuery = el('connSearch').value;
    loadConns();
  };
  el('lockBtn').onclick = doLogin;
  el('setBtn').onclick = doSet;
  el('logoutBtn').onclick = doLogout;
  el('addConnBtn').onclick = openConnModal;
  el('connSave').onclick = saveConn;
  el('connCancel').onclick = function () {
    el('connModal').style.display = 'none';
  };
  el('ctxTerm').onclick = function () {
    var c = el('ctxMenu')._conn; if (c) openSaved(c);
  };
  el('ctxSftp').onclick = function () {
    var c = el('ctxMenu')._conn; if (c) openSftpTab(c.id);
  };
  el('ctxDel').onclick = function () {
    var c = el('ctxMenu')._conn; if (!c) return;
    showConfirm('确认删除连接 "' + c.name + '"？', function () {
      api('DELETE', 'connections?id=' + encodeURIComponent(c.id)).then(function (r) {
        if (r.ok) loadConns();
      });
    });
  };
  el('diagBtn').onclick = function () {
    el('diag').classList.toggle('open');
  };
  el('diagClose').onclick = function () {
    el('diag').classList.remove('open');
  };
  document.addEventListener('click', function () {
    var m = el('ctxMenu'); if (m) m.style.display = 'none';
  });
  window.addEventListener('resize', function () {
    var tab = tabs.find(function (t) {
      return t.id === activeId;
    });
    if (tab) {
      try {
        tab.fit.fit();
      } catch (e) {}
    }
  });
  // ---- 初始化 ----
  diag('脚本开始执行');
  if (typeof Terminal === 'undefined') {
    diag('错误: Terminal 未定义 (xterm 未加载)');
    return;
  }
  api('GET', 'settings').then(function (r) {
    locked = r.data.locked;
    renderLeft();
    diag('左侧栏渲染完成 (locked=' + locked + ')');
  });
  newTab('欢迎');
  diag('初始化完
  ction showConfirm(msg, onOk) {
    el('confirmMsg').textContent = msg;
    el('confirmModal').style.display = 'flex';
    el('confirmOk').onclick = function() { el('confirmModal').style.display='none'; if(onOk) onOk(); };
    el('confirmCancel').onclick = function() { el('confirmModal').style.display='none'; };
  }
  function showPrompt(title, placeholder, defaultVal, onOk) {
    el('promptMsg').textContent = title;
    var inp = el('promptInput');
    inp.value = defaultVal || ''; inp.placeholder = placeholder;
    el('promptModal').style.display = 'flex'; inp.focus();
    var done = function(ok) { el('promptModal').style.display='none'; if(ok && onOk) onOk(inp.value); };
    el('promptOk').onclick = function() { done(true); };
    el('promptCancel').onclick = function() { done(false); };
    inp.onkeydown = function(e) { if(e.key==='Enter') done(true); if(e.key==='Escape') done(false); };
  }
  function showAlert(msg) { showConfirm(msg, null); }

  newTab('欢迎');
  diag('初始化完成');

})();
