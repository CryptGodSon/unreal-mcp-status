// Status bar indicator for the Unreal Editor MCP server.
// Green: MCP server answers. Yellow: Unreal is running but MCP does not answer
// (or another program holds the port). Red: Unreal Editor is not running.
const vscode = require('vscode');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');

const GREEN = '#3fb950';
const YELLOW = '#d29922';
const RED = '#f85149';
const START_COMMAND = 'ModelContextProtocol.StartServer';
const TOOLTIP_COMMANDS = ['unrealMcpStatus.refresh', 'unrealMcpStatus.copyStartCommand', 'unrealMcpStatus.openSettings'];
const t = vscode.l10n.t;

let item;
let timer;
let checking = null;
let last = null;
let clicking = false;

function config() {
  const cfg = vscode.workspace.getConfiguration('unrealMcpStatus');
  return {
    url: cfg.get('url', 'http://127.0.0.1:8000/mcp'),
    intervalMs: Math.max(1, cfg.get('intervalSeconds', 3)) * 1000,
    pauseWhenUnfocused: cfg.get('pauseWhenUnfocused', true),
    notifyOnChange: cfg.get('notifyOnChange', false),
  };
}

// Resolves to `fallback` if `promise` has not settled within `ms`, so a hung
// request can never freeze the indicator on its last state.
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

// The body is plain JSON or, when the server picks the streaming transport,
// server-sent events whose `data:` lines carry the JSON-RPC message.
function parseJsonRpc(data) {
  try {
    return JSON.parse(data);
  } catch {
    for (const line of data.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try { return JSON.parse(line.slice(5)); } catch { /* try the next line */ }
    }
    return null;
  }
}

function isJsonRpc(json) {
  return Boolean(json) && json.jsonrpc === '2.0';
}

// MCP "ping" needs no session, so polling does not leave sessions open in the editor.
// Any JSON-RPC reply counts as reachable: servers that insist on a session answer
// the ping with a JSON-RPC error, which still proves an MCP server is listening.
function pingMcp(url) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    let req;
    try {
      const lib = url.startsWith('https:') ? https : http;
      req = lib.request(url, {
        method: 'POST',
        agent: false, // fresh socket every time: a reused keep-alive socket can hang after Unreal exits
        timeout: 1500,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          'Connection': 'close',
        },
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          // An SSE stream may stay open after the reply; stop as soon as it has arrived.
          if (isJsonRpc(parseJsonRpc(data))) { done('ok'); req.destroy(); }
        });
        res.on('error', () => done('down'));
        res.on('close', () => done(isJsonRpc(parseJsonRpc(data)) ? 'ok' : data ? 'foreign' : 'down'));
      });
    } catch {
      done('down');
      return;
    }
    req.on('timeout', () => { req.destroy(); done('down'); });
    req.on('error', () => done('down'));
    req.end(body);
  });
}

function isUnrealRunning() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', 'IMAGENAME eq UnrealEditor.exe', '/NH'], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
        resolve(!err && /UnrealEditor\.exe/i.test(stdout));
      });
    } else {
      // pgrep exits with 0 only when a matching process exists.
      execFile('pgrep', ['-x', 'UnrealEditor'], { timeout: 3000 }, (err) => resolve(!err));
    }
  });
}

async function probe() {
  const { url } = config();
  const mcp = await withTimeout(pingMcp(url), 2500, 'down');
  if (mcp === 'ok') {
    return { state: 'ok', color: GREEN, icon: '$(pass-filled)', title: t('Connected'),
      detail: t('The server responds at {0}. MCP clients can control the editor.', url) };
  }
  if (mcp === 'foreign') {
    return { state: 'foreign', color: YELLOW, icon: '$(warning)', title: t('Port is used by another program'),
      detail: t('Something that is not the Unreal MCP server responds at {0}. Close that program or change the port.', url) };
  }
  const unreal = await withTimeout(isUnrealRunning(), 3500, false);
  if (unreal) {
    return { state: 'noserver', color: YELLOW, icon: '$(warning)', title: t('Unreal is running, but MCP does not respond'),
      detail: t('The editor may still be starting. If this takes longer, run this in the Unreal console: {0}', START_COMMAND) };
  }
  return { state: 'off', color: RED, icon: '$(error)', title: t('Unreal Editor is not running'),
    detail: t('Open your Unreal project. If the MCP server does not start by itself, run this in the Unreal console: {0}', START_COMMAND) };
}

function tooltip(s) {
  const links = [`[$(refresh) ${t('Check now')}](command:unrealMcpStatus.refresh)`];
  if (s.state !== 'ok') links.push(`[$(copy) ${t('Copy start command')}](command:unrealMcpStatus.copyStartCommand)`);
  links.push(`[$(gear) ${t('Settings')}](command:unrealMcpStatus.openSettings)`);
  const md = new vscode.MarkdownString(`**${s.title}**\n\n${s.detail}\n\n${links.join(' &nbsp;·&nbsp; ')}`, true);
  md.isTrusted = { enabledCommands: TOOLTIP_COMMANDS };
  return md;
}

// Tells the user when the state changes while they are not looking at the indicator.
function notifyChange(prev, s) {
  if (clicking || !prev || !prev.state || prev.state === s.state || !config().notifyOnChange) return;
  const show = s.state === 'ok' ? vscode.window.showInformationMessage : vscode.window.showWarningMessage;
  show(`Unreal MCP — ${s.title}`);
}

function render(s) {
  const prev = last;
  last = s;
  item.text = `${s.icon} Unreal`;
  item.color = s.color;
  item.tooltip = tooltip(s);
  notifyChange(prev, s);
}

// Several callers (timer, click, settings change) share one in-flight check.
function check() {
  if (!checking) {
    checking = probe()
      .then(render)
      .catch(() => render({ color: RED, icon: '$(error)', title: t('Check failed'), detail: t('Could not check the server state.') }))
      .finally(() => { checking = null; });
  }
  return checking;
}

// Background polling skips checks while the window is in the background: every ping
// writes a line to the Unreal Output Log, and nobody is looking at the indicator then.
function tick() {
  if (config().pauseWhenUnfocused && !vscode.window.state.focused) return;
  check();
}

async function copyStartCommand() {
  await vscode.env.clipboard.writeText(START_COMMAND);
  vscode.window.showInformationMessage(t('Copied: {0}', START_COMMAND));
}

async function onClick() {
  clicking = true;
  try {
    item.text = '$(sync~spin) Unreal';
    await check();
  } finally {
    clicking = false;
  }
  const s = last;
  const show = s.state === 'ok' ? vscode.window.showInformationMessage
    : s.state === 'off' ? vscode.window.showErrorMessage
    : vscode.window.showWarningMessage;
  const copy = t('Copy command');
  const actions = s.state === 'noserver' || s.state === 'off' ? [copy] : [];
  const choice = await show(`Unreal MCP — ${s.title}. ${s.detail}`, ...actions);
  if (choice === copy) await copyStartCommand();
}

function restartTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, config().intervalMs);
}

function activate(context) {
  item = vscode.window.createStatusBarItem('unrealMcpStatus', vscode.StatusBarAlignment.Right, 1000);
  item.name = 'Unreal MCP Status';
  item.command = 'unrealMcpStatus.refresh';
  item.text = '$(sync~spin) Unreal';
  item.show();

  context.subscriptions.push(
    item,
    vscode.commands.registerCommand('unrealMcpStatus.refresh', onClick),
    vscode.commands.registerCommand('unrealMcpStatus.copyStartCommand', copyStartCommand),
    vscode.commands.registerCommand('unrealMcpStatus.openSettings',
      () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:montemr.unreal-mcp-status')),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('unrealMcpStatus')) { restartTimer(); check(); }
    }),
    vscode.window.onDidChangeWindowState((e) => { if (e.focused) check(); }),
    { dispose: () => clearInterval(timer) },
  );

  check();
  restartTimer();
}

function deactivate() {}

module.exports = { activate, deactivate };
