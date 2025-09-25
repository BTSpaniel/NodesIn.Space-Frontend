Visual Node Editor Frontend
A zero-build, static frontend for creating and executing node-based workflows. It connects to a backend over WebSocket, renders node definitions provided by the server, and offers a drag-and-drop editor with live execution feedback.
Repository: https://github.com/BTSpaniel/NodesIn.Space-Frontend
Features

Dynamic Node Palette - Populated from backend definitions (single source of truth)
Drag-and-Drop Canvas - With pan/zoom and world-scale grid
Type-Aware Connections - Visual mismatch hints and port badges
Execution Controls - Start/stop with live progress, logs, and latency indicator
Save/Load Workflows - To file, browser localStorage, or backend
Modern Visuals - Optional 3D node effects and neon grid theme

Project Structure
Key files and modules under src/gui/frontend/:
Core Files

index.html — App shell and script includes
css/node-editor-style.css — Core editor styles and 3D theme
css/workflow-modals.css — Save/Load modal styles

JavaScript Modules

js/main.js — App bootstrap, event wiring, high-level UI flows
js/websocket-client.js — WebSocket client with auto-connect and heartbeat/ping
js/node-palette.js — Node library fed by backend available_nodes
js/workflow-canvas.js — Canvas engine: nodes, ports, connections, pan/zoom
js/node-properties.js — Right-side property panel: render/validate/bind
js/workflow-execution.js — Execute/stop/pause/resume, validate, metrics/history
js/workflow-import-export.js — Save/Load (file, localStorage, backend)
js/fx.js — 3D and glow effects for nodes and wires
js/grid-layer.js — Background grid that tracks zoom/pan

WebSocket API
The frontend communicates with the backend via WebSocket messages (see js/websocket-client.js):
Requests

execute_workflow
stop_execution
validate_workflow
save_workflow
list_workflows
load_workflow
delete_workflow
rename_workflow
ping

Events

node_execution_start
node_execution_complete
node_execution_error
execution_progress
workflow_complete
workflow_saved
workflow_loaded
workflow_list
workflow_deleted
workflow_renamed
pong
error
connection_established

How to Use the Editor
Node Palette (Left Panel)

Search and drag nodes onto the canvas

Canvas Controls

Pan: Drag empty space
Zoom: Mouse wheel
Connect: Drag from an output port to an input port
Context Menus: Right-click on canvas, nodes, or connections

Properties Panel (Right)

Edit node properties as defined in the node definition

Execution (Top Bar)

Click "Execute" to run the workflow against the backend
Live status, logs, and metrics update during execution

Save/Load Options

File: Export/import JSON
Local Storage: Save inside the browser
Backend: Uses WebSocket endpoints if implemented

Configuration
WebSocket URL

Defaults to ws://localhost:8001 for local development
Override via window.WS_URL if needed

Security Headers
If hosting behind a static host with strict headers:

Adjust _headers as needed
Keep external domains to a minimum
Update connect-src carefully for CSP

Deployment

Host the contents of src/gui/frontend/ on any static hosting platform
Ensure your WebSocket backend is reachable from the hosted origin
Update window.WS_URL if necessary
Configure _headers or your host's header config for CSP/security if applicable

Security & Privacy

This frontend contains no secrets and requires none to run
Avoid embedding private keys or tokens in the HTML/JS
For endpoint configuration, use window.WS_URL at runtime or environment-specific HTML

License
MIT License
