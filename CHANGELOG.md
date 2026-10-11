# Changelog

## 1.3.0

- **Checked like a real AI client.** When the server comes up and when you click the light, the extension runs `initialize` and `tools/list`, counts the tools and closes the session again. Green now means tools are available; a server with no tools or a failing handshake shows yellow with the reason. Setting: `unrealMcpStatus.verifyTools`.
- **Right project.** The tooltip shows which project is open in Unreal, and the light turns yellow when it is not the `.uproject` in your workspace. Setting: `unrealMcpStatus.checkProject`.
- **Older engine versions.** Detects the UE4 editor (`UE4Editor`) as well as UE5, and supports plugins that bridge to Unreal over TCP with `tcp://` addresses.
- **Choose MCP server** command with presets for Epic's Unreal MCP (UE 5.8), chongdashu's UnrealMCP and forks (TCP 55557) and kvick-games' UnrealMCP (TCP 13377), plus a custom address.
- Configurable start command (`unrealMcpStatus.startCommand`); the Copy command button is hidden for plugins that have none.
- New README: store buttons, compatibility badges and table, and what the extension checks and does not check.

## 1.2.0

- Checks pause while the window is in the background and run again the moment you come back. This keeps the Unreal Output Log quieter (Epic's plugin logs every ping) and saves CPU. Setting: `unrealMcpStatus.pauseWhenUnfocused`.
- More reliable detection: servers that reply with a server-sent event stream, or that require a session before answering `ping`, now show green instead of "Port is used by another program". `https` addresses work too.
- Quick actions in the tooltip: Check now, Copy start command and Settings.
- New commands: "Unreal MCP: Copy start server command" and "Unreal MCP: Open settings".
- Optional notification when the connection state changes. Setting: `unrealMcpStatus.notifyOnChange`.
- Troubleshooting section in the README.

## 1.1.1

- Clearer description and README: quick start for Epic's Unreal MCP plugin, what each light means and what to do, privacy notes.

## 1.1.0

- English interface with a Polish translation (follows the editor's display language).
- Unreal Editor process detection on macOS and Linux.
- The "Copy command" button also appears when the editor is not running.
- The extension always runs on the local machine in remote workspaces.
- README, icon and MIT license for publishing.

## 1.0.1

- First version: status bar indicator with green, yellow and red states.
