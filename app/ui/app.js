'use strict';
(function () {
  var PREFIX = '/app/sshx';
  function el(id) { return document.getElementById(id); }
    // ---- 字符集 (Notepad++ 风格底部状态栏) ----
  var currentEncoding = 'utf-8';
  var _encMap = {
    'utf-8':'utf-8','gbk':'gb18030','gb18030':'gb18030','big5':'big5',
    'shift_jis':'shift_jis','euc-jp':'euc-jp','euc-kr':'euc-kr',
    'koi8-r':'koi8-r','iso-8859-1':'iso-8859-1','iso-8859-2':'iso-8859-2',
    'windows-1252':'windows-1252','cp866':'ibm866','macintosh':'macintosh'
  };
  function _decodeBytes(b64) {
    var bytes = Uint8Array.from(atob(b64), function(c){return c.charCodeAt(0);});
    try { return new TextDecoder(currentEncoding).decode(bytes); }
    catch(e) {
      diag('[enc] 不支持 '+currentEncoding+', 回退 utf-8');
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
  function setEncoding(enc) {
    var real = _encMap[enc] || enc;
    try { new TextDecoder(real); currentEncoding = real; diag('[enc] 切换到 '+enc+' ('+real+')'); }
    catch(e) { diag('[enc] 浏览器不支持 '+real); }
  }
  var encSel = el('encodingSel');
  if (encSel) encSel.onchange = function () { setEncoding(encSel.value); };

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
    div.innerHTML = (isWelcome ? '' : '<span class="tab-sftp" id="tsftp_' + id + '" title="文件树">&#128193;</span>') + '<span class="tab-dot" id="tdot_' + id + '"></span><span class="tab-label">' + esc(displayLabel) + '</span>' + (isWelcome ? '' : '<button class="tab-close">×</button>');
    el('tabs').appendChild(div);
    var termDiv = document.createElement('div');
    termDiv.id = 'term_' + id;
    termDiv.className = 'terminal';
    var wrapDiv = null;
    if (!isWelcome) {
      wrapDiv = document.createElement('div');
      wrapDiv.id = 'wrap_' + id;
      wrapDiv.className = 'tab-wrap';
      wrapDiv.style.display = 'none';
      wrapDiv.style.visibility = 'hidden';
      wrapDiv.style.zIndex = '0';
      var termArea = document.createElement('div');
      termArea.className = 'term-area';
      termArea.appendChild(termDiv);
      wrapDiv.appendChild(termArea);
      el('terminals').appendChild(wrapDiv);
    } else {
      el('terminals').appendChild(termDiv);
    }

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
    tabs[id] = { term: term, termDiv: termDiv, wrapDiv: wrapDiv, ws: null, conn: conn, label: label, isWelcome: !!isWelcome, fitAddon: fitAddon, sftpTreeOpen: false, sftpPath: '/' };

    var closeBtn = div.querySelector('.tab-close');
    if (closeBtn) closeBtn.onclick = function () { closeTab(id); };
    var sftpBtn = div.querySelector('.tab-sftp');
    if (sftpBtn) {
      sftpBtn.onclick = function (e) {
        e.stopPropagation();
        sftpTreeToggle(id);
      };
    }
    div.onclick = function () {
      diag('[click] tab=' + id + ' exists=' + !!tabs[id]);
      if (tabs[id]) activateTab(id);
      else diag('[click] 忽略: tab已关闭');
    };

    if (isWelcome) {
      if (typeof renderWelcome === 'function') renderWelcome(term);
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
          if (m.type === 'data') { term.write(_decodeBytes(m.data)); }
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
        if (t.wrapDiv) {
          t.wrapDiv.style.display = shouldShow ? 'flex' : 'none';
          t.wrapDiv.style.visibility = shouldShow ? 'visible' : 'hidden';
          t.wrapDiv.style.zIndex = shouldShow ? '10' : '0';
        } else if (t.termDiv) {
          t.termDiv.style.display = shouldShow ? '' : 'none';
          t.termDiv.style.visibility = shouldShow ? 'visible' : 'hidden';
          t.termDiv.style.zIndex = shouldShow ? '10' : '0';
        }
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
    updateCloseAllBtn();
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
    var wrap = document.getElementById('wrap_' + id);
    var t = document.getElementById('term_' + id);
    var d = document.getElementById('tab_' + id);
    if (wrap) wrap.remove();
    else if (t) t.remove();
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
    updateCloseAllBtn();
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
      var id = child.id.replace('wrap_', '').replace('term_', '');
      if (id !== welcomeId) child.remove();
    });
    // 从 tabs / wsMap 中清除非欢迎标签
    Object.keys(tabs).forEach(function (id) {
      if (id !== welcomeId) {
        delete tabs[id];
        delete wsMap[id];
      }
    });
    // 全部关闭后激活欢迎标签
    if (welcomeId && tabs[welcomeId]) {
      // 已有欢迎标签：正确调用 activateTab 使其可见
      activeId = welcomeId;
      activateTab(welcomeId);
    } else if (!noWelcome) {
      // 没有欢迎标签则新建（newTab 内部已 activateTab）
      newTab('欢迎', true);
    }
    updateTabsScrollState();
    updateCloseAllBtn();
  }

  // 关闭全部按钮：只有欢迎 tab 时禁用
  function updateCloseAllBtn() {
    var btn = el('closeAllBtn');
    if (!btn) return;
    var tabCount = Object.keys(tabs).length;
    var onlyWelcome = (tabCount === 1 && Object.values(tabs).some(function(t){ return t.isWelcome; }));
    btn.disabled = onlyWelcome;
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
  // 初始化箭头/关闭全部按钮状态
  setTimeout(function(){ updateTabsScrollState(); updateCloseAllBtn(); }, 0);

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
      if (m.type === 'data') { tab.term.write(_decodeBytes(m.data)); }
      else if (m.type === 'ready') {
        tab.term.writeln('\r\n\x1b[32m✓ 已重连\x1b[0m\r\n');
        tabs[currentId]._connected = true;
        diag('[reconnect] 重连成功 tab=' + currentId);
        if (tabs[currentId].sftpTreeOpen) {
          setTimeout(function () { sftpTreeOpen(currentId, tabs[currentId].sftpPath || '/'); }, 100);
        }
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


  // ===== SFTP 侧边文件树 =====
  function sftpTreeToggle(tabId) {
    var tab = tabs[tabId];
    if (!tab || tab.isWelcome) return;
    var wrap = tab.wrapDiv || document.getElementById('wrap_' + tabId);
    if (!wrap) return;
    var panel = wrap.querySelector('.sftp-tree');
    if (panel && !panel.classList.contains('collapsed')) {
      panel.classList.add('collapsed');
      tab.sftpTreeOpen = false;
    } else {
      sftpTreeOpen(tabId, tab.sftpPath || '/');
    }
  }

  function sftpTreeOpen(tabId, path) {
    var tab = tabs[tabId];
    if (!tab || tab.isWelcome) return;
    if (!tab.ws || tab.ws.readyState !== 1) { showMsg('SSH未连接'); return; }
    var wrap = tab.wrapDiv || document.getElementById('wrap_' + tabId);
    if (!wrap) return;
    var panel = wrap.querySelector('.sftp-tree');
    if (!panel) {
      var tpl = document.getElementById('sftpPanelTpl');
      if (!tpl) return;
      panel = tpl.firstElementChild ? tpl.firstElementChild.cloneNode(true) : null;
      if (!panel) return;
      panel.id = 'sftp_' + tabId;
      wrap.appendChild(panel);
    }
    panel.classList.remove('collapsed');
    tab.sftpTreeOpen = true;
    var backBtn = panel.querySelector('[data-action="back"]');
    var upBtn = panel.querySelector('[data-action="up"]');
    var refreshBtn = panel.querySelector('[data-action="refresh"]');
    var mkdirBtn = panel.querySelector('[data-action="mkdir"]');
    if (backBtn) backBtn.onclick = function () {
      var hist = tab._sftpHist = (tab._sftpHist || []);
      if (hist.length > 1) {
        hist.pop();
        sftpTreeOpen(tabId, hist[hist.length - 1]);
      } else {
        sftpTreeOpen(tabId, sftpParentPath(tab.sftpPath || '/'));
      }
    };
    if (upBtn) upBtn.onclick = function () { sftpTreeOpen(tabId, sftpParentPath(tab.sftpPath || '/')); };
    if (refreshBtn) refreshBtn.onclick = function () { sftpTreeOpen(tabId, tab.sftpPath || '/'); };
    if (mkdirBtn) mkdirBtn.onclick = function () { sftpTreeMkdir(tabId); };
    var uploadBtn = panel.querySelector('[data-action="upload"]');
    if (uploadBtn) uploadBtn.onclick = function () { sftpTreeUpload(tabId); };
    if (path) {
      var hist = tab._sftpHist = (tab._sftpHist || []);
      if (hist[hist.length - 1] !== path) hist.push(path);
    }
    sftpTreeList(tabId, path);
  }

  function sftpTreeList(tabId, path) {
    var tab = tabs[tabId];
    if (!tab || !tab.ws) return;
    var reqId = 'sftp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    tab._sftpReqId = reqId;
    tab.sftpPath = path;
    tab.ws.send(JSON.stringify({ type: 'sftp-list', id: reqId, path: path }));
    var origOnMsg = tab.ws.onmessage;
    tab.ws.onmessage = function (ev) {
      var m = JSON.parse(ev.data);
      if (m.id !== reqId) { if (origOnMsg) origOnMsg(ev); return; }
      if (m.type === 'sftp-list') {
        renderSftpTreeList(tabId, m.path, m.items || []);
      } else if (m.type === 'sftp-error') {
        showMsg('SFTP错误: ' + (m.data || '未知'));
      }
      tab.ws.onmessage = origOnMsg;
    };
    setTimeout(function () {
      if (tab.ws && tab.ws.onmessage !== origOnMsg) {
        tab.ws.onmessage = origOnMsg;
        showMsg('SFTP列表超时');
      }
    }, 15000);
  }

  function renderSftpTreeList(tabId, path, items) {
    var tab = tabs[tabId];
    if (!tab) return;
    var wrap = tab.wrapDiv || document.getElementById('wrap_' + tabId);
    if (!wrap) return;
    var panel = wrap.querySelector('.sftp-tree');
    if (!panel) return;
    var list = panel.querySelector('[data-role="list"]');
    if (!list) return;
    var pathEl = panel.querySelector('[data-role="path"]');
    if (pathEl) pathEl.textContent = path || '/';
    items.sort(function (a, b) {
      var ad = sftpIsDir(a), bd = sftpIsDir(b);
      if (ad !== bd) return ad ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    var html = '';
    var base = (path || '/');
    if (!base.endsWith('/')) base += '/';
    items.forEach(function (item) {
      var name = String(item.name || '');
      var isDir = sftpIsDir(item);
      var fullPath = base + name;
      var icon = isDir ? '&#128193;' : '&#128196;';
      var size = isDir ? '' : sftpFormatSize(item.size || 0);
      var date = item.mtime ? sftpFormatDate(item.mtime) : '';
      html += '<div class="sftp-row ' + (isDir ? 'sftp-dir' : 'sftp-file') + '" data-path="' + sftpEscAttr(fullPath) + '" data-name="' + sftpEscAttr(name) + '">' +
        '<span class="sftp-icon">' + icon + '</span>' +
        '<span class="sftp-name">' + sftpEscAttr(name) + '</span>' +
        '<span class="sftp-meta">' + (size ? size + ' ' : '') + date + '</span>' +
        '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.sftp-row').forEach(function (row) {
      bindRow(row);
      row.oncontextmenu = function (e) { e.preventDefault(); sftpRowCtx(e, tabId, row); };
    });
  }

  function sftpIsDir(item) {
    if (item.isDir === true || item.isDir === false) return item.isDir;
    if (item.type === 'd' || item.type === 'dir') return true;
    if (item.attrs) {
      if (typeof item.attrs.isDirectory === 'function' && item.attrs.isDirectory()) return true;
      if (item.attrs.mode && (item.attrs.mode & 0o170000) === 0o040000) return true;
      if (item.attrs.longname && item.attrs.longname[0] === 'd') return true;
    }
    return false;
  }

  function sftpEscAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function sftpFormatSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(2) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function sftpFormatDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function sftpParentPath(p) {
    if (!p || p === '/') return '/';
    var parts = p.split('/').filter(Boolean);
    parts.pop();
    return '/' + parts.join('/');
  }


  function sftpTreeUpload(tabId) {
    var tab = tabs[tabId];
    if (!tab || !tab.ws || tab.ws.readyState !== 1) { showMsg('SSH未连接'); return; }
    var input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) { input.remove(); return; }
      var sftpPanel = el('sftp_' + tabId);
      var progEl = sftpPanel && sftpPanel.querySelector('[data-role="progress"]');
      var progBar = sftpPanel && sftpPanel.querySelector('[data-role="progress-bar"]');
      var progTxt = sftpPanel && sftpPanel.querySelector('[data-role="progress-text"]');
      var progBox = sftpPanel && sftpPanel.querySelector('[data-role="progress-box"]');
      function setSftpProg(pct) { if (progBar) progBar.style.width = pct + '%'; }
      function showSftpProg(show) { if (progBox) progBox.style.display = show ? 'flex' : 'none'; }
      if (progTxt) progTxt.textContent = file.name + '  0%';
      showSftpProg(true);
      setSftpProg(0);
      var finished = false;
      function finishOk() {
        if (finished) return; finished = true;
        setSftpProg(100);
        if (progTxt) progTxt.textContent = file.name + '  100%';
        setTimeout(function () { showSftpProg(false); }, 1200);
        tab.ws.onmessage = origOnMsg;
        sftpTreeList(tabId, tab.sftpPath || '/');
        showMsg('上传成功: ' + file.name);
      }
      function finishFail(msg) {
        if (finished) return; finished = true;
        setSftpProg(0);
        if (progTxt) progTxt.textContent = file.name + '  失败';
        setTimeout(function () { showSftpProg(false); }, 1500);
        tab.ws.onmessage = origOnMsg;
        showMsg('上传失败: ' + (msg || '未知'));
      }
      var origOnMsg = tab.ws.onmessage;
      var reader = new FileReader();
      reader.onprogress = function (pe) {
        if (pe.lengthComputable) {
          var p = Math.round(pe.loaded / pe.total * 80);
          setSftpProg(p);
          if (progTxt) progTxt.textContent = file.name + '  ' + p + '%';
        }
      };
      reader.onload = function (ev) {
        var bytes = new Uint8Array(ev.target.result);
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        var b64 = btoa(bin);
        var base = tab.sftpPath || '/';
        var fullPath = base + (base.endsWith('/') ? '' : '/') + file.name;
        var reqId = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        setSftpProg(85);
        if (progTxt) progTxt.textContent = file.name + '  85%';
        tab.ws.send(JSON.stringify({ type: 'sftp-upload', id: reqId, path: fullPath, data: b64 }));
        setSftpProg(92);
        if (progTxt) progTxt.textContent = file.name + '  92%';
        tab.ws.onmessage = function (ev2) {
          var m; try { m = JSON.parse(ev2.data); } catch (e) { return; }
          if (m.id !== reqId) { if (origOnMsg) origOnMsg(ev2); return; }
          if (m.type === 'sftp-upload') finishOk();
          else if (m.type === 'sftp-error') finishFail(m.data || '服务器错误');
        };
        setTimeout(function () { if (!finished) finishFail('超时'); }, 60000);
      };
      reader.onerror = function () { finishFail('读取文件失败'); input.remove(); };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  }

    function sftpTreeDownload(tabId, path, name) {
    var tab = tabs[tabId];
    if (!tab || !tab.ws) return;
    var reqId = 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    tab.ws.send(JSON.stringify({ type: 'sftp-download', id: reqId, path: path }));
    var origOnMsg = tab.ws.onmessage;
    tab.ws.onmessage = function (ev) {
      var m = JSON.parse(ev.data);
      if (m.id !== reqId) { if (origOnMsg) origOnMsg(ev); return; }
      if (m.type === 'sftp-download' && m.data) {
        var blob = sftpBase64ToBlob(m.data);
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name || 'download'; document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } else if (m.type === 'sftp-error') {
        showMsg('下载失败: ' + (m.data || '未知'));
      }
      tab.ws.onmessage = origOnMsg;
    };
    setTimeout(function () { if (tab.ws && tab.ws.onmessage !== origOnMsg) tab.ws.onmessage = origOnMsg; }, 30000);
  }

  function sftpBase64ToBlob(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr]);
  }

  function sftpTreeMkdir(tabId) {
    var tab = tabs[tabId];
    if (!tab) return;
    var wrap = tab.wrapDiv || document.getElementById('wrap_' + tabId);
    if (!wrap) return;
    var panel = wrap.querySelector('.sftp-tree');
    if (!panel) return;
    var list = panel.querySelector('[data-role="list"]');
    if (!list || list.querySelector('.sftp-mkdir-row')) return;
    var row = document.createElement('div');
    row.className = 'sftp-row sftp-mkdir-row';
    row.innerHTML = '<span class="sftp-icon">&#128193;</span><input type="text" class="sftp-mkdir-input" placeholder="新建目录名" />';
    list.insertBefore(row, list.firstChild);
    var input = row.querySelector('input');
    input.focus();
    input.onkeydown = function (e) {
      if (e.key === 'Enter') {
        var name = input.value.trim();
        if (!name) { row.remove(); return; }
        var base = tab.sftpPath || '/';
        var path = base + (base.endsWith('/') ? '' : '/') + name;
        sftpTreeOp(tabId, 'sftp-mkdir', path);
        row.remove();
      } else if (e.key === 'Escape') {
        row.remove();
      }
    };
  }

  function sftpTreeOp(tabId, type, path) {
    var tab = tabs[tabId];
    if (!tab || !tab.ws) return;
    tab.ws.send(JSON.stringify({ type: type, path: path }));
    showMsg('操作已发送');
    setTimeout(function () { sftpTreeOpen(tabId, tab.sftpPath || '/'); }, 600);
  }

  function sftpRowCtx(e, tabId, rowEl) {
    var path = rowEl.getAttribute('data-path');
    var name = rowEl.getAttribute('data-name');
    var isDir = rowEl.classList.contains('sftp-dir');
    var menu = document.createElement('div');
    menu.className = 'sftp-ctx-menu';
    menu.style.cssText = 'position:fixed;z-index:10000;background:#2d2d30;border:1px solid #555;border-radius:4px;padding:4px 0;box-shadow:0 2px 8px rgba(0,0,0,0.5);';
    var items = [];
    if (isDir) items.push({ label: '&#128193; 打开', action: function () { sftpTreeOpen(tabId, path); } });
    else items.push({ label: '&#11015; 下载', action: function () { sftpTreeDownload(tabId, path, name); } });
    items.push({ label: '&#9999; 重命名', action: function () { sftpTreeRename(tabId, path, name); } });
    items.push({ label: '&#128465; 删除', action: function () { sftpTreeOp(tabId, isDir ? 'sftp-rmdir' : 'sftp-rm', path); } });
    items.forEach(function (it) {
      var div = document.createElement('div');
      div.className = 'sftp-ctx-item';
      div.innerHTML = it.label;
      div.style.cssText = 'padding:4px 12px;cursor:pointer;white-space:nowrap;font-size:13px;color:#e0e0e0;';
      div.onmouseenter = function () { div.style.background = '#0e639c'; div.style.color = '#fff'; };
      div.onmouseleave = function () { div.style.background = ''; div.style.color = ''; };
      div.onclick = function () { menu.remove(); it.action(); };
      menu.appendChild(div);
    });
    var olds = document.querySelectorAll('.sftp-ctx-menu'); for (var oi = 0; oi < olds.length; oi++) olds[oi].remove();
    document.body.appendChild(menu);
    var onDocClick = function (ev) { if (menu && !menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', onDocClick); } };
    setTimeout(function () { document.addEventListener('click', onDocClick); }, 0);
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    setTimeout(function () {
      var close = function (ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 0);
  }

  function sftpTreeRename(tabId, oldPath, oldName) {
    var tab = tabs[tabId];
    if (!tab) return;
    var wrap = tab.wrapDiv || document.getElementById('wrap_' + tabId);
    if (!wrap) return;
    var panel = wrap.querySelector('.sftp-tree');
    if (!panel) return;
    var list = panel.querySelector('[data-role="list"]');
    if (!list) return;
    var row = list.querySelector('[data-path="' + sftpEscAttr(oldPath) + '"]');
    if (!row) return;
    var origHtml = row.innerHTML;
    var icon = row.querySelector('.sftp-icon') ? row.querySelector('.sftp-icon').innerHTML : '&#128196;';
    row.innerHTML = '<span class="sftp-icon">' + icon + '</span><input type="text" class="sftp-rename-input" value="' + sftpEscAttr(oldName) + '" />';
    var input = row.querySelector('input');
    input.focus(); input.select();
    var restore = function () { row.innerHTML = origHtml; bindRow(row); };
    input.onkeydown = function (e) {
      if (e.key === 'Enter') {
        var newName = input.value.trim();
        if (!newName || newName === oldName) { restore(); return; }
        var newPath = sftpParentPath(oldPath) + '/' + newName;
        sftpTreeOp(tabId, 'sftp-rename', { oldPath: oldPath, newPath: newPath });
        restore();
      } else if (e.key === 'Escape') {
        restore();
      }
    };
    input.onblur = function () { setTimeout(restore, 200); };
  }

  function bindRow(row) {
    row.onclick = function () {
      var list = row.closest('.sftp-list');
      if (list) {
        var prev = list.querySelector('.sftp-row.active');
        if (prev && prev !== row) prev.classList.remove('active');
      }
      row.classList.add('active');
    };
    row.ondblclick = function () {
      var tabId = row.closest('.sftp-tree').id.replace('sftp_', '');
      var p = row.getAttribute('data-path');
      if (row.classList.contains('sftp-dir')) sftpTreeOpen(tabId, p);
      else sftpTreeDownload(tabId, p, row.getAttribute('data-name'));
    };
    row.oncontextmenu = function (e) { e.preventDefault(); sftpRowCtx(e, row.closest('.sftp-tree').id.replace('sftp_', ''), row); };
  }
  // ===== SFTP END =====
})();
