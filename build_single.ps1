$ErrorActionPreference='Stop'
$ui = Join-Path $PSScriptRoot 'app/ui'
$utf8nb = New-Object System.Text.UTF8Encoding($false)

# 读取模板（含中文骨架），UTF-8 无 BOM
$tmpl = [System.IO.File]::ReadAllText((Join-Path $ui 'template.html'), $utf8nb)

# xterm.umd.js 末尾 sourceMappingURL 注释里有字面 </script>，
# 直接内联会让浏览器提前闭合 <script>，必须转义为 <\/script>。
# JS 引擎里 '\/' === '/'，等价无副作用。
function Esc-Script([string]$s){ return $s.Replace('</script>','<\/script>') }
function Esc-Style([string]$s) { return $s.Replace('</style>', '<\/style>') }

$xterm    = Esc-Script ([System.IO.File]::ReadAllText((Join-Path $ui 'lib/xterm.umd.js'), $utf8nb))
$fit      = Esc-Script ([System.IO.File]::ReadAllText((Join-Path $ui 'lib/fit.umd.js'), $utf8nb))
$app      = Esc-Script ([System.IO.File]::ReadAllText((Join-Path $ui 'app.js'), $utf8nb))
$xtermCss = Esc-Style  ([System.IO.File]::ReadAllText((Join-Path $ui 'lib/xterm.css'), $utf8nb))
$css      = Esc-Style  ([System.IO.File]::ReadAllText((Join-Path $ui 'style.css'), $utf8nb))

$html = $tmpl.Replace('{{XTERM_CSS}}', $xtermCss).Replace('{{CSS}}', $css).Replace('{{XTERM}}', $xterm).Replace('{{FIT}}', $fit).Replace('{{APP}}', $app)

[System.IO.File]::WriteAllText((Join-Path $ui 'index.html'), $html, $utf8nb)

# 诊断
$rawClose = ([regex]::Matches($html, '</script>')).Count
$escClose = ([regex]::Matches($html, '<\\/script>')).Count
$rawStyle = ([regex]::Matches($html, '</style>')).Count
$escStyle = ([regex]::Matches($html, '<\\/style>')).Count
Write-Output ("单文件生成: 字节={0}  裸 </script>={1}  转义 <\/script>={2}  裸 </style>={3}  转义 <\/style>={4}" -f $html.Length,$rawClose,$escClose,$rawStyle,$escStyle)
Write-Output ("前4字节 (期望 3C 21 44 4F = <!DO): {0}" -f (([byte[]][char[]]$html.Substring(0,4) | ForEach-Object {'{0:X2}' -f $_}) -join ' '))
$probes = @('id="sidebar"','id="brand"','id="logoutBtn"','id="addConnBtn"','id="connectBtn"','id="terminals"','id="connModal"','id="diag"')
foreach($p in $probes){ Write-Output ("  $p : {0}" -f ($html -match [regex]::Escape($p))) }