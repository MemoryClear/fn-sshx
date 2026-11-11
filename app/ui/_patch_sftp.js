const fs = require('fs');
let c = fs.readFileSync('app.js', 'utf8');

// 1. Replace `var term = new Terminal(...)` through `tabs[id] = { term: term, ... fitAddon: fitAddon };`
// with conditional terminal creation + updated tabs data structure

const marker1 = '    var term = new Terminal({';
const marker2 = '    tabs[id] = { term: term, termDiv: termDiv, ws: null, conn: conn, label: label, isWelcome: !!isWelcome, fitAddon: fitAddon };';

const idx1 = c.indexOf(marker1);
const idx2 = c.indexOf(marker2);
if (idx1 < 0 || idx2 < 0) {
  console.error('Could not find markers', idx1, idx2);
  process.exit(1);
}

const newBlock = `    var term = null;
    var fitAddon = null;

    if (!isSftp && !isWelcome) {
      term = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'Consolas, "Courier New", monospace', theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#aaaaaa' }, allowProposedApi: true });
      term.open(termDiv);` +
      // Find the attachCustomKeyEventHandler block
      c.substring(c.indexOf('    // 拦截 R 键重连', idx1), c.indexOf('    tabs[id] = {', idx1)) +
      `    }
    tabs[id] = { term: term, termDiv: termDiv, ws: null, conn: conn, label: label, isWelcome: !!isWelcome, isSftp: !!isSftp, fitAddon: fitAddon };`;

c = c.substring(0, idx1) + newBlock + c.substring(idx2 + marker2.length);

// 2. Add right-click menu handler after the tab click handler
const clickMarker = `    div.onclick = function () {
      diag('[click] tab=' + id + ' exists=' + !!tabs[id]);
      if (tabs[id]) activateTab(id);
      else diag('[click] \u5ffd\u7565: tab\u5df2\u5173\u95ed');
    };`;

const clickIdx = c.indexOf(clickMarker);
if (clickIdx < 0) {
  // Try without unicode escapes
  const clickMarker2 = '    div.onclick = function () {\n      diag(\'[click] tab=\' + id + \' exists=\' + !!tabs[id]);\n      if (tabs[id]) activateTab(id);\n      else diag(\'[click]';
  const clickIdx2 = c.indexOf(clickMarker2);
  console.log('clickMarker2 found at:', clickIdx2);
  if (clickIdx2 >= 0) {
    // Find end of this function
    const endOfClick = c.indexOf('    };', clickIdx2);
    const afterClick = endOfClick + 6; // past "    };\n"
    const rightClickHandler = `

    // 标签右键菜单
    if (!isWelcome) {
      div.oncontextmenu = function (e) {
        e.preventDefault();
        e.stopPropagation();
        var m = el('tabCtxMenu');
        var sftpItem = el('tabCtxSftp');
        sftpItem.style.display = tabs[id] && tabs[id].isSftp ? 'none' : '';
        m._tabId = id;
        m.style.display = 'block';
        m.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
        m.style.top = Math.min(e.clientY, window.innerHeight - 80) + 'px';
      };
    }`;
    c = c.substring(0, afterClick) + rightClickHandler + c.substring(afterClick);
  }
} else {
  const afterClick = clickIdx + clickMarker.length;
  const rightClickHandler = `

    // 标签右键菜单
    if (!isWelcome) {
      div.oncontextmenu = function (e) {
        e.preventDefault();
        e.stopPropagation();
        var m = el('tabCtxMenu');
        var sftpItem = el('tabCtxSftp');
        sftpItem.style.display = tabs[id] && tabs[id].isSftp ? 'none' : '';
        m._tabId = id;
        m.style.display = 'block';
        m.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
        m.style.top = Math.min(e.clientY, window.innerHeight - 80) + 'px';
      };
    }`;
  c = c.substring(0, afterClick) + rightClickHandler + c.substring(afterClick);
}

// 3. Add SFTP tab init before `if (isWelcome) {`
const welcomeMarker = '    if (isWelcome) {\n      if (typeof renderWelcome';
const welcomeIdx = c.indexOf(welcomeMarker);
if (welcomeIdx < 0) {
  console.error('Could not find welcome marker');
  process.exit(1);
}

const sftpInitBlock = `    if (isSftp) {
      // SFTP 标签：创建文件浏览器
      initSftpTab(id, conn);
      activateTab(id);
      return;
    }

`;
c = c.substring(0, welcomeIdx) + sftpInitBlock + c.substring(welcomeIdx);

fs.writeFileSync('app.js', c, 'utf8');
console.log('Patched newTab() successfully');
