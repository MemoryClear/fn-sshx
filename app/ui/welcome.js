// 欢迎页内容（终端渲染），与 app.js 解耦，便于维护
window.renderWelcome = function (term) {
  var C = {
    title: '\x1b[1;32m',   // 亮绿
    key: '\x1b[36m',        // 青蓝
    hint: '\x1b[33m',       // 黄
    reset: '\x1b[0m'
  };
  term.writeln(C.title + '=== SSHX 终端 ===' + C.reset);
  term.writeln('');
  term.writeln('  ' + C.key + '快速连接' + C.reset + ':填写上方主机/端口/用户名/密码,点击「快速链接」');
  term.writeln('  ' + C.key + '连接管理' + C.reset + ':解锁后点击左侧列表打开已保存连接');
  term.writeln('  ' + C.key + '新增连接' + C.reset + ':解锁后点击左下角「+ 新增连接」保存');
  term.writeln('');
  term.writeln('  ' + C.hint + '提示:右键连接可删除' + C.reset);
};
