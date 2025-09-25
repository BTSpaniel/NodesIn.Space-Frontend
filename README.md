# 🎛️ Visual Node Editor Frontend

> A zero-build, static frontend for creating and executing node-based workflows with live feedback

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![WebSocket](https://img.shields.io/badge/WebSocket-Enabled-blue.svg)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)

## ✨ Features

🎨 **Dynamic Node Palette** - Populated from backend definitions (single source of truth)  
🖱️ **Drag-and-Drop Canvas** - With pan/zoom and world-scale grid  
🔗 **Type-Aware Connections** - Visual mismatch hints and port badges  
⚡ **Live Execution** - Start/stop with real-time progress, logs, and latency  
💾 **Flexible Save/Load** - To file, browser localStorage, or backend  
🌟 **Modern Visuals** - Optional 3D node effects and neon grid theme  

## 🚀 Quick Start

1. Clone the repository
2. Host the contents of `src/gui/frontend/` on any static server
3. Ensure your WebSocket backend is running on `ws://localhost:8001`
4. Open in browser and start building workflows!

## 📁 Project Structure

```
src/gui/frontend/
├── index.html                    # App shell and script includes
├── css/
│   ├── node-editor-style.css     # Core editor styles and 3D theme
│   └── workflow-modals.css       # Save/Load modal styles
└── js/
    ├── main.js                   # App bootstrap and UI flows
    ├── websocket-client.js       # WebSocket with auto-connect
    ├── node-palette.js           # Node library from backend
    ├── workflow-canvas.js        # Canvas engine and interactions
    ├── node-properties.js        # Property panel management
    ├── workflow-execution.js     # Execution controls and monitoring
    ├── workflow-import-export.js # Save/Load functionality
    ├── fx.js                     # 3D effects and animations
    └── grid-layer.js             # Background grid rendering
```

## 🔌 WebSocket API

### 📤 Requests (Frontend → Backend)
- `execute_workflow` `stop_execution` `validate_workflow`
- `save_workflow` `list_workflows` `load_workflow` 
- `delete_workflow` `rename_workflow` `ping`


## 🎮 How to Use

### Node Palette (Left)
- Search for nodes by name or type
- Drag nodes onto the canvas to add them

### Canvas Controls
- **Pan:** Drag empty space
- **Zoom:** Mouse wheel
- **Connect:** Drag from output port → input port
- **Context Menu:** Right-click anywhere

### Properties Panel (Right)
- Edit node properties and parameters
- Real-time validation and hints

### Execution Bar (Top)
- Click **Execute** to run workflows
- Monitor progress with live logs
- View performance metrics

### Save/Load Options
- 📄 **File:** Export/import JSON
- 💾 **Local Storage:** Browser persistence  
- 🌐 **Backend:** Server-side storage

## ⚙️ Configuration

### WebSocket Connection
```javascript
// Default: ws://localhost:8001
// Override with:
window.WS_URL = 'ws://your-backend-url:port';
```

## 🚀 Deployment

1. **Static Hosting:** Upload `src/gui/frontend/` to any static host
2. **Backend Connection:** Update `window.WS_URL` for production
3. **Headers:** Configure CSP for WebSocket connections
4. **Testing:** Verify backend connectivity


## 🔒 Security & Privacy

✅ **No secrets required** - Frontend contains no sensitive data  
✅ **Runtime configuration** - Use `window.WS_URL` for endpoints  
✅ **No embedded tokens** - Keep credentials server-side  

## 🛠️ Development

This is a zero-build frontend - no compilation step required!

1. Make changes to HTML/CSS/JS files
2. Refresh browser to see updates
3. Use browser dev tools for debugging

## 📝 License

MIT License - feel free to use in your projects!

## 🤝 Contributing

Issues and pull requests welcome! Please check existing issues first.

---

**Built with ❤️ for the node-based workflow community**
