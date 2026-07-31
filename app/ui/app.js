'use strict';
(function () {
  var PREFIX = '/app/sshx';
  function el(id) { return document.getElementById(id); }
  function diag(t) {
    var d = el('diagContent');
    if (d) { d.textContent += '\n' + t; d.scrollTop = d.scrollHeight; }
  }
  function setDot(tabId, color) {
    var dot = el('tdot_' + tabId);
    if (dot) dot.style.background = color || '#888';
  }
  function esc(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
  }
  function showMsg(msg, duration) {
    var box = el('msgBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'msgBox';
      box.style.cssText = 'position:fixed;top:50px;right:16px;background:#333;color:#fff;padding:6px 16px;border-radius:4px;z-index:99999;opacity:0;transition:opacity 0.3s;font-size:13px;max-width:320px;pointer-events:none;';
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.style.opacity = '1';
    setTimeout(function () { box.style.opacity = '0'; }, duration || 3000);
  }

  var locked = null;
  var conns = [];
  var tabs = {};
  var activeId = null;
  var wsMap = {};
  var sidebarCollapsed = false;
  var searchQuery = '';
  var editingId = null;

  // 统一的断开提示函数（防止重复显示）
  function showDisconnectPrompt(tabId, term, errorMsg) {
    if (!tabs[tabId]) return;
    if (!errorMsg && tabs[tabId]._disconnectShown) return;
    tabs[tabId]._disconnectShown = true;
    term.writeln('');
    if (errorMsg) {
      term.writeln('\x1b[31m' + errorMsg + '\x1b[0m');
    }
    term.writeln('\x1b[90m────────────────────────────────────────\x1b[0m');
    term.writeln('\x1b[33mSession stopped\x1b[0m');
    term.writeln('\x1b[33m  Press R to restart session\x1b[0m');
  }
  function getToken() { return localStorage.getItem('sshx_token') || ''; }
  function setToken(t) {
    if (t) localStorage.setItem('sshx_token', t); else localStorage.removeItem('sshx_token');
  }

  function api(method, path, data) {
    return new Promise(function (resolve, reject) {
      var tok = getToken();
      var opts = { method: method, headers: {} };
      if (tok) opts.headers['x-app-token'] = tok;
      if (data) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(data);
      }
      fetch('/app/sshx' + path, opts)
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (!res.ok && res.body && res.body.error === 'unauthorized') { setToken(''); location.reload(); }
          resolve(res.body);
        })
        .catch(reject);
    });
  }

  function renderConnList() {
    var list = el('connList');
    if (!list) return;
    var filtered = conns.filter(function (c) {
      if (!searchQuery) return true;
      var q = searchQuery.toLowerCase();
      return (c.name || '').toLowerCase().indexOf(q) >= 0 ||
             (c.host || '').toLowerCase().indexOf(q) >= 0 ||
             (c.username || c.user || '').toLowerCase().indexOf(q) >= 0 ||
             (c.group || '').toLowerCase().indexOf(q) >= 0;
    });

    if (locked) {
      el('lock').style.display = 'none';
      el('setArea').style.display = 'none';
      el('sidebarFoot').style.display = '';
      el('connSearchArea').style.display = '';
      var html = '';
      filtered.forEach(function (c) {
        var uname = c.username || c.user || '';
        var displayInfo = esc(c.name);
        if (uname) displayInfo += ' <span class="conn-user">' + esc(uname) + '</span>';
        displayInfo += ' <span class="conn-host">' + esc(c.host) + '</span>';
        html += '<div class="conn-item" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '" data-host="' + esc(c.host) + '" data-port="' + (c.port || 22) + '" data-user="' + esc(uname) + '" data-pass="" data-haspw="' + (c.hasPassword ? '1' : '0') + '">';
        html += '<span class="conn-dot" id="dot_' + esc(c.name) + '"></span>';
        html += '<span class="conn-name">' + displayInfo + '</span>';
        if (c.group) html += '<span class="conn-group">' + esc(c.group) + '</span>';
        html += '</div>';
      });
      list.innerHTML = html;
      list.querySelectorAll('.conn-item').forEach(function (div) {
        div.onclick = function () {
          openSavedByName(div.dataset.name, div.dataset.id, div.dataset.host, div.dataset.port, div.dataset.user);
        };
        div.oncontextmenu = function (e) {
          e.preventDefault();
          var n = div.dataset.name, id = div.dataset.id;
          el('ctxTerm').onclick = function () {
            openSavedByName(n, id, div.dataset.host, div.dataset.port, div.dataset.user);
          };
          el('ctxEdit').onclick = function () {
            var c = conns.find(function (x) { return x.id === id; });
            if (c) openConnModal('edit', c);
          };
          el('ctxDel').onclick = function () {
            showConfirm('删除连接「' + n + '」?', function () {
              api('DELETE', '/api/connections?id=' + encodeURIComponent(id)).then(function () { loadConns(); });
            });
          };
          var m = el('ctxMenu');
          m.style.display = 'block';
          m.style.left = Math.min(e.clientX, window.innerWidth - 150) + 'px';
          m.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
        };
      });
    } else {
      list.innerHTML = '';
      el('sidebarFoot').style.display = 'none';
      el('connSearchArea').style.display = 'none';
      if (locked === null) {
        el('lock').style.display = 'none';
        el('setArea').style.display = 'flex';
      } else {
        el('lock').style.display = 'flex';
        el('setArea').style.display = 'none';
      }
    }
  }

  function loadConns() {
    api('GET', '/api/connections').then(function (data) {
      conns = data.connections || [];
      renderConnList();
    }).catch(function () { conns = []; renderConnList(); });
  }

  function checkAuthStatus() {
    api('GET', '/api/settings').then(function (data) {
      if (data.locked) {
        // 服务端已设访问密码
        if (getToken()) {
          locked = true;
          loadConns();
        } else {
          locked = false;
          renderConnList();
        }
      } else {
        // 服务端未设访问密码 -> 显示设置界面(不受本地残留 token 影响)
        locked = null;
        renderConnList();
      }
    }).catch(function () {
      // 网络异常:有 token 则假定已登录,否则显示解锁
      if (getToken()) {
        locked = true;
        loadConns();
      } else {
        locked = false;
        renderConnList();
      }
    });
  }

  el('lockBtn').onclick = function () {
    var pw = el('lockInput').value;
    if (!pw) return;
    api('POST', '/api/login', { password: pw }).then(function (data) {
      if (data.ok) { setToken(data.token); locked = true; loadConns(); }
      else { showMsg(data.error || '密码错误'); setToken(''); }
    }).catch(function () { showMsg('验证失败'); setToken(''); });
  };

  el('setBtn').onclick = function () {
    var pw = el('setInput').value;
    var pw2 = el('setInput2').value;
    if (pw.length < 4) { showMsg('至少4位'); return; }
    if (pw !== pw2) { showMsg('两次密码不一致'); return; }
    api('POST', '/api/settings', { appPassword: pw }).then(function (data) {
      if (data.ok && data.token) { setToken(data.token); locked = true; loadConns(); }
      else { showMsg(data.error || '设置失败'); }
    }).catch(function () { showMsg('请求失败'); });
  };

  // 锁定：只清 token，不动已打开的 tab
  el('logoutBtn').onclick = function () {
    setToken('');
    locked = false;
    renderConnList();
  };

  function openConnModal(mode, conn) {
    editingId = mode === 'edit' ? (conn && conn.id) : null;
    el('connModalTitle').textContent = mode === 'edit' ? '编辑连接' : '新增连接';
    el('connName').value = conn ? (conn.name || '') : '';
    el('connHost').value = conn ? (conn.host || '') : (mode === 'add' ? el('host').value : '');
    el('connPort').value = conn ? (conn.port || 22) : '22';
    el('connUser').value = conn ? (conn.username || '') : (mode === 'add' ? el('user').value : '');
    el('connPass').value = '';
    el('connGroup').value = conn ? (conn.group || '') : '';
    el('connTestMsg').textContent = '';
    el('connModal').style.display = 'flex';
    el('connName').focus();
  }

  el('addConnBtn').onclick = function () { openConnModal('add', null); };

  el('connSave').onclick = function () {
    var name = el('connName').value.trim();
    var host = el('connHost').value.trim();
    var port = parseInt(el('connPort').value) || 22;
    var user = el('connUser').value.trim();
    var pass = el('connPass').value;
    if (!name) { el('connTestMsg').textContent = '请填写名称'; el('connTestMsg').style.color = '#f48771'; el('connName').focus(); return; }
    if (!host) { el('connTestMsg').textContent = '请填写主机地址'; el('connTestMsg').style.color = '#f48771'; el('connHost').focus(); return; }
    if (!user) { el('connTestMsg').textContent = '请填写用户名'; el('connTestMsg').style.color = '#f48771'; el('connUser').focus(); return; }
    if (!editingId && !pass) { el('connTestMsg').textContent = '请填写密码'; el('connTestMsg').style.color = '#f48771'; el('connPass').focus(); return; }
    var conn = {
      name: name,
      host: host,
      port: port,
      username: user,
      password: pass,
      group: el('connGroup').value.trim()
    };
    if (editingId) conn.id = editingId;
    el('connTestMsg').textContent = '';
    api('POST', '/api/connections', conn).then(function () {
      el('connModal').style.display = 'none';
      loadConns();
    }).catch(function () { });
  };

  el('connTest').onclick = function () {
    var host = el('connHost').value.trim();
    var user = el('connUser').value.trim();
    if (!host || !user) {
      el('connTestMsg').textContent = '请先填写主机和用户名';
      el('connTestMsg').style.color = '#f48771';
      return;
    }
    el('connTestMsg').textContent = '连接测试中...';
    el('connTestMsg').style.color = '#888';
    api('POST', '/api/connections/test', {
      host: host,
      port: parseInt(el('connPort').value) || 22,
      username: user,
      password: el('connPass').value
    }).then(function (data) {
      if (data.ok) {
        el('connTestMsg').textContent = '✓ 连接成功';
        el('connTestMsg').style.color = '#4caf50';
      } else {
        el('connTestMsg').textContent = '✗ ' + (data.error || '连接失败');
        el('connTestMsg').style.color = '#f48771';
      }
    }).catch(function () {
      el('connTestMsg').textContent = '✗ 请求失败';
      el('connTestMsg').style.color = '#f48771';
    });
  };

  el('connCancel').onclick = function () { el('connModal').style.display = 'none'; };

  function openSaved(name, host, port, user, pass) {
    go(host, port, user, pass, name);
  }

  function openSavedByName(name, id, host, port, user) {
    // Use connectSaved via WebSocket (server holds the password)
    newTab(name || (user + '@' + host + ':' + port), false, { id: id, saved: true, host: host, port: parseInt(port) || 22, user: user });
  }

  function go(host, port, user, pass, label) {
    if (!host || !user) return;
    newTab(label || (user + '@' + host + ':' + (port || 22)), false, { host: host, port: parseInt(port) || 22, user: user, pass: pass || '' });
  }

  el('connectBtn').onclick = function () {
    go(el('host').value, el('port').value, el('user').value, el('pass').value);
  };

  el('connSearch').oninput = function () {
    searchQuery = el('connSearch').value;
    renderConnList();
  };

  function newTab(label, isWelcome, conn) {
    var id = 't' + Date.now();
    var div = document.createElement('div');
    div.id = 'tab_' + id;
    div.className = 'tab' + (isWelcome ? ' welcome-tab' : '');
    // 欢迎标签不渲染关闭按钮
    var displayLabel = (isWelcome ? '🏠 ' : '') + label;
    div.innerHTML = '<span class="tab-dot" id="tdot_' + id + '"></span><span class="tab-label">' + esc(displayLabel) + '</span>' + (isWelcome ? '' : '<button class="tab-close">×</button>');
    el('tabs').appendChild(div);
    var termDiv = document.createElement('div');
    termDiv.id = 'term_' + id;
    termDiv.className = 'terminal';
    el('terminals').appendChild(termDiv);

    var term = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'Consolas, "Courier New", monospace', theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#aaaaaa' }, allowProposedApi: true });
    term.open(termDiv);
    // 拦截 R 键重连（xterm 会阻止事件冒泡到 document）
    term.attachCustomKeyEventHandler(function (e) {
      if (e.type !== 'keydown' || (e.key !== 'r' && e.key !== 'R')) return true;
      if (e.ctrlKey || e.altKey || e.metaKey) return true;
      if (!activeId || !tabs[activeId] || tabs[activeId].isWelcome) return true;
      var tab = tabs[activeId];
      var dot = document.getElementById('tdot_' + activeId);
      var c = dot ? dot.style.background.replace(/\s/g, '') : '';
      var isDown = (c === 'rgb(136,136,136)' || c === '#888' || c === 'rgb(231,76,60)' || c === '#e74c3c');
      if (!isDown) return true;
      reconnectActive();
      return false;
    });
    var fitAddon = null;
    try {
      var FitAddonClass = (typeof FitAddon !== 'undefined' && FitAddon.FitAddon) ? FitAddon.FitAddon : FitAddon;
      if (FitAddonClass) {
        fitAddon = new FitAddonClass();
        term.loadAddon(fitAddon);
        diag('[newTab] FitAddon loaded');
      } else {
        diag('[newTab] ERROR: FitAddon not found!');
      }
    } catch (e) {
      diag('[newTab] FitAddon error: ' + e);
    }
    tabs[id] = { term: term, termDiv: termDiv, ws: null, conn: conn, label: label, isWelcome: !!isWelcome, fitAddon: fitAddon };

    var closeBtn = div.querySelector('.tab-close');
    if (closeBtn) closeBtn.onclick = function () { closeTab(id); };
    div.onclick = function () {
      diag('[click] tab=' + id + ' exists=' + !!tabs[id]);
      if (tabs[id]) activateTab(id);
      else diag('[click] 忽略: tab已关闭');
    };

    if (isWelcome) {
      term.writeln('\x1b[1;32m=== SSHX 终端 ===\x1b[0m');
      term.writeln('');
      term.writeln('  \x1b[36m快速连接\x1b[0m:填写上方主机/端口/用户名/密码,点击「快速链接」');
      term.writeln('  \x1b[36m连接管理\x1b[0m:解锁后点击左侧列表打开已保存连接');
      term.writeln('  \x1b[36m新增连接\x1b[0m:解锁后点击左下角「+ 新增连接」保存');
      term.writeln('');
      term.writeln('  \x1b[33m提示:右键连接可删除\x1b[0m');
      activateTab(id);
      return;
    }

    if (conn) {
      var retryCount = 0;
      var maxRetries = 3;
      var retryDelay = 1000;

      function attemptConnect() {
        retryCount++;
        diag('[SSH] 尝试连接 #' + retryCount + ' tab=' + id + ' host=' + conn.host + ':' + (conn.port || 22) + ' user=' + conn.user);

        var ws;
        try { ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/app/sshx/ws'); }
        catch (e) {
          term.writeln('\x1b[31mWebSocket 创建失败\x1b[0m');
          diag('[SSH] WebSocket 创建失败: ' + e);
          return;
        }
        tabs[id].ws = ws;
        wsMap[id] = ws;

        ws.onopen = function () {
          diag('[SSH] WebSocket 打开 tab=' + id);
          setDot(id, '#4caf50');
          if (retryCount === 1) {
            tabs[id]._disconnectShown = false;
            tabs[id]._connected = false;
          }
          if (conn.saved) {
            ws.send(JSON.stringify({ type: 'connectSaved', id: conn.id }));
            diag('[SSH] 发送 connectSaved id=' + conn.id);
          } else {
            ws.send(JSON.stringify({ type: 'connect', host: conn.host, port: conn.port, username: conn.user, password: conn.pass || '' }));
            diag('[SSH] 发送 connect');
          }
        };
        ws.onmessage = function (e) {
          var m = JSON.parse(e.data);
          if (m.type === 'data') { term.write(atob(m.data)); }
          else if (m.type === 'ready') {
            diag('[SSH] 已连接 tab=' + id + ' mode=' + (m.mode || 'ssh'));
            retryCount = 0; // 成功后重置
            tabs[id]._disconnectShown = false; // 重置断开提示标志
            tabs[id]._connected = true; // 标记已成功连接
          }
          else if (m.type === 'close' || m.type === 'closed') {
            var durationInfo = m.duration ? ' (连接时长: ' + m.duration + ')' : '';
            diag('[SSH] 连接关闭 tab=' + id + durationInfo);
            setDot(id, '#888');
            if (!tabs[id]._connected) return; // 未成功连接过，不显示提示
            showDisconnectPrompt(id, term, null);
          }
          else if (m.type === 'error') {
            var errMsg = m.data || m.message || '未知';
            diag('[SSH] 错误 tab=' + id + ' ' + errMsg + ' retryable=' + m.retryable);
            if (m.retryable && retryCount < maxRetries && !tabs[id]._connected) {
              diag('[SSH] 自动重试 ' + retryCount + '/' + maxRetries);
              setDot(id, '#ffa500');
              ws.close();
              setTimeout(attemptConnect, retryDelay);
            } else {
              setDot(id, '#e74c3c');
              showDisconnectPrompt(id, term, 'Network error: ' + errMsg);
            }
          }
        };
        ws.onerror = function (err) {
          diag('[SSH] WebSocket 错误 tab=' + id);
          setDot(id, '#e74c3c');
        };
        ws.onclose = function () {
          diag('[SSH] WebSocket 关闭 tab=' + id);
          setDot(id, '#888');
          if (!tabs[id]._connected) return; // 未成功连接过，不显示提示
          showDisconnectPrompt(id, term, null);
        };
      }

      // 注册终端输入/resize处理器（使用tabs[id].ws引用当前WebSocket）
      var onDataDisposable = term.onData(function (data) {
        if (tabs[id].ws && tabs[id].ws.readyState === 1) tabs[id].ws.send(JSON.stringify({ type: 'data', data: btoa(data) }));
      });
      var onResizeDisposable = term.onResize(function (size) {
        if (tabs[id].ws && tabs[id].ws.readyState === 1) tabs[id].ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
      });
      tabs[id]._onDataDisposable = onDataDisposable;
      tabs[id]._onResizeDisposable = onResizeDisposable;

      attemptConnect();
    }

    activateTab(id);
    // 多次fit确保终端正确渲染
    var fa = fitAddon;
    setTimeout(function () { try { fa && fa.fit(); diag('[newTab] fit1 done'); } catch (e) { diag('[newTab] fit1 error: ' + e); } }, 50);
    setTimeout(function () { try { fa && fa.fit(); diag('[newTab] fit2 done'); } catch (e) {} }, 200);
    setTimeout(function () { try { fa && fa.fit(); diag('[newTab] fit3 done'); } catch (e) {} }, 500);
  }

  function activateTab(id) {
    diag('[activateTab] ====== 开始激活 tab=' + id + ' exists=' + !!tabs[id] + ' ======');
    if (!tabs[id]) {
      diag('[activateTab] ERROR: tab不存在!');
      return;
    }
    activeId = id;
    Object.keys(tabs).forEach(function (tid) {
      var t = tabs[tid];
      if (t && t.termDiv) {
        var shouldShow = tid === id;
        t.termDiv.style.display = shouldShow ? '' : 'none';
        t.termDiv.style.visibility = shouldShow ? 'visible' : 'hidden';
        t.termDiv.style.zIndex = shouldShow ? '10' : '0';
        diag('[activateTab] tab=' + tid + ' display=' + (shouldShow ? 'default' : 'none'));
      }
      var d = document.getElementById('tab_' + tid);
      if (d) d.classList.toggle('active', tid === id);
    });
    var t = tabs[id];
    if (t && t.term && t.fitAddon) {
      diag('[activateTab] fit term tab=' + id);
      // 输出容器尺寸诊断
      var termRect = t.termDiv.getBoundingClientRect();
      var terminalsRect = el('terminals').getBoundingClientRect();
      diag('[activateTab] terminals: ' + terminalsRect.width + 'x' + terminalsRect.height);
      diag('[activateTab] termDiv: ' + termRect.width + 'x' + termRect.height);
      // 延迟fit确保DOM已更新
      setTimeout(function () {
        try {
          t.fitAddon.fit();
          var canvas = t.termDiv.querySelector('canvas');
          if (canvas) {
            diag('[activateTab] canvas: ' + canvas.width + 'x' + canvas.height + ' rows=' + t.term.rows + ' cols=' + t.term.cols);
          }
        } catch (e) {
          diag('[activateTab] fit错误: ' + e);
        }
      }, 50);
    }
    scrollTabsIntoView();
    updateTabsScrollState();
    diag('[activateTab] ====== 完成激活 activeId=' + activeId + ' ======');
  }

  function scrollTabsIntoView() {
    var bar = el('tabs');
    var active = bar.querySelector('.tab.active');
    if (active) active.scrollIntoView({ inline: 'nearest', behavior: 'smooth', block: 'nearest' });
  }

  // 根据是否可滚动更新左右箭头按钮的可用状态
  function updateTabsScrollState() {
    var bar = el('tabs');
    var left = el('tabsLeft');
    var right = el('tabsRight');
    if (!bar || !left || !right) return;
    var maxScroll = bar.scrollWidth - bar.clientWidth;
    var canLeft = bar.scrollLeft > 1;
    var canRight = bar.scrollLeft < (maxScroll - 1);
    left.disabled = !canLeft;
    right.disabled = !canRight;
    // 完全不需要滚动时隐藏箭头按钮
    left.style.display = (canLeft || canRight) ? '' : 'none';
    right.style.display = (canLeft || canRight) ? '' : 'none';
  }

  function closeTab(id, force) {
    var tab = tabs[id];
    if (!tab) return;
    // 欢迎标签不允许关闭
    if (tab.isWelcome) { diag('[closeTab] 拒绝关闭欢迎标签 id=' + id); return; }
    var isWelcome = tab.isWelcome;
    var tabCount = Object.keys(tabs).length;
    var needConfirm = !force && !isWelcome && tab.ws && tabCount === 1;
    if (needConfirm) {
      showConfirm('关闭最后一个标签页?', function () { doClose(id, false); });
    } else {
      doClose(id, isWelcome);
    }
  }

  function doClose(id, isWelcome) {
    var tab = tabs[id];
    if (!tab) { diag('[doClose] ERROR: tab不存在 id=' + id); return; }

    diag('[doClose] === 开始关闭 id=' + id + ' activeId=' + activeId + ' ===');

    // 在删除前找到下一个要激活的 tab
    var nextId = null;
    if (activeId === id) {
      var tabElements = Array.from(el('tabs').children);
      diag('[doClose] DOM tabs: ' + tabElements.map(function(el){return el.id.replace('tab_','');}).join(','));
      var closedIndex = tabElements.findIndex(function (el) { return el.id === 'tab_' + id; });
      diag('[doClose] closedIndex=' + closedIndex + ' total=' + tabElements.length);
      if (closedIndex === -1) {
        diag('[doClose] ERROR: 找不到当前tab在DOM中');
      } else if (closedIndex >= 0 && closedIndex < tabElements.length - 1) {
        // 右侧有 tab
        var nextEl = tabElements[closedIndex + 1];
        if (nextEl) nextId = nextEl.id.replace('tab_', '');
        diag('[doClose] 右侧 tab: ' + nextId);
      } else if (closedIndex > 0) {
        // 左侧有 tab
        var prevEl = tabElements[closedIndex - 1];
        if (prevEl) nextId = prevEl.id.replace('tab_', '');
        diag('[doClose] 左侧 tab: ' + nextId);
      } else {
        diag('[doClose] 无相邻tab (closedIndex=' + closedIndex + ', length=' + tabElements.length + ')');
      }
    }

    // 清理资源
    if (tab.ws) { try { tab.ws.close(); } catch (e) {} }
    if (tab.term) { try { tab.term.dispose(); } catch (e) {} }
    delete tabs[id];
    delete wsMap[id];

    // 删除 DOM
    var t = document.getElementById('term_' + id);
    var d = document.getElementById('tab_' + id);
    if (t) t.remove();
    if (d) d.remove();

    diag('[doClose] 已删除 id=' + id + ' nextId=' + nextId + ' tabs[nextId]=' + !!tabs[nextId]);

    // 激活相邻 tab
    if (activeId === id) {
      diag('[doClose] 需要激活新tab');
      if (nextId && tabs[nextId]) {
        diag('[doClose] 激活 nextId: ' + nextId);
        activateTab(nextId);
      } else {
        var keys = Object.keys(tabs);
        diag('[doClose] 剩余keys: ' + keys.join(','));
        if (keys.length > 0) {
          diag('[doClose] 激活首个: ' + keys[0]);
          activateTab(keys[0]);
        } else if (!isWelcome) {
          diag('[doClose] 无剩余 tab,显示欢迎');
          newTab('欢迎', true);
        }
      }
    }
    updateTabsScrollState();
    diag('[doClose] === 完成关闭 ===');
  }

  function closeAllTabs(noWelcome) {
    // 全部关闭时跳过欢迎标签
    var welcomeId = null;
    Object.keys(tabs).forEach(function (id) {
      var tab = tabs[id];
      if (tab && tab.isWelcome) {
        welcomeId = id;
        return;
      }
      if (tab) {
        if (tab.ws) try { tab.ws.close(); } catch (e) {}
        if (tab.term) try { tab.term.dispose(); } catch (e) {}
      }
    });
    // 只清除非欢迎标签的 DOM
    var tabsContainer = el('tabs');
    var terminalsContainer = el('terminals');
    Array.from(tabsContainer.children).forEach(function (child) {
      var id = child.id.replace('tab_', '');
      if (id !== welcomeId) child.remove();
    });
    Array.from(terminalsContainer.children).forEach(function (child) {
      var id = child.id.replace('term_', '');
      if (id !== welcomeId) child.remove();
    });
    // 从 tabs / wsMap 中清除非欢迎标签
    Object.keys(tabs).forEach(function (id) {
      if (id !== welcomeId) {
        delete tabs[id];
        delete wsMap[id];
      }
    });
    // 如果之前激活的 tab 被关了，激活欢迎标签（如果存在）；否则新建欢迎标签
    if (activeId !== welcomeId) {
      activeId = welcomeId;
      if (welcomeId && tabs[welcomeId]) {
        var div = document.getElementById('tab_' + welcomeId);
        if (div) div.classList.add('active');
      } else if (!noWelcome) {
        newTab('欢迎', true);
      }
    }
    if (!noWelcome && !welcomeId) newTab('欢迎', true);
    updateTabsScrollState();
  }

  el('closeAllBtn').onclick = function () {
    var tabCount = Object.keys(tabs).length;
    if (tabCount === 0) return;
    showConfirm('关闭所有标签页?', function () { closeAllTabs(false); });
  };

  el('tabsLeft').onclick = function () { var b = el('tabs'); b.scrollBy({ left: -120, behavior: 'smooth' }); setTimeout(updateTabsScrollState, 350); };
  el('tabsRight').onclick = function () { var b = el('tabs'); b.scrollBy({ left: 120, behavior: 'smooth' }); setTimeout(updateTabsScrollState, 350); };
  el('tabs').addEventListener('scroll', updateTabsScrollState);
  window.addEventListener('resize', updateTabsScrollState);
  // 初始化箭头状态
  setTimeout(updateTabsScrollState, 0);

  el('diagBtn').onclick = function () { el('diag').classList.toggle('open'); };
  el('diagClose').onclick = function () { el('diag').classList.remove('open'); };

  // ---- 侧栏切换 ----
  function updateSidebarState() {
    var sb = el('sidebar');
    var exp = el('sidebarExpand');
    var isMobile = window.innerWidth <= 640;
    if (sidebarCollapsed) {
      sb.classList.add('collapsed');
      sb.classList.remove('expanded');
      if (exp) exp.style.display = 'flex';
      document.body.classList.remove('sidebar-open');
    } else {
      sb.classList.remove('collapsed');
      sb.classList.add('expanded');
      if (exp) exp.style.display = 'none';
      document.body.classList.toggle('sidebar-open', isMobile);
    }
  }

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    updateSidebarState();
    setTimeout(fitAllTerminals, 160);
  }

  el('sidebarToggle') && (el('sidebarToggle').onclick = function(e) {
    e.stopPropagation();
    toggleSidebar();
  });
  el('sidebarExpand') && (el('sidebarExpand').onclick = function (e) {
    e.stopPropagation();
    sidebarCollapsed = false;
    updateSidebarState();
    setTimeout(fitAllTerminals, 160);
  });

  // 点击遮罩关闭侧栏（排除侧栏按钮和侧栏本身）
  document.addEventListener('click', function (e) {
    if (document.body.classList.contains('sidebar-open') &&
        !el('sidebar').contains(e.target) &&
        e.target.id !== 'sidebarExpand') {
      sidebarCollapsed = true;
      updateSidebarState();
      setTimeout(fitAllTerminals, 160);
    }
  });

  // ---- 顶栏切换（手机端） ----
  var topbarVisible = false;
  function toggleTopbar() {
    topbarVisible = !topbarVisible;
    var topbar = el('topbar');
    var toggleBtn = el('topbarToggle');
    if (topbarVisible) {
      topbar.classList.add('topbar-open');
      toggleBtn.classList.add('active');
    } else {
      topbar.classList.remove('topbar-open');
      toggleBtn.classList.remove('active');
    }
    setTimeout(fitAllTerminals, 160);
  }

  el('topbarToggle') && (el('topbarToggle').onclick = function(e) {
    e.stopPropagation();
    toggleTopbar();
  });

  // 窗口大小变化时自适应所有终端
  function fitAllTerminals() {
    Object.keys(tabs).forEach(function (id) {
      var t = tabs[id];
      if (t && t.fitAddon) {
        try { t.fitAddon.fit(); } catch (e) {}
      }
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      fitAllTerminals();
    }, 100);
  });

  // 导出连接
  el('exportBtn').onclick = function () {
    fetch(PREFIX + '/api/connections/export', {
      headers: { 'x-app-token': getToken() }
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.data) {
        var blob = new Blob([data.data], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'sshx-connections-' + new Date().toISOString().slice(0,10) + '.sshx';
        a.click();
        URL.revokeObjectURL(url);
        diag('[导出] 成功');
      } else {
        showMsg('导出失败: ' + (data.error || '未知错误'));
      }
    })
    .catch(function (e) {
      showMsg('导出失败: ' + e.message);
    });
  };

  // 导入连接
  el('importBtn').onclick = function () {
    el('importFileInput').click();
  };
  el('importFileInput').onchange = function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (evt) {
      var content = evt.target.result;
      fetch(PREFIX + '/api/connections/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-token': getToken()
        },
        body: JSON.stringify({ data: content })
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          showMsg('导入成功: 新增 ' + data.added + ' 条,跳过 ' + data.skipped + ' 条(重复或无效)');
          // 重新加载连接列表
          fetch(PREFIX + '/api/connections', { headers: { 'x-app-token': getToken() } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d.connections) { conns = d.connections; renderConnList(); }
            });
        } else {
          showMsg('导入失败: ' + (data.error || '未知错误'));
        }
      })
      .catch(function (e) {
        showMsg('导入失败: ' + e.message);
      });
    };
    reader.readAsText(file);
    e.target.value = ''; // 重置以便再次选择同一文件
  };

  document.onclick = function (e) {
    var m = el('ctxMenu');
    if (m && m.style.display !== 'none' && !m.contains(e.target)) m.style.display = 'none';
  };

  function showConfirm(msg, onOk) {
    el('confirmMsg').textContent = msg;
    el('confirmModal').style.display = 'flex';
    el('confirmOk').onclick = function () { el('confirmModal').style.display = 'none'; if (onOk) onOk(); };
    el('confirmCancel').onclick = function () { el('confirmModal').style.display = 'none'; };
  }

  function reconnectActive() {
    if (!activeId || !tabs[activeId] || tabs[activeId].isWelcome) return;
    var tab = tabs[activeId];
    if (!tab.conn) { showMsg('无法重连：缺少连接信息'); return; }
    // 检查 dot 颜色：只在断开(灰#888)或错误(红#e74c3c)时允许
    var dot = document.getElementById('tdot_' + activeId);
    var c = dot ? dot.style.background.replace(/\s/g, '') : '';
    var isDown = (c === 'rgb(136,136,136)' || c === '#888' || c === 'rgb(231,76,60)' || c === '#e74c3c');
    if (!isDown) { showMsg('当前连接正常，无需重连'); return; }

    var conn = tab.conn;
    diag('[reconnect] tab=' + activeId + ' saved=' + !!conn.saved);
    tab.term.writeln('\r\n\x1b[33m⚡ 正在重连...\x1b[0m');
    setDot(activeId, '#ffa500');

    // 关闭旧 WebSocket
    if (tab.ws) {
      try { tab.ws.onclose = null; tab.ws.close(); } catch(e) {}
      tab.ws = null;
    }
    tabs[activeId]._connected = false; // 重置连接状态标记

    var ws;
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/app/sshx/ws');
    } catch(e) {
      tab.term.writeln('\x1b[31m重连失败: WebSocket 创建失败\x1b[0m');
      setDot(activeId, '#e74c3c');
      return;
    }
    tab.ws = ws;
    wsMap[activeId] = ws;

    var currentId = activeId; // 捕获当前 id，避免重连期间切换 tab 导致串线

    ws.onopen = function () {
      setDot(currentId, '#4caf50');
      tabs[currentId]._disconnectShown = false; // 重置断开标记
      tabs[currentId]._connected = false; // 重连开始时重置，等待 ready 确认
      if (conn.saved) {
        ws.send(JSON.stringify({ type: 'connectSaved', id: conn.id }));
      } else {
        ws.send(JSON.stringify({ type: 'connect', host: conn.host, port: conn.port, username: conn.user, password: conn.pass || '' }));
      }
    };
    ws.onmessage = function (e) {
      var m = JSON.parse(e.data);
      if (m.type === 'data') { tab.term.write(atob(m.data)); }
      else if (m.type === 'ready') {
        tab.term.writeln('\r\n\x1b[32m✓ 已重连\x1b[0m\r\n');
        tabs[currentId]._connected = true;
        diag('[reconnect] 重连成功 tab=' + currentId);
      }
      else if (m.type === 'close' || m.type === 'closed') {
        var durationInfo = m.duration ? ' (连接时长: ' + m.duration + ')' : '';
        diag('[reconnect] 连接关闭 tab=' + currentId + durationInfo);
        setDot(currentId, '#888');
        showDisconnectPrompt(currentId, tab.term, null);
      }
      else if (m.type === 'error') {
        setDot(currentId, '#e74c3c');
        showDisconnectPrompt(currentId, tab.term, 'Network error: ' + (m.data || m.message || '未知'));
      }
    };
    ws.onerror = function () { setDot(currentId, '#e74c3c'); };
    ws.onclose = function () {
      diag('[reconnect] WebSocket 关闭 tab=' + currentId);
      setDot(currentId, '#888');
      showDisconnectPrompt(currentId, tab.term, null);
    };
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key === 'c' && activeId && tabs[activeId] && !tabs[activeId].isWelcome) {
      // Let xterm handle it
    }
    if (e.alt && e.key === 'w') { e.preventDefault(); if (activeId) closeTab(activeId); }
    // R 键重连：仅在焦点不在输入框、且当前 tab 断开时触发
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (activeId && tabs[activeId] && !tabs[activeId].isWelcome) {
        var dot = document.getElementById('tdot_' + activeId);
        var c = dot ? dot.style.background.replace(/\s/g, '') : '';
        if (c === 'rgb(136,136,136)' || c === '#888' || c === 'rgb(231,76,60)' || c === '#e74c3c') {
          e.preventDefault();
          reconnectActive();
        }
      }
    }
  });

  // 初始加载:始终先查询服务端锁状态,不依赖本地 token 判断登录态
  checkAuthStatus();

  newTab('欢迎', true);
  diag('初始化完成');

})();
