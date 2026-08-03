'use strict';
// sshx 后端：监听 Unix Socket，经 fnOS 统一网关提供前端、REST 连接管理 API（含应用登录锁）、WebSocket 多终端。
// 全程以 fnOS 专用包用户（非 root）运行。

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Client } = require('ssh2');

const APPDEST = process.env.TRIM_APPDEST || __dirname;
const SOCK_PATH = path.join(APPDEST, 'app.sock');
const UI_DIR = path.join(APPDEST, 'ui');
const PREFIX = '/app/sshx';
const CONN_FILE = path.join(APPDEST, 'connections.json');
const SETTINGS_FILE = path.join(APPDEST, 'settings.json');
const MC_KEY = process.env.MC_KEY || 'memory_clear';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// ---- AES-256-GCM 加密/解密 ----
function deriveKey(appPassword) {
  // 从 App 密码派生 32 字节密钥
  return crypto.createHash('sha256').update('sshx-encryption-key:' + appPassword).digest();
}

function encryptPassword(plaintext, appPassword) {
  if (!plaintext || !appPassword) return '';
  try {
    const key = deriveKey(appPassword);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // 格式: iv:authTag:encrypted (hex)
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');
  } catch (e) {
    console.error('[sshx] encryptPassword error', e);
    return '';
  }
}

function decryptPassword(ciphertext, appPassword) {
  if (!ciphertext || !appPassword) return '';
  try {
    const key = deriveKey(appPassword);
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return ciphertext; // 不是加密格式，返回原文
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    console.error('[sshx] decryptPassword error', e);
    return '';
  }
}

// ---- 连接持久化 ----
function loadConns() {
  try {
    const d = JSON.parse(fs.readFileSync(CONN_FILE, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch (e) {
    return [];
  }
}
function saveConns(arr) {
  try {
    fs.writeFileSync(CONN_FILE, JSON.stringify(arr, null, 2));
    return true;
  } catch (e) {
    console.error('[sshx] saveConns error', e);
    return false;
  }
}

// ---- 导出/导入加密 ----
function encryptExport(data) {
  try {
    const key = crypto.createHash('sha256').update(MC_KEY).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify(data);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return 'SSHX1:' + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');
  } catch (e) {
    console.error('[sshx] encryptExport error', e);
    return null;
  }
}

function decryptExport(ciphertext) {
  try {
    if (!ciphertext.startsWith('SSHX1:')) return null;
    const parts = ciphertext.split(':');
    if (parts.length !== 4) return null;
    const key = crypto.createHash('sha256').update(MC_KEY).digest();
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encrypted = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (e) {
    console.error('[sshx] decryptExport error', e);
    return null;
  }
}

function sanitizeConn(c) {
  if (!c || typeof c !== 'object') return null;
  const host = String(c.host || '').trim();
  const username = String(c.username || '').trim();
  const port = Number(c.port) || 22;
  if (!host || port < 1 || port > 65535 || !username) return null;
  return {
    id: c.id ? String(c.id) : '',
    name: String(c.name || host).slice(0, 80),
    host,
    port,
    username,
    password: c.password ? String(c.password) : '',
    privateKey: c.privateKey ? String(c.privateKey) : '',
    group: c.group ? String(c.group).slice(0, 40) : '',
  };
}

// ---- 应用登录锁 ----
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}
function saveSettings(s) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
    return true;
  } catch (e) {
    console.error('[sshx] saveSettings error', e);
    return false;
  }
}
function authOk(req, parsed) {
  const s = loadSettings();
  if (!s.appPasswordHash) return true; // 未设锁
  const token = req.headers['x-app-token'] || (parsed && parsed.query && parsed.query.token);
  return token === s.appPasswordHash;
}

function getEncryptionKey() {
  const s = loadSettings();
  return s.encryptionKey || '';
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ---- REST API ----
function handleApi(req, res) {
  const parsed = url.parse(req.url, true);
  const rel = parsed.pathname.startsWith(PREFIX + '/api')
    ? parsed.pathname.slice((PREFIX + '/api').length)
    : parsed.pathname;

  // 应用锁状态 / 设置
  if (rel === '/settings') {
    if (req.method === 'GET') {
      sendJson(res, 200, { locked: !!loadSettings().appPasswordHash });
      return;
    }
    if (req.method === 'POST') {
      if (loadSettings().appPasswordHash && !authOk(req, parsed)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        let p;
        try {
          p = JSON.parse(body);
        } catch (e) {
          sendJson(res, 400, { error: 'bad json' });
          return;
        }
        const pw = String(p.appPassword || '');
        if (pw.length < 4) {
          sendJson(res, 400, { error: '密码至少4位' });
          return;
        }
        const hash = sha256(pw);
        const encKey = deriveKey(hash);
        saveSettings({ 
          appPasswordHash: hash, 
          encryptionKey: encKey.toString('hex')
        });
        sendJson(res, 200, { ok: true, token: hash });
      });
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  // 登录校验
  if (rel === '/login') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let p;
      try {
        p = JSON.parse(body);
      } catch (e) {
        sendJson(res, 400, { error: 'bad json' });
        return;
      }
      const s = loadSettings();
      if (!s.appPasswordHash) {
        sendJson(res, 400, { error: 'not locked' });
        return;
      }
      if (sha256(String(p.password || '')) === s.appPasswordHash) {
        sendJson(res, 200, { ok: true, token: s.appPasswordHash });
      } else {
        sendJson(res, 401, { error: 'wrong password' });
      }
    });
    return;
  }

  // 连接测试（需登录锁通过）
  if (rel === '/connections/test') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    if (!authOk(req, parsed)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let p;
      try {
        p = JSON.parse(body);
      } catch (e) {
        sendJson(res, 400, { error: 'bad json' });
        return;
      }
      const host = String(p.host || '').trim();
      const port = Number(p.port) || 22;
      const sshUser = String(p.username || '').trim();
      const password = p.password ? String(p.password) : '';
      if (!host || !sshUser) {
        sendJson(res, 400, { error: '主机和用户名必填' });
        return;
      }
      const client = new Client();
      let done = false;
      const finish = (code, obj) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { client.end(); } catch (e) {}
        sendJson(res, code, obj);
      };
      const timer = setTimeout(() => finish(200, { ok: false, error: '连接超时' }), 15000);
      client.on('ready', () => finish(200, { ok: true }));
      client.on('error', (e) => finish(200, { ok: false, error: e.message }));
      client.on('close', () => { if (!done) finish(200, { ok: false, error: '连接已关闭' }); });
      try {
        client.connect({ host, port, username: sshUser, password: password || undefined, readyTimeout: 15000, keepaliveInterval: 0 });
      } catch (e) {
        finish(200, { ok: false, error: e.message });
      }
    });
    return;
  }

  // 导出连接（需登录锁通过）
  if (rel === '/connections/export') {
    if (!authOk(req, parsed)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const conns = loadConns();
    const encKey = getEncryptionKey();
    // 解密所有密码
    const exportData = conns.map((c) => {
      const item = Object.assign({}, c);
      if (c.hasEncryptedPassword && c.password && encKey) {
        const decrypted = decryptPassword(c.password, encKey);
        if (decrypted) item.password = decrypted;
      }
      delete item.hasEncryptedPassword;
      return item;
    });
    const encrypted = encryptExport(exportData);
    if (!encrypted) {
      sendJson(res, 500, { error: 'export failed' });
      return;
    }
    sendJson(res, 200, { data: encrypted });
    return;
  }

  // 导入连接（需登录锁通过）
  if (rel === '/connections/import') {
    if (!authOk(req, parsed)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let p;
      try {
        p = JSON.parse(body);
      } catch (e) {
        sendJson(res, 400, { error: 'bad json' });
        return;
      }
      const data = decryptExport(p.data);
      if (!data || !Array.isArray(data)) {
        sendJson(res, 400, { error: 'invalid import data' });
        return;
      }
      const encKey = getEncryptionKey();
      const conns = loadConns();
      let added = 0, skipped = 0;
      data.forEach((item) => {
        const conn = sanitizeConn(item);
        if (!conn) {
          skipped++;
          return;
        }
        // 加密密码
        if (conn.password && encKey) {
          conn.password = encryptPassword(conn.password, encKey);
          conn.hasEncryptedPassword = true;
        }
        // 检查是否已存在（按 host+port+username 判断）
        const exists = conns.find((x) => x.host === conn.host && x.port === conn.port && x.username === conn.username);
        if (exists) {
          skipped++;
          return;
        }
        // 生成新ID
        conn.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        conns.push(conn);
        added++;
      });
      if (!saveConns(conns)) {
        sendJson(res, 500, { error: 'save failed' });
        return;
      }
      sendJson(res, 200, { ok: true, added, skipped });
    });
    return;
  }

  // 连接管理（需登录锁通过）
  if (rel === '/connections') {
    if (!authOk(req, parsed)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method === 'GET') {
      const list = loadConns().map((c) => ({
        id: c.id,
        name: c.name,
        host: c.host,
        port: c.port,
        username: c.username,
        group: c.group,
        hasPassword: !!c.password,
        hasKey: !!c.privateKey,
      }));
      sendJson(res, 200, { connections: list });
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        let c;
        try {
          c = JSON.parse(body);
        } catch (e) {
          sendJson(res, 400, { error: 'bad json' });
          return;
        }
        const conn = sanitizeConn(c);
        if (!conn) {
          sendJson(res, 400, { error: 'invalid connection' });
          return;
        }
        // 加密密码
        const encKey = getEncryptionKey();
        if (conn.password && encKey) {
          conn.password = encryptPassword(conn.password, encKey);
          conn.hasEncryptedPassword = true;
        }
        const conns = loadConns();
        if (conn.id) {
          const i = conns.findIndex((x) => x.id === conn.id);
          if (i >= 0) {
            // 编辑时若未填写密码，保留原有密码
            if (!conn.password && conns[i].password) conn.password = conns[i].password;
            // 保留加密标记
            if (conns[i].hasEncryptedPassword && !conn.hasEncryptedPassword) {
              conn.hasEncryptedPassword = conns[i].hasEncryptedPassword;
            }
            conns[i] = Object.assign({}, conns[i], conn);
          } else conns.push(conn);
        } else {
          conn.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          conns.push(conn);
        }
        if (!saveConns(conns)) {
          sendJson(res, 500, { error: 'save failed' });
          return;
        }
        sendJson(res, 200, { ok: true, id: conn.id });
      });
      return;
    }
    if (req.method === 'DELETE') {
      const id = parsed.query.id;
      if (!id) {
        sendJson(res, 400, { error: 'no id' });
        return;
      }
      const conns = loadConns().filter((x) => x.id !== id);
      saveConns(conns);
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

// ---- 静态资源 ----
const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.startsWith(PREFIX + '/api/')) {
      handleApi(req, res);
      return;
    }
    let rel = urlPath.startsWith(PREFIX) ? urlPath.slice(PREFIX.length) : urlPath;
    if (rel === '' || rel === '/') rel = '/index.html';
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(UI_DIR, safe);
    if (!filePath.startsWith(UI_DIR)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500);
    res.end('error');
  }
});

// ---- WebSocket（每连接一个独立 SSH 会话，支持多标签并行）----
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === PREFIX + '/ws' || urlPath === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const userid = req.headers['x-trim-userid'];
  if (!userid) {
    ws.close(1008, 'unauthorized');
    return;
  }

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  // 格式化连接时长
  function formatDuration(ms) {
    if (!ms || ms < 0) return '0秒';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return days + '天' + (hours % 24 > 0 ? ' ' + (hours % 24) + '小时' : '') + (minutes % 60 > 0 ? ' ' + (minutes % 60) + '分' : '');
    }
    if (hours > 0) {
      return hours + '小时' + (minutes % 60 > 0 ? ' ' + (minutes % 60) + '分' : '') + (seconds % 60 > 0 ? ' ' + (seconds % 60) + '秒' : '');
    }
    if (minutes > 0) {
      return minutes + '分' + (seconds % 60 > 0 ? ' ' + (seconds % 60) + '秒' : '');
    }
    return seconds + '秒';
  }
  function getSftp(cb) {
    if (sftpSession) return cb(null, sftpSession);
    if (!sshClient) return cb(new Error('\u672A\u8FDE\u63A5SSH'));
    sshClient.sftp(function (err, sftp) {
      if (err) return cb(err);
      sftpSession = sftp;
      cb(null, sftp);
    });
  }

  let sshClient = null,
    shellStream = null,
    connecting = false,
    retryTimer = null,
    connectStartTime = null,
    sftpSession = null;

  // 全局并发限制：同时最多 4 个 ssh2 客户端
  let activeSshCount = 0;
  const MAX_SSH = 4;

  const cleanup = () => {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (connecting) { connecting = false; activeSshCount = Math.max(0, activeSshCount - 1); }
    if (shellStream) { try { shellStream.end(); } catch (e) {} shellStream = null; }
    if (sftpSession) { try { sftpSession.end(); } catch (e) {} sftpSession = null; }
    if (sshClient) {
      try {
        sshClient.removeAllListeners();
        sshClient.end();
      } catch (e) {}
      sshClient = null;
    }
  };

  const doConnect = (opts) => {
    if (connecting) {
      send({ type: 'error', data: '前一个连接还未完成' });
      return;
    }
    // 先清理上次残留
    cleanup();

    const host = String(opts.host || '').trim();
    const port = Number(opts.port) || 22;
    const sshUser = String(opts.username || '').trim();
    if (!host || port < 1 || port > 65535 || !sshUser) {
      send({ type: 'error', data: '无效的连接参数' });
      return;
    }

    if (activeSshCount >= MAX_SSH) {
      send({ type: 'error', data: '并发连接数已达上限，请稍候再试', retryable: false });
      return;
    }

    connecting = true;
    activeSshCount++;
    const cfg = {
      host,
      port,
      username: sshUser,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 10
    };
    if (opts.password) cfg.password = String(opts.password);
    if (opts.privateKey) cfg.privateKey = String(opts.privateKey);
    const client = new Client();
    sshClient = client;
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      connecting = false;
      activeSshCount = Math.max(0, activeSshCount - 1);
    }
    client.on('ready', () => {
      console.log('[SSH] ready host=' + host + ' user=' + sshUser);
      connectStartTime = Date.now();
      finish();
      client.shell(
        { term: 'xterm-256color', cols: Number(opts.cols) || 80, rows: Number(opts.rows) || 24 },
        (err, stream) => {
          if (err) {
            console.log('[SSH] shell error: ' + err.message);
            send({ type: 'error', data: err.message, retryable: true });
            return;
          }
          shellStream = stream;
          send({ type: 'ready', mode: 'ssh' });
          stream.on('data', (d) => send({ type: 'data', data: d.toString('base64') }));
          stream.stderr.on('data', (d) => send({ type: 'data', data: d.toString('base64') }));
          stream.on('close', () => {
            const duration = connectStartTime ? formatDuration(Date.now() - connectStartTime) : '';
            console.log('[SSH] stream close, duration=' + duration);
            send({ type: 'close', duration });
            connectStartTime = null;
            cleanup();
          });
        }
      );
    });
    client.on('error', (e) => {
      console.log('[SSH] client error: ' + e.message);
      finish();
      send({ type: 'error', data: e.message, retryable: true });
    });
    client.on('close', () => {
      const duration = connectStartTime ? formatDuration(Date.now() - connectStartTime) : '';
      console.log('[SSH] client close, duration=' + duration);
      finish();
      send({ type: 'closed', duration });
      connectStartTime = null;
      if (done) cleanup();
    });
    try {
      console.log('[SSH] connecting to ' + host + ':' + port + ' user=' + sshUser);
      client.connect(cfg);
    } catch (e) {
      console.log('[SSH] connect exception: ' + e.message);
      finish();
      send({ type: 'error', data: e.message, retryable: true });
    }
  };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (msg.type === 'connect') {
      doConnect({
        host: msg.host,
        port: msg.port,
        username: msg.username,
        password: msg.password,
        privateKey: msg.privateKey,
        cols: msg.cols,
        rows: msg.rows,
      });
    } else if (msg.type === 'connectSaved') {
      const conns = loadConns();
      const c = conns.find((x) => x.id === msg.id);
      if (!c) {
        send({ type: 'error', data: '未找到保存的连接' });
        return;
      }
      // 解密密码
      let password = msg.password || c.password || '';
      if (c.hasEncryptedPassword && password.includes(':')) {
        const encKey = getEncryptionKey();
        if (encKey) {
          const decrypted = decryptPassword(password, encKey);
          if (decrypted) password = decrypted;
        }
      }
      doConnect({
        host: c.host,
        port: c.port,
        username: c.username,
        password: password,
        privateKey: c.privateKey,
        cols: msg.cols,
        rows: msg.rows,
      });
    } else if (msg.type === 'data') {
      const buf = Buffer.from(msg.data || '', 'base64');
      if (shellStream) shellStream.write(buf);
    } else if (msg.type === 'resize') {
      if (shellStream) {
        try {
          shellStream.setWindow(Number(msg.rows) || 24, Number(msg.cols) || 80, 0, 0);
        } catch (e) {}
      }
    } else if (msg.type === 'disconnect') {
      cleanup();
    // ---- SFTP ----
    } else if (msg.type === 'sftp-list') {
      if (!sshClient) { send({ type: 'sftp-error', data: '未连接SSH', id: msg.id }); return; }
      getSftp(function (err, sftp) {
        if (err) { send({ type: 'sftp-error', data: err.message, id: msg.id }); return; }
        sftp.readdir(msg.path || '.', function (err, list) {
          if (err) { send({ type: 'sftp-error', data: err.message, id: msg.id }); return; }
          var items = list.map(function (e) {
            return { name: e.filename, size: e.attrs.size, mtime: e.attrs.mtime * 1000, mode: e.attrs.mode, isDir: e.attrs.isDirectory() };
          });
          send({ type: 'sftp-list', id: msg.id, path: msg.path || '.', items: items });
        });
      });
    } else if (msg.type === 'sftp-download') {
      if (!sshClient) { send({ type: 'sftp-error', data: '未连接SSH', id: msg.id }); return; }
      getSftp(function (err, sftp) {
        if (err) { send({ type: 'sftp-error', data: err.message, id: msg.id }); return; }
        var chunks = [];
        sftp.createReadStream(msg.path)
          .on('data', function (d) { chunks.push(d); })
          .on('end', function () { send({ type: 'sftp-download', id: msg.id, path: msg.path, data: Buffer.concat(chunks).toString('base64') }); })
          .on('error', function (e) { send({ type: 'sftp-error', data: e.message, id: msg.id }); });
      });
    } else if (msg.type === 'sftp-upload') {
      if (!sshClient) { send({ type: 'sftp-error', data: '未连接SSH', id: msg.id }); return; }
      getSftp(function (err, sftp) {
        if (err) { send({ type: 'sftp-error', data: err.message, id: msg.id }); return; }
        var buf = Buffer.from(msg.data || '', 'base64');
        var stream = sftp.createWriteStream(msg.path, { flags: 'w' });
        stream.on('close', function () { send({ type: 'sftp-upload', id: msg.id, path: msg.path }); });
        stream.on('error', function (e) { send({ type: 'sftp-error', data: e.message, id: msg.id }); });
        stream.write(buf); stream.end();
      });
    } else if (msg.type === 'sftp-mkdir') {
      if (!sshClient) { send({ type: 'sftp-error', data: '未连接SSH', id: msg.id }); return; }
      getSftp(function (err, sftp) {
        if (err) { send({ type: 'sftp-error', data: err.message, id: msg.id }); return; }
        sftp.mkdir(msg.path, function (e) { send({ type: e ? 'sftp-error' : 'sftp-upload', id: msg.id, data: e ? e.message : 'ok' }); });
      });
    } else if (msg.type === 'sftp-rm') {
      if (!sshClient) { send({ type: 'sftp-error', data: '未连接SSH', id: msg.id }); return; }
      getSftp(function (err, sftp) {
        if (err) { send({ type: 'sftp-error', data: err.message, id: msg.id }); return; }
        sftp.unlink(msg.path, function (e) { send({ type: e ? 'sftp-error' : 'sftp-upload', id: msg.id, data: e ? e.message : 'ok' }); });
      });
    } else if (msg.type === 'sftp-rmdir') {
      if (!sshClient) { send({ type: 'sftp-error', data: '未连接SSH', id: msg.id }); return; }
      getSftp(function (err, sftp) {
        if (err) { send({ type: 'sftp-error', data: err.message, id: msg.id }); return; }
        sftp.rmdir(msg.path, function (e) { send({ type: e ? 'sftp-error' : 'sftp-upload', id: msg.id, data: e ? e.message : 'ok' }); });
      });
    } else if (msg.type === 'sftp-rename') {
      if (!sshClient) { send({ type: 'sftp-error', data: '未连接SSH', id: msg.id }); return; }
      getSftp(function (err, sftp) {
        if (err) { send({ type: 'sftp-error', data: err.message, id: msg.id }); return; }
        sftp.rename(msg.from, msg.to, function (e) { send({ type: e ? 'sftp-error' : 'sftp-upload', id: msg.id, data: e ? e.message : 'ok' }); });
      });
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

try {
  fs.unlinkSync(SOCK_PATH);
} catch (e) {}
server.listen(SOCK_PATH, () => {
  console.log('[sshx] listening on', SOCK_PATH);
});
server.on('error', (e) => {
  console.error('[sshx] server error', e);
  process.exit(1);
});
