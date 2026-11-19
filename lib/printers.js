const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

// JSON avoids PowerShell's table/list formatting, line wrapping and localized headings.
const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$items = @(Get-CimInstance Win32_Printer | ForEach-Object {
  [PSCustomObject]@{ name = [string]$_.Name; isDefault = [bool]$_.Default }
})
ConvertTo-Json -InputObject $items -Compress
`;

function parsePrinters(output) {
  const text = String(output || '').replace(/^\uFEFF/, '').trim();
  const parsed = text ? JSON.parse(text) : [];
  const rows = Array.isArray(parsed) ? parsed : parsed === null ? [] : [parsed];
  if (rows.some(p => !p || typeof p.name !== 'string' || !p.name.trim() || typeof p.isDefault !== 'boolean')) throw new Error('Windows 打印机数据格式无效');
  return {
    printers: rows.map(p => ({ name: p.name })),
    defaultPrinter: rows.find(p => p.isDefault)?.name || ''
  };
}

async function listPrinters() {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024
  });
  return parsePrinters(stdout);
}

module.exports = { listPrinters, parsePrinters };
