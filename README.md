Visual Node Editor Frontend
A zero-build, static frontend for creating and executing node-based workflows. It connects to a backend over WebSocket, renders node definitions provided by the server, and offers a drag-and-drop editor with live execution feedback.

Repository: https://github.com/BTSpaniel/NodesIn.Space-Frontend

Features
Node palette dynamically populated from backend definitions (single source of truth).
Drag-and-drop canvas with pan/zoom and world-scale grid.
Type-aware connections with visual mismatch hints and port badges.
Execution controls with start/stop and live progress, logs, and latency indicator.
Save/Load workflows to file, browser localStorage, or backend.
Modern visuals with optional 3D node effects and neon grid theme.
Project structure
Key files and modules under src/gui/frontend/:

index.html
 — App shell and script includes.
css/node-editor-style.css
 — Core editor styles and 3D theme.
css/workflow-modals.css
 — Save/Load modal styles.
js/main.js
 — App bootstrap, event wiring, high-level UI flows.
js/websocket-client.js
 — WS client with auto-connect and heartbeat/ping.
js/node-palette.js
 — Node library fed by backend available_nodes.
js/workflow-canvas.js
 — Canvas engine: nodes, ports, connections, pan/zoom.
js/node-properties.js
 — Right-side property panel: render/validate/bind.
js/workflow-execution.js
 — Execute/stop/pause/resume, validate, metrics/history.
js/workflow-import-export.js
 — Save/Load (file, localStorage, backend).
js/fx.js
 — 3D and glow effects for nodes and wires.
js/grid-layer.js
 — Background grid that tracks zoom/pan.

Common additional messages the frontend understands (see 
js/websocket-client.js
):

Requests: execute_workflow, stop_execution, validate_workflow, save_workflow, list_workflows, load_workflow, delete_workflow, rename_workflow, ping
Events: node_execution_start, node_execution_complete, node_execution_error, execution_progress, workflow_complete, workflow_saved, workflow_loaded, workflow_list, workflow_deleted, workflow_renamed, pong, error, connection_established
How to use the editor
Node palette (left): search and drag a node onto the canvas.
Canvas:
Pan: drag empty space
Zoom: mouse wheel
Connect: drag from an output port to an input port
Right-click for context menus (canvas, nodes, connections)
Properties (right): edit node properties defined by properties in the node definition.
Execute (top bar):
Click “Execute” to run the workflow against the backend.
Live status, logs, and simple metrics update during execution.
Save/Load:
File: export/import JSON
Local Storage: save inside the browser
Backend: uses WebSocket endpoints if implemented
Configuration
WebSocket URL:
Defaults to ws://localhost:8001 for local development.
You can override via window.WS_URL (see snippet above).
CSP and security headers:
If you host behind a static host with strict headers, adjust 
_headers
 as needed.
Keep external domains to a minimum and update connect-src carefully.
Deployment
Host the contents of src/gui/frontend/ on any static hosting platform.
Ensure your WebSocket backend is reachable from the hosted origin (update window.WS_URL if necessary).
Update 
_headers
 or your host’s header config for CSP/security, if applicable.
Security & privacy
This frontend contains no secrets and requires none to run.
Avoid embedding private keys or tokens in the HTML/JS. If you need to configure endpoints, use window.WS_URL at runtime or environment-specific HTML.
