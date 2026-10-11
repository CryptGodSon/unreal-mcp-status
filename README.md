<p align="center">
  <img src="images/icon.png" width="128" height="128" alt="Unreal MCP Status logo">
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=montemr.unreal-mcp-status"><img src="https://img.shields.io/visual-studio-marketplace/v/montemr.unreal-mcp-status?label=VS%20Code%20Marketplace&logo=visualstudiocode" alt="VS Code Marketplace"></a>
  <a href="https://open-vsx.org/extension/montemr/unreal-mcp-status"><img src="https://img.shields.io/open-vsx/v/montemr/unreal-mcp-status?label=Open%20VSX" alt="Open VSX"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=montemr.unreal-mcp-status"><img src="https://img.shields.io/visual-studio-marketplace/i/montemr.unreal-mcp-status?label=installs" alt="Installs"></a>
</p>

# Unreal MCP Status

**Know whether your AI assistant can reach the Unreal Editor before you ask it to do something.**

Claude Code, Cursor, Copilot and other MCP clients control Unreal Engine through an MCP server running inside the editor. When that server is not reachable, the agent rarely says so clearly: tool calls time out, it gives up, or it tries a workaround. This extension puts one light in your status bar that tells you whether the connection works and, if it does not, why.

## Highlights

- **One glance.** Green, yellow or red in the status bar, checked every 3 seconds.
- **Tells you why.** It tells apart "editor is closed", "editor is running but the server is not answering" and "another program is using the port".
- **One-click fix.** Click the light to get the console command that starts the server, copied to your clipboard.
- **Works with Epic's Unreal MCP plugin out of the box.** The default address matches the built-in plugin in Unreal Engine 5.8, so there is nothing to configure.
- **Works with any other MCP server** that speaks HTTP. Just change the address.
- **Lightweight and private.** About 16 KB, no dependencies, no extra processes, no cloud, no telemetry. It uses the MCP `ping` method, so it never opens sessions in the editor.
- **Windows, macOS and Linux.** English and Polish interface.

## Install

- **VS Code:** [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=montemr.unreal-mcp-status), or search for "Unreal MCP Status" in the Extensions view.
- **Antigravity, Cursor, VSCodium and other VS Code-based editors:** [Open VSX](https://open-vsx.org/extension/montemr/unreal-mcp-status).
- **From the command line:** `code --install-extension montemr.unreal-mcp-status`

## Quick start with Epic's Unreal MCP plugin (UE 5.8)

1. **Enable the plugin.** In Unreal, open **Edit → Plugins**, search for **Unreal MCP** (Experimental), enable it and restart the editor.
2. **Check the server settings.** In **Edit → Editor Preferences → Plugins → Model Context Protocol**, keep the port at `8000` and the path at `/mcp`, and turn on **Auto Start Server**.
3. **Connect your AI client.** The plugin can write the client configuration for you. Run this in the Unreal console:
   ```
   ModelContextProtocol.GenerateClientConfig All
   ```
   Replace `All` with `ClaudeCode`, `Cursor`, `VSCode`, `Gemini` or `Codex` to set up just one client. For Claude Code you can also run:
   ```
   claude mcp add --transport http unreal http://127.0.0.1:8000/mcp
   ```
4. **Install this extension.** The light turns green as soon as the editor is ready.

## What the light means

| Light | Meaning | What to do |
| --- | --- | --- |
| 🟢 **Unreal** | The MCP server answers. Your AI client can control the editor. | Nothing. Go ahead. |
| 🟡 **Unreal** | Unreal Editor is running, but the MCP server does not answer. | Wait until the editor finishes loading. If it stays yellow, click the light, choose **Copy command** and paste `ModelContextProtocol.StartServer` into the Unreal console. |
| 🟡 **Unreal** | Another program answers at the server's address. | Close that program, or change the port in Unreal and in the `unrealMcpStatus.url` setting. |
| 🔴 **Unreal** | Unreal Editor is not running. | Open your project. |

Hover over the light for details and quick actions: **Check now**, **Copy start command** and **Settings**. Click the light to check right away.

## Using a different MCP server

Set `unrealMcpStatus.url` to your server's address (`http` or `https`). Any server that implements the MCP Streamable HTTP transport turns the light green, whether it replies with plain JSON or a server-sent event stream, and even if it requires a session before it answers `ping`. The "editor is running" check looks for the `UnrealEditor` process, and the **Copy command** button copies the command for Epic's plugin.

## How it works

Every few seconds the extension sends an MCP `ping` (JSON-RPC over HTTP) to the configured address. A `ping` needs no session, so polling does not leave sessions open in the editor. If nothing answers, it checks whether an `UnrealEditor` process is running to tell "editor closed" apart from "server not started".

While the editor window is in the background, checks pause, and the light updates the moment you switch back.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `unrealMcpStatus.url` | `http://127.0.0.1:8000/mcp` | Address of the Unreal Editor MCP server. |
| `unrealMcpStatus.intervalSeconds` | `3` | How often to check the connection, in seconds. |
| `unrealMcpStatus.pauseWhenUnfocused` | `true` | Pause checking while the window is in the background. |
| `unrealMcpStatus.notifyOnChange` | `false` | Show a notification when the state changes, for example when the server comes up. |

## Commands

- **Unreal MCP: Check connection** (`unrealMcpStatus.refresh`) checks now and shows the result.
- **Unreal MCP: Copy start server command** (`unrealMcpStatus.copyStartCommand`) copies `ModelContextProtocol.StartServer` for the Unreal console.
- **Unreal MCP: Open settings** (`unrealMcpStatus.openSettings`) opens this extension's settings.

## Troubleshooting

- **"Replying to Ping" fills the Unreal Output Log.** Epic's plugin logs every `ping`. Keep `unrealMcpStatus.pauseWhenUnfocused` on, raise `unrealMcpStatus.intervalSeconds`, or hide the messages by running `Log LogModelContextProtocol Warning` in the Unreal console.
- **The light stays yellow with "Port is used by another program".** Another app answers on port 8000. Close it, or pick a free port in **Editor Preferences → Plugins → Model Context Protocol** and set the same address in `unrealMcpStatus.url` and in your AI client.
- **The light stays yellow with "MCP does not respond".** Check that **Auto Start Server** is on in the plugin settings, or start the server from the Unreal console with `ModelContextProtocol.StartServer`.

## Privacy

The extension only talks to the address you configure (your own machine by default) and reads the local process list to find `UnrealEditor`. Nothing leaves your computer.

## Requirements

- Unreal Engine 5 with an MCP server listening over HTTP, such as Epic's **Unreal MCP** plugin in UE 5.8.
- Windows, macOS or Linux. Process detection uses `tasklist` on Windows and `pgrep` elsewhere.

The extension runs on your local machine (UI side) even in remote workspaces, because the editor and its MCP server run locally.

## Languages

English and Polish. The extension follows the display language of your editor.

## License

[MIT](LICENSE)
