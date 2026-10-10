<p align="center">
  <img src="images/icon.png" width="128" height="128" alt="Unreal MCP Status logo">
</p>

# Unreal MCP Status

A small status bar indicator that tells you at a glance whether the **Unreal Editor MCP server** is reachable, so you know when AI assistants and other MCP clients (Claude Code, Copilot, Cursor…) can control the editor.

## States

| Indicator | Meaning |
| --- | --- |
| 🟢 **Unreal** | The MCP server answers. Clients can talk to the editor. |
| 🟡 **Unreal** | Unreal Editor is running but the MCP server does not answer yet, or another program holds the port. |
| 🔴 **Unreal** | Unreal Editor is not running. |

Hover over the indicator for details. Click it to check right away. When the server is not answering, the notification has a **Copy command** button that copies `ModelContextProtocol.StartServer` so you can paste it into the Unreal console.

## How it works

Every few seconds the extension sends an MCP `ping` (JSON-RPC over HTTP) to the configured address. A `ping` needs no session, so polling does not leave sessions open in the editor. If nothing answers, it checks whether an `UnrealEditor` process is running to tell "editor closed" apart from "server not started".

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `unrealMcpStatus.url` | `http://127.0.0.1:8000/mcp` | Address of the Unreal Editor MCP server. |
| `unrealMcpStatus.intervalSeconds` | `3` | How often to check the connection, in seconds. |

## Commands

- **Unreal MCP: Check connection** (`unrealMcpStatus.refresh`) checks now and shows the result.

## Requirements

- Unreal Engine 5 with an MCP server plugin listening over HTTP.
- Windows, macOS or Linux. Process detection uses `tasklist` on Windows and `pgrep` elsewhere.

The extension runs on your local machine (UI side) even in remote workspaces, because the editor and its MCP server run locally.

## Languages

English and Polish. The extension follows the display language of your editor.

## License

[MIT](LICENSE)
