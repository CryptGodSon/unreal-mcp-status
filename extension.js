// Status bar indicator for the Unreal Editor MCP server.
// Green: MCP server answers and offers tools. Yellow: something is off (editor
// still starting, no tools, wrong project, another program on the port).
// Red: Unreal Editor is not running.
const vscode = require('vscode');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');

const GREEN = '#3fb950';
const YELLOW = '#d29922';
const RED = '#f85149';
const EPIC_START_COMMAND = 'ModelContextProtocol.StartServer';
const PROTOCOL_VERSION = '2025-06-18';
const TOOLTIP_COMMANDS = ['unrealMcpStatus.refresh', 'unrealMcpStatus.copyStartCommand', 'unrealMcpStatus.chooseServer', 'unrealMcpStatus.openSettings'];
// UE5 ships UnrealEditor, UE4 shipped UE4Editor.
const EDITOR_PROCESSES = ['UnrealEditor', 'UE4Editor'];
const t = vscode.l10n.t;

// Ready-made settings for the MCP plugins people use with different engine versions.
// Plugins that bridge to Unreal over a raw TCP socket get a tcp:// address.
const PRESETS = [
  { label: "Epic's Unreal MCP plugin", description: 'UE 5.8+', url: 'http://127.0.0.1:8000/mcp', startCommand: EPIC_START_COMMAND },
  { label: 'UnrealMCP plugin (chongdashu/unreal-mcp and forks)', description: 'UE 5.5+ · TCP 55557', url: 'tcp://127.0.0.1:55557', startCommand: '' },
  { label: 'UnrealMCP plugin (kvick-games)', description: 'TCP 13377', url: 'tcp://127.0.0.1:13377', startCommand: '' },
];

let item;
let timer;
let checking = null;
let last = null;
let clicking = false;
let extensionVersion = '0.0.0';
// Result of the deep check (handshake, tool list, open project). It runs when the
// server comes up and on demand, not on every poll, because each run opens a session.
let verified = null;

function config() {
  const cfg = vscode.workspace.getConfiguration('unrealMcpStatus');
  return {
    url: cfg.get('url', 'http://127.0.0.1:8000/mcp'),
    startCommand: cfg.get('startCommand', EPIC_START_COMMAND).trim(),
    intervalMs: Math.max(1, cfg.get('intervalSeconds', 3)) * 1000,
    pauseWhenUnfocused: cfg.get('pauseWhenUnfocused', true),
    notifyOnChange: cfg.get('notifyOnChange', false),
    verifyTools: cfg.get('verifyTools', true),
    checkProject: cfg.get('checkProject', true),
  };
}

function parseUrl(url) {
  try { return new URL(url); } catch { return null; }
}

// Resolves to `fallback` if `promise` has not settled within `ms`, so a hung
// request can never freeze the indicator on its last state.
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

function isJsonRpc(json) {
  return Boolean(json) && typeof json === 'object' && json.jsonrpc === '2.0';
}

// The body is plain JSON or, when the server picks the streaming transport,
// server-sent events whose `data:` lines carry the JSON-RPC messages.
function parseMessages(data) {
  try {
    const json = JSON.parse(data);
    return (Array.isArray(json) ? json : [json]).filter(isJsonRpc);
  } catch {
    const messages = [];
    for (const line of data.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        const json = JSON.parse(line.slice(5));
        if (isJsonRpc(json)) messages.push(json);
      } catch { /* try the next line */ }
    }
    return messages;
  }
}

// One HTTP exchange with an MCP endpoint. Resolves `{ ok: false }` on network
// failure, otherwise the status, headers, raw body and parsed JSON-RPC messages.
// An SSE stream may stay open after the reply, so it resolves as soon as the
// message answering `payload.id` has arrived.
function request(url, { method = 'POST', payload, headers = {}, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let data = '';
    let res = null;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    const finish = () => done({ ok: true, status: res.statusCode, headers: res.headers, data, messages: parseMessages(data) });
    const body = payload === undefined ? '' : JSON.stringify(payload);
    let req;
    try {
      const lib = url.startsWith('https:') ? https : http;
      req = lib.request(url, {
        method,
        agent: false, // fresh socket every time: a reused keep-alive socket can hang after Unreal exits
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          'Connection': 'close',
          ...headers,
        },
      }, (response) => {
        res = response;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          if (payload && payload.id !== undefined && parseMessages(data).some((m) => m.id === payload.id)) {
            finish();
            req.destroy();
          }
        });
        res.on('error', () => done({ ok: false }));
        res.on('close', finish);
      });
    } catch {
      done({ ok: false });
      return;
    }
    req.on('timeout', () => { req.destroy(); done({ ok: false }); });
    req.on('error', () => done({ ok: false }));
    req.end(body);
  });
}

function reply(result, id) {
  return result.ok ? result.messages.find((m) => m.id === id) || null : null;
}

// MCP "ping" needs no session, so polling does not leave sessions open in the editor.
// Any JSON-RPC reply counts as reachable: servers that insist on a session answer
// the ping with a JSON-RPC error, which still proves an MCP server is listening.
// The deep check below then confirms that it really works.
async function pingMcp(url) {
  const result = await request(url, { payload: { jsonrpc: '2.0', id: 1, method: 'ping' } });
  if (!result.ok) return 'down';
  if (result.messages.length > 0) return 'ok';
  return result.data ? 'foreign' : 'down';
}

// Plugins with a TCP bridge speak their own protocol, so an accepted connection is
// the only signal; the socket closes right away without sending anything.
function connectTcp(parsed) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: parsed.hostname.replace(/^\[|\]$/g, ''), port: Number(parsed.port) });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve('ok'); });
    socket.once('timeout', () => { socket.destroy(); resolve('down'); });
    socket.once('error', () => resolve('down'));
  });
}

function errorText(message, result) {
  if (message && message.error && message.error.message) return message.error.message;
  return result.ok ? `HTTP ${result.status}` : t('no response');
}

// Does what an AI client does when it connects: initialize, list the tools, and
// end the session again, so the light only turns green for a server that works.
async function verifyMcp(url) {
  const init = await request(url, {
    timeoutMs: 5000,
    payload: { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'unreal-mcp-status', version: extensionVersion } } },
  });
  if (!init.ok) return { status: 'unreachable' };
  const initReply = reply(init, 1);
  if (!initReply || !initReply.result) return { status: 'failed', reason: errorText(initReply, init) };

  const session = init.headers['mcp-session-id'];
  const headers = {};
  if (session) headers['Mcp-Session-Id'] = session;
  if (initReply.result.protocolVersion) headers['MCP-Protocol-Version'] = initReply.result.protocolVersion;
  try {
    await request(url, { headers, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    let tools = 0;
    let cursor;
    for (let page = 0; page < 20; page++) {
      const id = 2 + page;
      const list = await request(url, { headers, timeoutMs: 5000,
        payload: { jsonrpc: '2.0', id, method: 'tools/list', params: cursor ? { cursor } : {} } });
      const listReply = reply(list, id);
      if (!listReply || !listReply.result || !Array.isArray(listReply.result.tools)) {
        return { status: 'failed', reason: errorText(listReply, list) };
      }
      tools += listReply.result.tools.length;
      cursor = listReply.result.nextCursor;
      if (!cursor) break;
    }
    const info = initReply.result.serverInfo || {};
    return { status: 'ok', tools, server: [info.title || info.name, info.version].filter(Boolean).join(' ') };
  } finally {
    if (session) request(url, { method: 'DELETE', headers });
  }
}

function isUnrealRunning() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        resolve(!err && new RegExp(`^"(${EDITOR_PROCESSES.join('|')})\\.exe"`, 'im').test(stdout));
      });
    } else {
      // pgrep exits with 0 only when a matching process exists.
      execFile('pgrep', ['-x', EDITOR_PROCESSES.join('|')], { timeout: 3000 }, (err) => resolve(!err));
    }
  });
}

// The .uproject files that running editors were started with, read from their
// command lines. Resolves null when that cannot be determined.
function editorProjects() {
  return new Promise((resolve) => {
    const parse = (err, stdout) => {
      if (err) { resolve(null); return; }
      const projects = new Set();
      for (const match of stdout.matchAll(/([^"\s]+\.uproject|"[^"]+\.uproject")/gi)) {
        projects.add(path.basename(match[1].replace(/"/g, ''), '.uproject'));
      }
      resolve([...projects]);
    };
    if (process.platform === 'win32') {
      const filter = EDITOR_PROCESSES.map((p) => `Name='${p}.exe'`).join(' OR ');
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { $_.CommandLine }`],
      { windowsHide: true, timeout: 8000 }, parse);
    } else {
      execFile('ps', ['-ax', '-o', 'args='], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        const lines = err ? '' : stdout.split('\n').filter((l) => EDITOR_PROCESSES.some((p) => l.includes(p))).join('\n');
        parse(err, lines);
      });
    }
  });
}

async function workspaceProjects() {
  const files = await vscode.workspace.findFiles('*.uproject', undefined, 10);
  return files.map((f) => path.basename(f.fsPath, '.uproject'));
}

async function deepCheck(url, tcp) {
  const { verifyTools, checkProject } = config();
  const [mcp, open, own] = await Promise.all([
    verifyTools && !tcp ? verifyMcp(url) : null,
    checkProject ? withTimeout(editorProjects(), 9000, null) : null,
    checkProject ? workspaceProjects().catch(() => []) : [],
  ]);
  return { url, mcp, open, own };
}

function okState(url, tcp, v) {
  const lines = [];
  const { mcp, open, own } = v;
  if (mcp && mcp.status === 'failed') {
    return { state: 'handshake', color: YELLOW, icon: '$(warning)', title: t('MCP answers, but the handshake failed'),
      detail: t('Something at {0} answers ping, but connecting like an AI client failed: {1}', url, mcp.reason) };
  }
  if (mcp && mcp.status === 'ok' && mcp.tools === 0) {
    return { state: 'notools', color: YELLOW, icon: '$(warning)', title: t('Connected, but no tools are available'),
      detail: t('The MCP server at {0} offers no tools, so the AI cannot do anything in the editor. Check that the toolset plugins (for example EditorToolset) are enabled.', url) };
  }
  if (open && open.length > 0 && own.length > 0) {
    const same = (a, b) => a.toLowerCase() === b.toLowerCase();
    if (!own.some((p) => open.some((o) => same(o, p)))) {
      return { state: 'otherproject', color: YELLOW, icon: '$(warning)', title: t('Unreal has a different project open'),
        detail: t('Unreal has {0} open, but this workspace contains {1}. The AI would change the other project.', open.join(', '), own.join(', ')) };
    }
  }
  if (tcp) lines.push(t('The MCP plugin accepts connections at {0}.', url));
  else lines.push(t('The server responds at {0}.', url));
  if (mcp && mcp.status === 'ok') {
    lines.push(mcp.server ? t('{0} offers {1} tools.', mcp.server, mcp.tools) : t('The server offers {0} tools.', mcp.tools));
  } else if (tcp) {
    lines.push(t('For TCP plugins only the connection is checked; the tool list is not read.'));
  }
  if (open && open.length > 0) lines.push(t('Project: {0}', open.join(', ')));
  return { state: 'ok', color: GREEN, icon: '$(pass-filled)', title: t('Connected'), detail: lines.join(' ') };
}

async function probe(force) {
  const { url, startCommand } = config();
  const parsed = parseUrl(url);
  const tcp = parsed !== null && parsed.protocol === 'tcp:';
  const mcp = await withTimeout(tcp ? connectTcp(parsed) : pingMcp(url), 2500, 'down');
  if (mcp === 'ok') {
    if (force || !verified || verified.url !== url) {
      const v = await deepCheck(url, tcp);
      // A server that vanished mid-check is retried on the next poll instead of being cached.
      verified = v.mcp && v.mcp.status === 'unreachable' ? null : v;
      if (!verified) return okState(url, tcp, { ...v, mcp: null });
    }
    return okState(url, tcp, verified);
  }
  verified = null;
  if (mcp === 'foreign') {
    return { state: 'foreign', color: YELLOW, icon: '$(warning)', title: t('Port is used by another program'),
      detail: t('Something that is not the Unreal MCP server responds at {0}. Close that program or change the port.', url) };
  }
  const unreal = await withTimeout(isUnrealRunning(), 3500, false);
  if (unreal) {
    return { state: 'noserver', color: YELLOW, icon: '$(warning)', title: t('Unreal is running, but MCP does not respond'),
      detail: startCommand ? t('The editor may still be starting. If this takes longer, run this in the Unreal console: {0}', startCommand)
        : t('The editor may still be starting. If this takes longer, check that the MCP plugin is enabled and its server is running at {0}.', url) };
  }
  return { state: 'off', color: RED, icon: '$(error)', title: t('Unreal Editor is not running'),
    detail: startCommand ? t('Open your Unreal project. If the MCP server does not start by itself, run this in the Unreal console: {0}', startCommand)
      : t('Open your Unreal project.') };
}

function tooltip(s) {
  const links = [`[$(refresh) ${t('Check now')}](command:unrealMcpStatus.refresh)`];
  if (s.state !== 'ok' && config().startCommand) links.push(`[$(copy) ${t('Copy start command')}](command:unrealMcpStatus.copyStartCommand)`);
  links.push(`[$(server) ${t('Choose server')}](command:unrealMcpStatus.chooseServer)`);
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
// `force` reruns the deep check even if the server has been up all along.
function check(force = false) {
  if (!checking) {
    checking = probe(force)
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
  const { startCommand } = config();
  if (!startCommand) {
    vscode.window.showInformationMessage(t('No start command is set for this MCP server. You can add one in the unrealMcpStatus.startCommand setting.'));
    return;
  }
  await vscode.env.clipboard.writeText(startCommand);
  vscode.window.showInformationMessage(t('Copied: {0}', startCommand));
}

function validateAddress(value) {
  const parsed = parseUrl(value.trim());
  if (!parsed || !['http:', 'https:', 'tcp:'].includes(parsed.protocol)) return t('Use an http://, https:// or tcp:// address.');
  if (parsed.protocol === 'tcp:' && !parsed.port) return t('A tcp:// address needs a port, for example tcp://127.0.0.1:55557.');
  return null;
}

async function chooseServer() {
  const { url, startCommand } = config();
  const custom = { label: t('Custom address…'), description: t('Any MCP server over http, https or tcp') };
  const picks = PRESETS.map((p) => ({ ...p, detail: p.url, picked: p.url === url }));
  const choice = await vscode.window.showQuickPick([...picks, custom], { placeHolder: t('Which MCP server does your Unreal project use?') });
  if (!choice) return;
  let next = choice;
  if (choice === custom) {
    const address = await vscode.window.showInputBox({
      prompt: t('Address of the MCP server, for example http://127.0.0.1:8000/mcp or tcp://127.0.0.1:55557'),
      value: url, validateInput: validateAddress,
    });
    if (address === undefined) return;
    const command = await vscode.window.showInputBox({
      prompt: t('Unreal console command that starts the server (leave empty if there is none)'),
      value: startCommand,
    });
    if (command === undefined) return;
    next = { url: address.trim(), startCommand: command.trim() };
  }
  const cfg = vscode.workspace.getConfiguration('unrealMcpStatus');
  await cfg.update('url', next.url, vscode.ConfigurationTarget.Global);
  await cfg.update('startCommand', next.startCommand, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(t('Unreal MCP Status now checks {0}.', next.url));
}

async function onClick() {
  clicking = true;
  try {
    item.text = '$(sync~spin) Unreal';
    await check(true);
  } finally {
    clicking = false;
  }
  const s = last;
  const show = s.state === 'ok' ? vscode.window.showInformationMessage
    : s.state === 'off' ? vscode.window.showErrorMessage
    : vscode.window.showWarningMessage;
  const copy = t('Copy command');
  const actions = (s.state === 'noserver' || s.state === 'off') && config().startCommand ? [copy] : [];
  const choice = await show(`Unreal MCP — ${s.title}. ${s.detail}`, ...actions);
  if (choice === copy) await copyStartCommand();
}

function restartTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, config().intervalMs);
}

function activate(context) {
  extensionVersion = (context.extension && context.extension.packageJSON.version) || extensionVersion;
  item = vscode.window.createStatusBarItem('unrealMcpStatus', vscode.StatusBarAlignment.Right, 1000);
  item.name = 'Unreal MCP Status';
  item.command = 'unrealMcpStatus.refresh';
  item.text = '$(sync~spin) Unreal';
  item.show();

  context.subscriptions.push(
    item,
    vscode.commands.registerCommand('unrealMcpStatus.refresh', onClick),
    vscode.commands.registerCommand('unrealMcpStatus.copyStartCommand', copyStartCommand),
    vscode.commands.registerCommand('unrealMcpStatus.chooseServer', chooseServer),
    vscode.commands.registerCommand('unrealMcpStatus.openSettings',
      () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:montemr.unreal-mcp-status')),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('unrealMcpStatus')) { restartTimer(); check(true); }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => check(true)),
    vscode.window.onDidChangeWindowState((e) => { if (e.focused) check(); }),
    { dispose: () => clearInterval(timer) },
  );

  check();
  restartTimer();
}

function deactivate() {}

module.exports = { activate, deactivate };
