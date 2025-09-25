/**
 * Workflow Canvas Management
 * Handles the main canvas area with node placement, connections, and interactions
 */
class WorkflowCanvas {
    constructor() {
        this.canvas = document.getElementById('workflow-canvas');
        this.nodesContainer = document.getElementById('nodes-container');
        this.connectionsContainer = document.getElementById('connections-svg');
        
        // Fixed world configuration (100k x 100k)
        this.worldSize = 100000; // pixels/units
        this.useFixedWorld = true; // when true, we use a fixed-size world and center the view
        
        this.nodes = new Map();
        this.connections = new Map();
        this.selectedNodes = new Set();
        this.selectedConnections = new Set();
        // Fast lookup indexes for connections
        // incoming: nodeId -> Map<inputName, connection>
        // outgoing: nodeId -> Map<outputName, Set<connectionId>>
        this.connectionIndex = {
            incoming: new Map(),
            outgoing: new Map(),
        };
        
        this.dragState = {
            isDragging: false,
            dragMode: 'none', // 'none', 'node', 'canvas', 'connection'
            startX: 0,
            startY: 0,
            dragOffset: { x: 0, y: 0 },
            draggedNode: null,
            connectionStart: null,
            isAutoPanning: false,
            autoPanSpeed: { x: 0, y: 0 }
        };
        
        this.canvasTransform = { x: 0, y: 0, scale: 1 };
        this.nodeCounter = 0;
        this.connectionCounter = 0;
        
        this.grid = new GridLayer('grid-layer');
        this.setupEventListeners();
        this.setupContextMenus();
        
        // Initialize world after DOM is ready to compute viewport size precisely
        requestAnimationFrame(() => this.initializeWorldCanvas());
    }

    initializeWorldCanvas() {
        if (!this.useFixedWorld) return;
        const s = this.worldSize;
        
        // Configure the SVG world extents and position
        this.connectionsContainer.setAttribute('viewBox', `0 0 ${s} ${s}`);
        this.connectionsContainer.style.width = `${s}px`;
        this.connectionsContainer.style.height = `${s}px`;
        this.connectionsContainer.style.left = `0px`;
        this.connectionsContainer.style.top = `0px`;
        
        // Expand the nodes container visual box as well (for hit-testing/selection boxes)
        this.nodesContainer.style.width = `${s}px`;
        this.nodesContainer.style.height = `${s}px`;
        
        // Center the view on the middle of the 100k world
        const rect = this.canvas.getBoundingClientRect();
        const scale = this.canvasTransform.scale || 1;
        const center = s / 2;
        this.canvasTransform.x = (rect.width / 2) - (center * scale);
        this.canvasTransform.y = (rect.height / 2) - (center * scale);
        this.applyCanvasTransform();
    }

    // --- Type helpers and styling ---
    getPortType(nodeId, portName, role /* 'input'|'output' */) {
        const node = this.nodes.get(nodeId);
        if (!node || !node.definition) return 'any';
        const list = role === 'input' ? (node.definition.inputs || []) : (node.definition.outputs || []);
        const item = list.find(io => io.name === portName);
        const t = item && (item.type || 'any');
        return t ? String(t).toLowerCase() : 'any';
    }

    isTypeCompatible(srcType, dstType) {
        if (!srcType || !dstType) return true;
        const a = srcType.toLowerCase();
        const b = dstType.toLowerCase();
        if (a === 'any' || b === 'any') return true;
        return a === b;
    }

    applyConnectionTypeStyling(connectionData, srcType, dstType, compatible) {
        if (!connectionData || !connectionData.element) return;
        const path = connectionData.element;
        // Remove existing title children
        Array.from(path.childNodes).forEach(n => {
            if (n.nodeName && n.nodeName.toLowerCase() === 'title') n.remove();
        });
        // Add tooltip
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = compatible
            ? `Type: ${srcType} → ${dstType}`
            : `Type mismatch: ${srcType} → ${dstType}`;
        path.appendChild(title);

        // Toggle mismatch class on connection path
        if (!compatible) {
            path.classList.add('type-mismatch');
            // Mark target port as mismatched
            if (connectionData.target && connectionData.target.element) {
                connectionData.target.element.classList.add('mismatch');
                connectionData.target.element.setAttribute('title', `Expected ${dstType}, got ${srcType}`);
            }
        } else {
            path.classList.remove('type-mismatch');
            if (connectionData.target && connectionData.target.element) {
                connectionData.target.element.classList.remove('mismatch');
                connectionData.target.element.removeAttribute('title');
            }
        }
        // Store for later
        connectionData.typeInfo = { srcType, dstType, compatible };
        // Update visual color/effects based on new mismatch state
        this.applyConnectionColor(connectionData);
    }
    
    // UI coloring helpers
    applyConnectionColor(connectionData) {
        if (!connectionData || !connectionData.element) return;
        const path = connectionData.element;
        const selected = path.classList.contains('selected');
        const mismatch = path.classList.contains('type-mismatch');

        // Stroke color handling
        if (selected) {
            // Let CSS selected style drive the stroke
            path.style.stroke = '';
        } else if (connectionData.color) {
            path.style.stroke = connectionData.color; // override base class color
        } else {
            path.style.stroke = '';
        }

        // Glow/effects via fx.js
        if (typeof window.fx !== 'undefined' && window.fx.applyWireColor) {
            if (connectionData.color) {
                window.fx.applyWireColor(path, connectionData.color, { selected, mismatch });
            } else {
                window.fx.clearWireColor(path);
            }
        }
    }

    applyNodeVisualStyle(node) {
        if (!node || !node.element) return;
        if (typeof window.fx !== 'undefined' && window.fx.applyNodeColor) {
            if (node.color) {
                window.fx.applyNodeColor(node.element, node.color);
            } else {
                window.fx.clearNodeColor(node.element);
            }
        } else {
            // Fallback: simple border tint if fx.js is not loaded
            if (node.color) node.element.style.borderColor = node.color; else node.element.style.borderColor = '';
        }
    }

    setSelectedNodesColor(color) {
        if (!color) return;
        this.selectedNodes.forEach((nodeId) => {
            const node = this.nodes.get(nodeId);
            if (!node) return;
            node.color = color;
            this.applyNodeVisualStyle(node);
            // Update all attached connections (incoming and outgoing)
            this.getIncomingConnections(nodeId).forEach(({ connectionId }) => {
                const conn = this.connections.get(connectionId);
                if (conn) {
                    conn.color = color;
                    this.applyConnectionColor(conn);
                }
            });
            this.getOutgoingConnections(nodeId).forEach(({ connectionId }) => {
                const conn = this.connections.get(connectionId);
                if (conn) {
                    conn.color = color;
                    this.applyConnectionColor(conn);
                }
            });
        });
    }

    resetSelectedNodesColor() {
        this.selectedNodes.forEach((nodeId) => {
            const node = this.nodes.get(nodeId);
            if (!node) return;
            node.color = null;
            this.applyNodeVisualStyle(node);
            // Reset incoming connections: prefer other endpoint's color if present
            this.getIncomingConnections(nodeId).forEach(({ connectionId, fromNodeId }) => {
                const conn = this.connections.get(connectionId);
                if (conn) {
                    const other = this.nodes.get(fromNodeId);
                    conn.color = (other && other.color) ? other.color : null;
                    this.applyConnectionColor(conn);
                }
            });
            // Reset outgoing connections: prefer other endpoint's color if present
            this.getOutgoingConnections(nodeId).forEach(({ connectionId, toNodeId }) => {
                const conn = this.connections.get(connectionId);
                if (conn) {
                    const other = this.nodes.get(toNodeId);
                    conn.color = (other && other.color) ? other.color : null;
                    this.applyConnectionColor(conn);
                }
            });
        });
    }
    
    setupEventListeners() {
        // Canvas drop handling for new nodes
        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        
        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const nodeType = e.dataTransfer.getData('text/plain');
            if (nodeType && window.nodePalette) {
                const definition = window.nodePalette.getNodeDefinition(nodeType);
                if (definition) {
                    // Convert viewport coordinates to canvas coordinates (respecting pan/zoom)
                    const { x: cx, y: cy } = this.viewportToCanvas(e.clientX, e.clientY);
                    const x = cx - 80; // Offset for node width
                    const y = cy - 20; // Offset for node height
                    
                    console.log('Creating node at (canvas coords):', { x, y, clientX: e.clientX, clientY: e.clientY });
                    this.createNode(definition, Math.max(0, x), Math.max(0, y));
                }
            }
        });
        
        // Canvas panning
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.target === this.canvas || e.target === this.nodesContainer) {
                this.startCanvasPan(e);
            }
        });
        
        // Global mouse events
        document.addEventListener('mousemove', (e) => {
            this.handleMouseMove(e);
        });
        
        document.addEventListener('mouseup', (e) => {
            this.handleMouseUp(e);
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });
        
        // Canvas zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.handleWheel(e);
        });
        
        // Selection handling
        this.canvas.addEventListener('click', (e) => {
            if (e.target === this.canvas || e.target === this.nodesContainer) {
                this.clearSelection();
            }
        });
    }
    
    setupContextMenus() {
        const canvasContextMenu = document.getElementById('canvas-context-menu');
        const nodeContextMenu = document.getElementById('node-context-menu');
        const connectionContextMenu = document.getElementById('connection-context-menu');
        // Ensure color palette exists (fallback in case HTML wasn't refreshed)
        if (nodeContextMenu) {
            this.ensureNodeColorPalette(nodeContextMenu);
        }
        
        // Canvas right-click
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (e.target === this.canvas || e.target === this.nodesContainer) {
                this.showContextMenu(canvasContextMenu, e.clientX, e.clientY);
            }
        });
        
        // Context menu actions
        canvasContextMenu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            switch (action) {
                case 'paste':
                    this.pasteNodes();
                    break;
                case 'select-all':
                    this.selectAll();
                    break;
                case 'clear':
                    this.clearCanvas();
                    break;
            }
            this.hideContextMenus();
        });
        
        nodeContextMenu.addEventListener('click', (e) => {
            // Handle color swatch click (no data-action attribute)
            if (e.target.classList.contains('color-swatch')) {
                const color = e.target.dataset.color;
                if (color) {
                    this.setSelectedNodesColor(color);
                }
                this.hideContextMenus();
                return;
            }
            const action = e.target.dataset.action;
            switch (action) {
                case 'copy':
                    this.copySelectedNodes();
                    break;
                case 'duplicate':
                    this.duplicateSelectedNodes();
                    break;
                case 'lock': {
                    // Lock all selected nodes
                    this.selectedNodes.forEach(nodeId => {
                        const n = this.nodes.get(nodeId);
                        if (n && !n.locked) {
                            n.locked = true;
                            if (n.element) n.element.classList.add('locked');
                        }
                    });
                    break;
                }
                case 'unlock': {
                    // Unlock all selected nodes
                    this.selectedNodes.forEach(nodeId => {
                        const n = this.nodes.get(nodeId);
                        if (n && n.locked) {
                            n.locked = false;
                            if (n.element) n.element.classList.remove('locked');
                        }
                    });
                    break;
                }
                case 'reset-node-color': {
                    this.resetSelectedNodesColor();
                    break;
                }
                case 'delete':
                    this.deleteSelectedNodes();
                    break;
            }
            this.hideContextMenus();
        });
        
        if (connectionContextMenu) {
            connectionContextMenu.addEventListener('click', (e) => {
                // Ignore disabled actions
                if (e.target.classList.contains('disabled')) {
                    this.hideContextMenus();
                    return;
                }
                const action = e.target.dataset.action;
                switch (action) {
                    case 'delete-connection':
                        this.deleteSelectedConnections();
                        break;
                }
                this.hideContextMenus();
            });
        }
        
        // Hide context menus on outside click
        document.addEventListener('click', () => {
            this.hideContextMenus();
        });
    }

    ensureNodeColorPalette(menu) {
        if (!menu) return;
        if (menu.querySelector('#node-color-palette')) return; // already present

        // Find insertion point (before the final Delete item if present)
        const deleteItem = menu.querySelector('[data-action="delete"]');
        const insertBefore = deleteItem || null;

        // Build elements
        const dividerTop = document.createElement('div');
        dividerTop.className = 'context-divider';

        const subtitle = document.createElement('div');
        subtitle.className = 'context-item context-subtitle';
        subtitle.style.cursor = 'default';
        subtitle.textContent = 'Color';

        const palette = document.createElement('div');
        palette.className = 'color-palette';
        palette.id = 'node-color-palette';

        const colors = ['#E74C3C','#E67E22','#F1C40F','#2ECC71','#1ABC9C','#3498DB','#9B59B6','#EC407A','#95A5A6'];
        const titles = ['Red','Orange','Yellow','Green','Teal','Blue','Purple','Pink','Gray'];
        colors.forEach((hex, i) => {
            const sw = document.createElement('div');
            sw.className = 'color-swatch';
            sw.dataset.color = hex;
            sw.title = titles[i] || hex;
            sw.style.background = hex;
            palette.appendChild(sw);
        });

        const resetItem = document.createElement('div');
        resetItem.className = 'context-item';
        resetItem.dataset.action = 'reset-node-color';
        resetItem.textContent = 'Reset Color';

        const dividerBottom = document.createElement('div');
        dividerBottom.className = 'context-divider';

        // Insert into menu
        if (insertBefore) {
            menu.insertBefore(dividerTop, insertBefore);
            menu.insertBefore(subtitle, insertBefore);
            menu.insertBefore(palette, insertBefore);
            menu.insertBefore(resetItem, insertBefore);
            menu.insertBefore(dividerBottom, insertBefore);
        } else {
            menu.appendChild(dividerTop);
            menu.appendChild(subtitle);
            menu.appendChild(palette);
            menu.appendChild(resetItem);
            menu.appendChild(dividerBottom);
        }
    }
    
    createNode(definition, x, y) {
        const nodeId = `node_${++this.nodeCounter}`;
        const nodeElement = document.createElement('div');
        nodeElement.className = 'workflow-node';
        nodeElement.dataset.nodeId = nodeId;
        nodeElement.style.visibility = 'hidden';
        
        // Create node structure
        nodeElement.innerHTML = this.generateNodeHTML(definition, nodeId);
        
        // Add to containers
        this.nodesContainer.appendChild(nodeElement);

        // Enable 3D FX on nodes, if available
        if (typeof window.fx !== 'undefined' && typeof window.fx.enableNode3D === 'function') {
            window.fx.enableNode3D(nodeElement);
        }
        
        // After mounting, compute size and clamp position to world
        const nodeWidth = nodeElement.offsetWidth;
        const nodeHeight = nodeElement.offsetHeight;
        const clampedPos = this.clampToWorld(x, y, nodeWidth, nodeHeight);
        nodeElement.style.left = `${clampedPos.x}px`;
        nodeElement.style.top = `${clampedPos.y}px`;
        nodeElement.style.visibility = '';
        
        // Store node data
        const nodeData = {
            id: nodeId,
            type: definition.type,
            definition: definition,
            element: nodeElement,
            position: { x: clampedPos.x, y: clampedPos.y },
            properties: this.initializeProperties(definition),
            locked: false,
            color: null,
            inputs: new Map(),
            outputs: new Map()
        };
        
        this.nodes.set(nodeId, nodeData);
        
        // Setup node event listeners
        this.setupNodeEvents(nodeElement, nodeData);
        
        // Setup connection point events
        this.setupConnectionEvents(nodeElement);
        
        // Update performance metrics
        this.updatePerformanceMetrics();
        this.updateCanvasBounds();
        
        return nodeId;
    }
    
    generateNodeHTML(definition, nodeId) {
        let html = `<div class="node-header">${definition.name}</div><div class="node-body">`;
        
        // Input connections
        if (definition.inputs && definition.inputs.length > 0) {
            definition.inputs.forEach((input, index) => {
                html += `
                    <div class="node-input">
                        <div class="connection-point input-point" 
                             data-node-id="${nodeId}" 
                             data-connection-type="input" 
                             data-connection-name="${input.name}"></div>
                        <span class="port-name">${input.name}</span>
                        <span class="port-badge port-badge-${input.type}" title="${input.type}">${input.type}</span>
                    </div>
                `;
            });
        }
        
        // Output connections  
        if (definition.outputs && definition.outputs.length > 0) {
            definition.outputs.forEach((output, index) => {
                html += `
                    <div class="node-output">
                        <span class="port-name">${output.name}</span>
                        <span class="port-badge port-badge-${output.type}" title="${output.type}">${output.type}</span>
                        <div class="connection-point output-point" 
                             data-node-id="${nodeId}" 
                             data-connection-type="output" 
                             data-connection-name="${output.name}"></div>
                    </div>
                `;
            });
        }
        
        html += `</div>`;
        return html;
    }
    
    initializeProperties(definition) {
        const properties = {};
        if (definition.properties) {
            Object.entries(definition.properties).forEach(([key, prop]) => {
                properties[key] = prop.default !== undefined ? prop.default : null;
            });
        }
        return properties;
    }
    
    setupNodeEvents(element, nodeData) {
        // Node selection
        element.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectNode(nodeData.id, !e.ctrlKey);
        });
        
        // Node dragging
        element.addEventListener('mousedown', (e) => {
            if (!e.target.classList.contains('connection-point')) {
                if (nodeData.locked) {
                    // Prevent dragging locked nodes
                    return;
                }
                this.startNodeDrag(e, nodeData);
            }
        });
        
        // Context menu for nodes
        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectNode(nodeData.id, true);
            const nodeContextMenu = document.getElementById('node-context-menu');
            // Toggle lock/unlock menu items based on node state
            if (nodeContextMenu) {
                const lockItem = nodeContextMenu.querySelector('[data-action="lock"]');
                const unlockItem = nodeContextMenu.querySelector('[data-action="unlock"]');
                const deleteItem = nodeContextMenu.querySelector('[data-action="delete"]');
                if (nodeData.locked) {
                    if (lockItem) lockItem.style.display = 'none';
                    if (unlockItem) unlockItem.style.display = '';
                    if (deleteItem) { deleteItem.classList.add('disabled'); deleteItem.style.opacity = '0.5'; }
                } else {
                    if (lockItem) lockItem.style.display = '';
                    if (unlockItem) unlockItem.style.display = 'none';
                    if (deleteItem) { deleteItem.classList.remove('disabled'); deleteItem.style.opacity = ''; }
                }
            }
            this.showContextMenu(nodeContextMenu, e.clientX, e.clientY);
        });
    }
    
    setupConnectionEvents(nodeElement) {
        const connectionPoints = nodeElement.querySelectorAll('.connection-point');
        
        connectionPoints.forEach(point => {
            point.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                const connectionData = {
                    element: point,
                    nodeId: point.dataset.nodeId,
                    type: point.dataset.connectionType,
                    name: point.dataset.connectionName
                };
                
                this.startConnectionDrag(e, connectionData);
            });
            
            // Visual feedback on hover
            point.addEventListener('mouseenter', () => {
                if (!this.dragState.isDragging || this.dragState.dragMode !== 'connection') {
                    point.style.transform = 'scale(1.2)';
                }
            });
            
            point.addEventListener('mouseleave', () => {
                if (!point.classList.contains('connecting')) {
                    point.style.transform = '';
                }
            });
        });
    }
    
    startNodeDrag(e, nodeData) {
        this.dragState.isDragging = true;
        this.dragState.dragMode = 'node';
        this.dragState.startX = e.clientX;
        this.dragState.startY = e.clientY;
        this.dragState.draggedNode = nodeData;
        
        // Store the original node position and mouse offset
        this.dragState.dragOffset = {
            x: nodeData.position.x,
            y: nodeData.position.y
        };
        
        nodeData.element.style.zIndex = '1000';
        // Let CSS know we're dragging (stabilize 3D tilt, elevate shadow)
        nodeData.element.classList.add('dragging');
    }
    
    startCanvasPan(e) {
        this.dragState.isDragging = true;
        this.dragState.dragMode = 'canvas';
        this.dragState.startX = e.clientX - this.canvasTransform.x;
        this.dragState.startY = e.clientY - this.canvasTransform.y;
    }
    
    startConnectionDrag(e, connectionData) {
        this.dragState.isDragging = true;
        this.dragState.dragMode = 'connection';
        this.dragState.connectionStart = connectionData;
        
        // Visual feedback
        connectionData.element.classList.add('connecting');
        
        console.log('Starting connection drag from:', connectionData);
    }
    
    
    handleMouseMove(e) {
        if (!this.dragState.isDragging) return;
        
        switch (this.dragState.dragMode) {
            case 'node':
                this.updateNodeDrag(e);
                break;
            case 'canvas':
                this.updateCanvasPan(e);
                break;
            case 'connection':
                this.updateConnectionDrag(e);
                break;
        }
    }
    
    updateNodeDrag(e) {
        if (this.dragState.isAutoPanning) return; // Let the auto-pan loop handle movement
        this.checkForAutoPan(e);

        const node = this.dragState.draggedNode;
        if (!node) return;
        
        // Calculate movement delta from start position
        const scale = this.canvasTransform.scale || 1;
        const deltaX = (e.clientX - this.dragState.startX) / scale;
        const deltaY = (e.clientY - this.dragState.startY) / scale;
        
        // Apply delta to original position
        const rawX = this.dragState.dragOffset.x + deltaX;
        const rawY = this.dragState.dragOffset.y + deltaY;
        const w = node.element.offsetWidth;
        const h = node.element.offsetHeight;
        const { x: newX, y: newY } = this.clampToWorld(rawX, rawY, w, h);
        
        node.position.x = newX;
        node.position.y = newY;
        node.element.style.left = `${newX}px`;
        node.element.style.top = `${newY}px`;
        
        // Update connections
        this.updateNodeConnections(node.id);
    }
    
    updateCanvasPan(e) {
        this.canvasTransform.x = e.clientX - this.dragState.startX;
        this.canvasTransform.y = e.clientY - this.dragState.startY;
        this.applyCanvasTransform();
        this.refreshConnectionsAfterTransform();
    }
    
    updateConnectionDrag(e) {
        if (!this.dragState.connectionStart) return;
        
        // Remove existing preview line
        const existingPreview = this.connectionsContainer.querySelector('.connection-preview');
        if (existingPreview) {
            existingPreview.remove();
        }
        
        // Get start point using same method as drawConnection for consistency
        const startElement = this.dragState.connectionStart.element;
        const startNode = this.nodes.get(this.dragState.connectionStart.nodeId);
        
        if (!startNode) return;
        
        const startElementRect = startElement.getBoundingClientRect();
        const startNodeRect = startNode.element.getBoundingClientRect();
        const svgRect = this.connectionsContainer.getBoundingClientRect();
        
        // Calculate precise offset and position
        const startOffsetX = (startElementRect.left + startElementRect.width / 2) - startNodeRect.left;
        const startOffsetY = (startElementRect.top + startElementRect.height / 2) - startNodeRect.top;
        
        const startAbs = this.getAbsoluteCenter(startElement);
        const startRel = this.getRelativeCoords(startAbs.x, startAbs.y);
        const endRel = this.getRelativeCoords(e.clientX, e.clientY);

        const startX = startRel.x;
        const startY = startRel.y;
        const endX = endRel.x;
        const endY = endRel.y;
        
        // Create preview line
        const previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        // Calculate control points for smooth curve
        const distance = Math.abs(endX - startX);
        const controlOffset = Math.max(80, distance * 0.4);
        
        const pathData = `M ${startX} ${startY} C ${startX + controlOffset} ${startY} ${endX - controlOffset} ${endY} ${endX} ${endY}`;
        
        previewLine.setAttribute('d', pathData);
        previewLine.setAttribute('class', 'connection-preview');
        previewLine.setAttribute('stroke', '#00ffaa');
        previewLine.setAttribute('stroke-width', '2');
        previewLine.setAttribute('stroke-dasharray', '5,5');
        previewLine.setAttribute('fill', 'none');
        previewLine.style.pointerEvents = 'none';
        
        this.connectionsContainer.appendChild(previewLine);
    }
    
    handleMouseUp(e) {
        if (!this.dragState.isDragging) return;
        
        switch (this.dragState.dragMode) {
            case 'node':
                this.endNodeDrag();
                break;
            case 'canvas':
                this.endCanvasPan();
                break;
            case 'connection':
                this.endConnection(e);
                break;
        }
        
        this.resetDragState();
    }
    
    endNodeDrag() {
        // Node drag complete
        if (this.dragState.draggedNode) {
            this.dragState.draggedNode.element.style.zIndex = '';
            this.dragState.draggedNode.element.classList.remove('dragging');
            this.updateCanvasBounds();
            // Redraw all connections to ensure they stay attached
            this.redrawAllConnections();
        }
    }
    
    endCanvasPan() {
        // Canvas pan complete
    }
    
    endConnection(e) {
        // Remove preview line
        const existingPreview = this.connectionsContainer.querySelector('.connection-preview');
        if (existingPreview) {
            existingPreview.remove();
        }
        
        const targetElement = document.elementFromPoint(e.clientX, e.clientY);
        
        if (targetElement && targetElement.classList.contains('connection-point')) {
            // Get the node that contains this connection point
            const targetNodeId = targetElement.dataset.nodeId;
            const targetNode = this.nodes.get(targetNodeId);
            
            if (!targetNode) return;
            
            // Find the exact connection point element using the same selector as in drawConnection
            const targetType = targetElement.dataset.connectionType;
            const targetName = targetElement.dataset.connectionName;
            
            const exactTargetElement = targetNode.element.querySelector(
                `.connection-point[data-connection-type="${targetType}"][data-connection-name="${targetName}"]`
            );
            
            if (!exactTargetElement) return;
            
            const target = {
                element: exactTargetElement,
                nodeId: targetNodeId,
                type: targetType,
                name: targetName
            };
            
            // Also ensure we have the exact source element
            const sourceNodeId = this.dragState.connectionStart.nodeId;
            const sourceNode = this.nodes.get(sourceNodeId);
            if (!sourceNode) return;
            
            const sourceType = this.dragState.connectionStart.type;
            const sourceName = this.dragState.connectionStart.name;
            
            const exactSourceElement = sourceNode.element.querySelector(
                `.connection-point[data-connection-type="${sourceType}"][data-connection-name="${sourceName}"]`
            );
            
            if (!exactSourceElement) return;
            
            const source = {
                element: exactSourceElement,
                nodeId: sourceNodeId,
                type: sourceType,
                name: sourceName
            };
            
            this.createConnection(source, target);
        }
        
        // Clean up visual feedback
        if (this.dragState.connectionStart) {
            this.dragState.connectionStart.element.classList.remove('connecting');
        }
    }
    
    createConnection(source, target) {
        // Validate connection
        if (source.nodeId === target.nodeId) return; // No self-connections
        if (source.type === target.type) return; // Output to input only
        if (source.type === 'input' && target.type === 'output') {
            // Swap so source is always output
            [source, target] = [target, source];
        }
        
        // Ensure we have the latest element references
        const sourceNode = this.nodes.get(source.nodeId);
        const targetNode = this.nodes.get(target.nodeId);
        
        if (!sourceNode || !targetNode) return;
        
        // Update source and target with fresh element references
        source.element = sourceNode.element.querySelector(
            `.connection-point[data-connection-type="${source.type}"][data-connection-name="${source.name}"]`
        );
        target.element = targetNode.element.querySelector(
            `.connection-point[data-connection-type="${target.type}"][data-connection-name="${target.name}"]`
        );
        
        if (!source.element || !target.element) return;

        // Enforce single inbound connection per input port: replace existing binding if present
        const existingBinding = this.getInputBinding(target.nodeId, target.name);
        if (existingBinding) {
            this.deleteConnection(existingBinding.connectionId);
        }
        
        const connectionId = `connection_${++this.connectionCounter}`;
        const connectionData = {
            id: connectionId,
            source: source,
            target: target
        };
        
        this.connections.set(connectionId, connectionData);
        // Index this connection for fast lookup
        this._registerConnectionInIndex(connectionData);
        
        // Initialize connection color from endpoints (prefer source node color)
        const srcNodeRef = this.nodes.get(source.nodeId);
        const dstNodeRef = this.nodes.get(target.nodeId);
        const srcNodeColor = srcNodeRef ? (srcNodeRef.color || null) : null;
        const dstNodeColor = dstNodeRef ? (dstNodeRef.color || null) : null;
        if (srcNodeColor) {
            connectionData.color = srcNodeColor;
        } else if (dstNodeColor) {
            connectionData.color = dstNodeColor;
        } else {
            connectionData.color = null;
        }
        
        // Update visual connections
        this.drawConnection(connectionData);
        this.updatePerformanceMetrics();
        
        // Mark connection points as connected
        source.element.classList.add('connected');
        target.element.classList.add('connected');

        // Notify properties panel
        this._notifyConnectionsChanged(connectionData.source.nodeId);
        this._notifyConnectionsChanged(connectionData.target.nodeId);

        return connectionId;
    }
    
    drawConnection(connectionData) {
        const sourceNode = this.nodes.get(connectionData.source.nodeId);
        const targetNode = this.nodes.get(connectionData.target.nodeId);

        if (!sourceNode || !targetNode) return;

        const sourceElement = sourceNode.element.querySelector(`.connection-point[data-connection-type="${connectionData.source.type}"][data-connection-name="${connectionData.source.name}"]`);
        const targetElement = targetNode.element.querySelector(`.connection-point[data-connection-type="${connectionData.target.type}"][data-connection-name="${connectionData.target.name}"]`);
        
        if (!sourceElement || !targetElement) {
            // If elements can't be found, it's likely the node was just deleted.
            // We can safely ignore this and the connection will be cleaned up.
            return;
        }

        // Get coordinates using the exact same method as in updateConnectionDrag
        const sourceAbs = this.getAbsoluteCenter(sourceElement);
        const targetAbs = this.getAbsoluteCenter(targetElement);

        const sourceRel = this.getRelativeCoords(sourceAbs.x, sourceAbs.y);
        const targetRel = this.getRelativeCoords(targetAbs.x, targetAbs.y);

        const sourceX = sourceRel.x;
        const sourceY = sourceRel.y;
        const targetX = targetRel.x;
        const targetY = targetRel.y;
        
        // Create SVG path for bezier curve
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        // Calculate control points for smooth curve
        const distance = Math.abs(targetX - sourceX);
        const controlOffset = Math.max(80, distance * 0.4);
        
        const pathData = `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY} ${targetX - controlOffset} ${targetY} ${targetX} ${targetY}`;
        
        path.setAttribute('d', pathData);
        path.setAttribute('class', 'connection-line');
        path.setAttribute('data-connection-id', connectionData.id);
        path.setAttribute('stroke', '#ffffff');
        path.setAttribute('stroke-width', '3');
        path.setAttribute('fill', 'none');
        
        // Remove existing path if it exists
        if (connectionData.element && connectionData.element.parentNode) {
            connectionData.element.remove();
        }
        
        this.connectionsContainer.appendChild(path);
        connectionData.element = path;
        // Apply custom color if present
        this.applyConnectionColor(connectionData);

        // Type compatibility check and styling
        const srcType = this.getPortType(connectionData.source.nodeId, connectionData.source.name, 'output');
        const dstType = this.getPortType(connectionData.target.nodeId, connectionData.target.name, 'input');
        const compatible = this.isTypeCompatible(srcType, dstType);
        this.applyConnectionTypeStyling(connectionData, srcType, dstType, compatible);
        
        // Connection selection and context menu
        path.addEventListener('click', (e) => {
            e.stopPropagation();
            // Ctrl/meta toggles selection, otherwise single-select
            if (e.ctrlKey || e.metaKey) {
                this.toggleConnectionSelection(connectionData.id);
            } else {
                this.selectConnection(connectionData.id, true);
            }
        });

        path.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // If not already selected, select it (single)
            if (!this.selectedConnections.has(connectionData.id)) {
                this.selectConnection(connectionData.id, true);
            }
            const connMenu = document.getElementById('connection-context-menu');
            if (connMenu) {
                // Toggle delete availability based on endpoints' lock state
                const delItem = connMenu.querySelector('[data-action="delete-connection"]');
                if (delItem) {
                    const srcNode = this.nodes.get(connectionData.source.nodeId);
                    const dstNode = this.nodes.get(connectionData.target.nodeId);
                    const srcLocked = !!(srcNode && srcNode.locked);
                    const dstLocked = !!(dstNode && dstNode.locked);
                    if (srcLocked && dstLocked) {
                        delItem.classList.add('disabled');
                        delItem.style.opacity = '0.5';
                    } else {
                        delItem.classList.remove('disabled');
                        delItem.style.opacity = '';
                    }
                }
                this.showContextMenu(connMenu, e.clientX, e.clientY);
            }
        });
    }
    
    updateNodeConnections(nodeId) {
        // Update all connections involving this node
        this.connections.forEach(connection => {
            if (connection.source.nodeId === nodeId || connection.target.nodeId === nodeId) {
                // Refresh connection elements references in case nodes were recreated
                const sourceNode = this.nodes.get(connection.source.nodeId);
                const targetNode = this.nodes.get(connection.target.nodeId);
                
                if (sourceNode && targetNode) {
                    // Find updated connection point elements
                    const sourceElement = sourceNode.element.querySelector(
                        `.connection-point[data-connection-type="${connection.source.type}"][data-connection-name="${connection.source.name}"]`
                    );
                    const targetElement = targetNode.element.querySelector(
                        `.connection-point[data-connection-type="${connection.target.type}"][data-connection-name="${connection.target.name}"]`
                    );
                    
                    if (sourceElement && targetElement) {
                        // Update connection data with fresh element references
                        connection.source.element = sourceElement;
                        connection.target.element = targetElement;
                        
                        // Remove old path and redraw
                        if (connection.element && connection.element.parentNode) {
                            connection.element.remove();
                        }
                        this.drawConnection(connection);
                    }
                }
            }
        });
    }
    
    redrawAllConnections() {
        // Redraw all connections to fix positioning issues
        this.connections.forEach(connection => {
            // Refresh connection elements references in case nodes were recreated
            const sourceNode = this.nodes.get(connection.source.nodeId);
            const targetNode = this.nodes.get(connection.target.nodeId);
            
            if (sourceNode && targetNode) {
                // Find updated connection point elements
                const sourceElement = sourceNode.element.querySelector(
                    `.connection-point[data-connection-type="${connection.source.type}"][data-connection-name="${connection.source.name}"]`
                );
                const targetElement = targetNode.element.querySelector(
                    `.connection-point[data-connection-type="${connection.target.type}"][data-connection-name="${connection.target.name}"]`
                );
                
                if (sourceElement && targetElement) {
                    // Update connection data with fresh element references
                    connection.source.element = sourceElement;
                    connection.target.element = targetElement;
                    
                    // Remove old path and redraw
                    if (connection.element && connection.element.parentNode) {
                        connection.element.remove();
                    }
                    this.drawConnection(connection);
                }
            }
        });
    }
    
    refreshConnectionsAfterTransform() {
        // Debounce frequent refresh calls
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this.redrawAllConnections();
            // Ensure connections stay above nodes
            this.connectionsContainer.style.zIndex = '10';
        }, 10);
    }
    
    selectNode(nodeId, clearOthers = true) {
        if (clearOthers) {
            this.clearSelection();
        }
        
        this.selectedNodes.add(nodeId);
        const node = this.nodes.get(nodeId);
        if (node) {
            node.element.classList.add('selected');
            // Reapply visuals so fx.js can stack selected glow with color
            this.applyNodeVisualStyle(node);
            
            // Update properties panel
            if (window.nodeProperties) {
                window.nodeProperties.showNodeProperties(node);
            }
        }
    }
    
    selectConnection(connectionId, clearOthers = true) {
        if (clearOthers) {
            this.clearSelection();
        }
        this.selectedConnections.add(connectionId);
        const connection = this.connections.get(connectionId);
        if (connection && connection.element) {
            connection.element.classList.add('selected');
            // Clear inline stroke so CSS selected style is visible
            connection.element.style.stroke = '';
        }
    }

    toggleConnectionSelection(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;
        if (this.selectedConnections.has(connectionId)) {
            this.selectedConnections.delete(connectionId);
            if (connection.element) {
                connection.element.classList.remove('selected');
                // Restore custom color if any
                this.applyConnectionColor(connection);
            }
        } else {
            this.selectedConnections.add(connectionId);
            if (connection.element) {
                connection.element.classList.add('selected');
                // Clear inline stroke so CSS selected style is visible
                connection.element.style.stroke = '';
            }
        }
    }
    
    clearSelection() {
        // Clear node selection
        this.selectedNodes.forEach(nodeId => {
            const node = this.nodes.get(nodeId);
            if (node) {
                node.element.classList.remove('selected');
                // Reapply visuals to remove selected glow but keep color visuals
                this.applyNodeVisualStyle(node);
            }
        });
        this.selectedNodes.clear();
        
        // Clear connection selection
        this.selectedConnections.forEach(connectionId => {
            const connection = this.connections.get(connectionId);
            if (connection && connection.element) {
                connection.element.classList.remove('selected');
                // Restore custom color if any
                this.applyConnectionColor(connection);
            }
        });
        this.selectedConnections.clear();
        
        // Clear properties panel
        if (window.nodeProperties) {
            window.nodeProperties.clearProperties();
        }
    }
    
    deleteSelectedNodes() {
        this.selectedNodes.forEach(nodeId => {
            const node = this.nodes.get(nodeId);
            if (node && node.locked) {
                if (window.logger) window.logger.warn(`Delete prevented: node ${nodeId} is locked`);
                return; // skip locked
            }
            this.deleteNode(nodeId);
        });
        this.clearSelection();
    }

    deleteSelectedConnections() {
        this.selectedConnections.forEach(connectionId => {
            const conn = this.connections.get(connectionId);
            if (conn) {
                const srcNode = this.nodes.get(conn.source.nodeId);
                const dstNode = this.nodes.get(conn.target.nodeId);
                const srcLocked = !!(srcNode && srcNode.locked);
                const dstLocked = !!(dstNode && dstNode.locked);
                if (srcLocked && dstLocked) {
                    if (window.logger) window.logger.warn(`Delete prevented: connection ${connectionId} endpoints are locked`);
                    return;
                }
            }
            this.deleteConnection(connectionId);
        });
        this.clearSelection();
    }
    
    deleteNode(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node) return;
        if (node.locked) {
            if (window.logger) window.logger.warn(`Delete prevented: node ${nodeId} is locked`);
            return;
        }
        
        // Remove connections
        const connectionsToRemove = [];
        this.connections.forEach((connection, connectionId) => {
            if (connection.source.nodeId === nodeId || connection.target.nodeId === nodeId) {
                connectionsToRemove.push(connectionId);
            }
        });
        
        connectionsToRemove.forEach(connectionId => {
            this.deleteConnection(connectionId);
        });
        
        // Remove node element and data
        node.element.remove();
        this.nodes.delete(nodeId);
        
        this.updatePerformanceMetrics();
    }
    
    deleteConnection(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;
        // Prevent deletion when both endpoints are locked
        const srcNode = this.nodes.get(connection.source.nodeId);
        const dstNode = this.nodes.get(connection.target.nodeId);
        const sourceLocked = !!(srcNode && srcNode.locked);
        const targetLocked = !!(dstNode && dstNode.locked);
        if (sourceLocked && targetLocked) {
            if (window.logger) window.logger.warn(`Delete prevented: connection ${connectionId} endpoints are locked`);
            return;
        }
        
        // Remove visual element
        if (connection.element) {
            connection.element.remove();
        }
        
        // Remove connected class from connection points
        if (connection.source.element) {
            connection.source.element.classList.remove('connected');
        }
        if (connection.target.element) {
            connection.target.element.classList.remove('connected');
            // Also clear mismatch state/tooltip if present
            connection.target.element.classList.remove('mismatch');
            connection.target.element.removeAttribute('title');
        }
        
        const sourceNodeId = connection.source.nodeId;
        const targetNodeId = connection.target.nodeId;

        // Unindex the connection
        this._unregisterConnectionFromIndex(connection);

        this.connections.delete(connectionId);
        this.updatePerformanceMetrics();

        // Notify properties panel
        this._notifyConnectionsChanged(sourceNodeId);
        this._notifyConnectionsChanged(targetNodeId);
    }

    // Connection indexing helpers
    _getOrCreateIncomingMap(nodeId) {
        if (!this.connectionIndex.incoming.has(nodeId)) {
            this.connectionIndex.incoming.set(nodeId, new Map());
        }
        return this.connectionIndex.incoming.get(nodeId);
    }

    _getOrCreateOutgoingMap(nodeId) {
        if (!this.connectionIndex.outgoing.has(nodeId)) {
            this.connectionIndex.outgoing.set(nodeId, new Map());
        }
        return this.connectionIndex.outgoing.get(nodeId);
    }

    _registerConnectionInIndex(connection) {
        const { source, target, id } = connection;
        // Incoming: target node's input gets single binding (last one wins)
        const incomingMap = this._getOrCreateIncomingMap(target.nodeId);
        incomingMap.set(target.name, connection);

        // Outgoing: source node's output may feed multiple targets
        const outgoingMap = this._getOrCreateOutgoingMap(source.nodeId);
        if (!outgoingMap.has(source.name)) {
            outgoingMap.set(source.name, new Set());
        }
        outgoingMap.get(source.name).add(id);
    }

    _unregisterConnectionFromIndex(connection) {
        const { source, target, id } = connection;
        // Incoming
        const incomingMap = this.connectionIndex.incoming.get(target.nodeId);
        const incomingVal = incomingMap ? incomingMap.get(target.name) : null;
        if (incomingMap && incomingVal && incomingVal.id === id) {
            incomingMap.delete(target.name);
            if (incomingMap.size === 0) this.connectionIndex.incoming.delete(target.nodeId);
        } else if (incomingMap && incomingMap.has(target.name)) {
            // If stored object is different instance but same end, also remove
            const stored = incomingMap.get(target.name);
            if (stored && stored.id === id) {
                incomingMap.delete(target.name);
                if (incomingMap.size === 0) this.connectionIndex.incoming.delete(target.nodeId);
            }
        }

        // Outgoing
        const outgoingMap = this.connectionIndex.outgoing.get(source.nodeId);
        if (outgoingMap && outgoingMap.has(source.name)) {
            const set = outgoingMap.get(source.name);
            set.delete(id);
            if (set.size === 0) {
                outgoingMap.delete(source.name);
            }
            if (outgoingMap.size === 0) this.connectionIndex.outgoing.delete(source.nodeId);
        }
    }

    getIncomingConnections(nodeId) {
        const list = [];
        const incomingMap = this.connectionIndex.incoming.get(nodeId);
        if (!incomingMap) return list;
        incomingMap.forEach((conn, inputName) => {
            list.push({
                connectionId: conn.id,
                inputName,
                fromNodeId: conn.source.nodeId,
                fromPort: conn.source.name
            });
        });
        return list;
    }

    getOutgoingConnections(nodeId) {
        const list = [];
        const outgoingMap = this.connectionIndex.outgoing.get(nodeId);
        if (!outgoingMap) return list;
        outgoingMap.forEach((set, outputName) => {
            set.forEach((connectionId) => {
                const conn = this.connections.get(connectionId);
                if (conn) {
                    list.push({
                        connectionId,
                        outputName,
                        toNodeId: conn.target.nodeId,
                        toPort: conn.target.name
                    });
                }
            });
        });
        return list;
    }

    getInputBinding(nodeId, inputName) {
        const incomingMap = this.connectionIndex.incoming.get(nodeId);
        if (!incomingMap) return null;
        const conn = incomingMap.get(inputName);
        if (!conn) return null;
        return {
            connectionId: conn.id,
            fromNodeId: conn.source.nodeId,
            fromPort: conn.source.name
        };
    }

    _notifyConnectionsChanged(nodeId) {
        if (window.nodeProperties && window.nodeProperties.currentNode && window.nodeProperties.currentNode.id === nodeId) {
            if (typeof window.nodeProperties.refreshConnections === 'function') {
                window.nodeProperties.refreshConnections(nodeId);
            } else {
                window.nodeProperties.showNodeProperties(window.nodeProperties.currentNode);
            }
        }
    }
    
    handleKeyDown(e) {
        // Do not intercept key events while typing in inputs/textareas or contentEditable fields
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
            return;
        }
        switch (e.key) {
            case 'Delete':
            case 'Backspace':
                e.preventDefault();
                if (this.selectedConnections && this.selectedConnections.size > 0) {
                    this.deleteSelectedConnections();
                } else {
                    this.deleteSelectedNodes();
                }
                break;
            case 'a':
            case 'A':
                if (e.ctrlKey) {
                    e.preventDefault();
                    this.selectAll();
                }
                break;
            case 'c':
            case 'C':
                if (e.ctrlKey) {
                    e.preventDefault();
                    this.copySelectedNodes();
                }
                break;
            case 'v':
            case 'V':
                if (e.ctrlKey) {
                    e.preventDefault();
                    this.pasteNodes();
                }
                break;
        }
    }
    
    handleWheel(e) {
        e.preventDefault();
        
        const scaleSpeed = 0.1;
        const prevScale = this.canvasTransform.scale;
        const scaleDelta = e.deltaY > 0 ? -scaleSpeed : scaleSpeed;
        const newScale = Math.max(0.1, Math.min(3.0, prevScale + scaleDelta));
        if (newScale === prevScale) return;

        // Anchor zoom at the center of the canvas viewport to avoid drift
        const rect = this.canvas.getBoundingClientRect();
        const centerClientX = rect.left + rect.width / 2;
        const centerClientY = rect.top + rect.height / 2;

        // World coords of the viewport center before scaling
        const centerWorld = this.viewportToCanvas(centerClientX, centerClientY);

        // Apply new scale
        this.canvasTransform.scale = newScale;

        // Recompute translation so the same world point remains at viewport center
        this.canvasTransform.x = (centerClientX - rect.left) - centerWorld.x * newScale;
        this.canvasTransform.y = (centerClientY - rect.top) - centerWorld.y * newScale;

        this.applyCanvasTransform();
        this.refreshConnectionsAfterTransform();
    }
    
    selectAll() {
        this.clearSelection();
        this.nodes.forEach((node, nodeId) => {
            this.selectedNodes.add(nodeId);
            node.element.classList.add('selected');
            this.applyNodeVisualStyle(node);
        });
    }
    
    copySelectedNodes() {
        // Implementation for copying nodes would go here
        console.log('Copy nodes:', Array.from(this.selectedNodes));
    }
    
    pasteNodes() {
        // Implementation for pasting nodes would go here
        console.log('Paste nodes');
    }
    
    duplicateSelectedNodes() {
        // Implementation for duplicating nodes would go here
        console.log('Duplicate nodes:', Array.from(this.selectedNodes));
    }
    
    clearCanvas(showConfirm = true) {
        if (showConfirm) {
            if (!confirm('Are you sure you want to clear the canvas? This cannot be undone.')) {
                return;
            }
        }
        this.nodes.clear();
        this.connections.clear();
        // Reset fast lookup indexes
        if (this.connectionIndex) {
            this.connectionIndex.incoming.clear();
            this.connectionIndex.outgoing.clear();
        }
        this.nodesContainer.innerHTML = '';
        this.connectionsContainer.innerHTML = '';
        this.clearSelection();
        this.updatePerformanceMetrics();
    }
    
    showContextMenu(menu, x, y) {
        this.hideContextMenus();
        // Position then clamp to viewport
        menu.style.display = 'block';
        // First place roughly at requested position
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        // Compute size and ensure on-screen
        const rect = menu.getBoundingClientRect();
        const margin = 8;
        let left = x;
        let top = y;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (rect.right > vw - margin) {
            left = Math.max(margin, vw - rect.width - margin);
        }
        if (rect.bottom > vh - margin) {
            top = Math.max(margin, vh - rect.height - margin);
        }
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }
    
    getAbsoluteCenter(element) {
        const rect = element.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }

    getRelativeCoords(absX, absY) {
        const svgRect = this.connectionsContainer.getBoundingClientRect();
        const relX = (absX - svgRect.left) / this.canvasTransform.scale;
        const relY = (absY - svgRect.top) / this.canvasTransform.scale;
        return { x: relX, y: relY };
    }

    viewportToCanvas(x, y) {
        const canvasRect = this.canvas.getBoundingClientRect();
        const canvasX = (x - canvasRect.left - this.canvasTransform.x) / this.canvasTransform.scale;
        const canvasY = (y - canvasRect.top - this.canvasTransform.y) / this.canvasTransform.scale;
        return { x: canvasX, y: canvasY };
    }

    // Clamp a position to the fixed world bounds (if enabled)
    clampToWorld(x, y, width = 0, height = 0) {
        if (!this.useFixedWorld) return { x, y };
        const s = this.worldSize;
        const maxX = Math.max(0, s - width);
        const maxY = Math.max(0, s - height);
        return {
            x: Math.max(0, Math.min(x, maxX)),
            y: Math.max(0, Math.min(y, maxY))
        };
    }

    hideContextMenus() {
        document.querySelectorAll('.context-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    }
    
    updateCanvasBounds() {
        if (this.nodes.size === 0) return;
        // In fixed-world mode, keep containers at world size and do not shrink
        if (this.useFixedWorld) {
            const s = this.worldSize;
            this.connectionsContainer.style.width = `${s}px`;
            this.connectionsContainer.style.height = `${s}px`;
            this.connectionsContainer.style.left = `0px`;
            this.connectionsContainer.style.top = `0px`;
            this.connectionsContainer.setAttribute('viewBox', `0 0 ${s} ${s}`);
            // Keep nodes container dimensions in sync for hit-testing
            this.nodesContainer.style.width = `${s}px`;
            this.nodesContainer.style.height = `${s}px`;
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const padding = 200; // Extra space around the nodes

        this.nodes.forEach(node => {
            const x = node.position.x;
            const y = node.position.y;
            const width = node.element.offsetWidth;
            const height = node.element.offsetHeight;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + width);
            maxY = Math.max(maxY, y + height);
        });

        const canvasWidth = (maxX - minX) + padding * 2;
        const canvasHeight = (maxY - minY) + padding * 2;
        const offsetX = -minX + padding;
        const offsetY = -minY + padding;

        // Update the SVG container's size and position
        this.connectionsContainer.style.width = `${canvasWidth}px`;
        this.connectionsContainer.style.height = `${canvasHeight}px`;
        this.connectionsContainer.style.left = `${minX - padding}px`;
        this.connectionsContainer.style.top = `${minY - padding}px`;

        // Update the viewBox to match the new coordinate system
        this.connectionsContainer.setAttribute('viewBox', `0 0 ${canvasWidth} ${canvasHeight}`);
        // Note: Do not apply an extra translate to nodesContainer here. Both layers
        // are already kept in sync by applyCanvasTransform(). Adding a nodes-only
        // transform would desynchronize coordinate spaces and clip wires.
    }


    applyCanvasTransform() {
        const transform = `translate(${this.canvasTransform.x}px, ${this.canvasTransform.y}px) scale(${this.canvasTransform.scale})`;
        this.nodesContainer.style.transform = transform;
        this.connectionsContainer.style.transform = transform;
        if (this.grid && typeof this.grid.update === 'function') {
            this.grid.update(this.canvasTransform);
        }
    }

    checkForAutoPan(e) {
        const edgeThreshold = 100; // px from edge to start panning
        const maxPanSpeed = 15; // pixels per frame

        const clientX = e.clientX;
        const clientY = e.clientY;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let panX = 0;
        let panY = 0;

        // Check horizontal edges
        if (clientX < edgeThreshold) {
            panX = (edgeThreshold - clientX) / edgeThreshold * maxPanSpeed;
        } else if (clientX > viewportWidth - edgeThreshold) {
            panX = (clientX - (viewportWidth - edgeThreshold)) / edgeThreshold * -maxPanSpeed;
        }

        // Check vertical edges
        if (clientY < edgeThreshold) {
            panY = (edgeThreshold - clientY) / edgeThreshold * maxPanSpeed;
        } else if (clientY > viewportHeight - edgeThreshold) {
            panY = (clientY - (viewportHeight - edgeThreshold)) / edgeThreshold * -maxPanSpeed;
        }

        this.dragState.autoPanSpeed.x = panX;
        this.dragState.autoPanSpeed.y = panY;

        if (panX !== 0 || panY !== 0) {
            if (!this.dragState.isAutoPanning) {
                this.dragState.isAutoPanning = true;
                requestAnimationFrame(() => this.autoPanLoop());
            }
        } else {
            this.dragState.isAutoPanning = false;
        }
    }

    autoPanLoop() {
        if (!this.dragState.isAutoPanning || (this.dragState.autoPanSpeed.x === 0 && this.dragState.autoPanSpeed.y === 0)) {
            this.dragState.isAutoPanning = false;
            return;
        }

        // Update canvas transform
        this.canvasTransform.x += this.dragState.autoPanSpeed.x;
        this.canvasTransform.y += this.dragState.autoPanSpeed.y;

        this.applyCanvasTransform();

        // Manually update the node being dragged to counteract the pan and keep it under the cursor
        const dx = -this.dragState.autoPanSpeed.x / this.canvasTransform.scale;
        const dy = -this.dragState.autoPanSpeed.y / this.canvasTransform.scale;
        const node = this.dragState.draggedNode;
        if (node) {
            const rawX = node.position.x + dx;
            const rawY = node.position.y + dy;
            const w = node.element.offsetWidth;
            const h = node.element.offsetHeight;
            const { x, y } = this.clampToWorld(rawX, rawY, w, h);
            node.position.x = x;
            node.position.y = y;
            node.element.style.left = `${x}px`;
            node.element.style.top = `${y}px`;
        }

        this.updateNodeConnections(this.dragState.draggedNode.id);

        // Continue the loop
        requestAnimationFrame(() => this.autoPanLoop());
    }

    resetDragState() {
        this.dragState = {
            isDragging: false,
            dragMode: 'none',
            startX: 0,
            startY: 0,
            dragOffset: { x: 0, y: 0 },
            draggedNode: null,
            connectionStart: null,
            isAutoPanning: false,
            autoPanSpeed: { x: 0, y: 0 }
        };
    }
    
    updatePerformanceMetrics() {
        const nodeCountElement = document.getElementById('node-count');
        const connectionCountElement = document.getElementById('connection-count');
        
        if (nodeCountElement) {
            nodeCountElement.textContent = this.nodes.size;
        }
        if (connectionCountElement) {
            connectionCountElement.textContent = this.connections.size;
        }
        
        // Also update main app metrics if available
        if (this.mainApp && this.mainApp.updatePerformanceMetrics) {
            this.mainApp.updatePerformanceMetrics();
        }
    }
    
    // Workflow serialization methods
    exportWorkflow() {
        const workflowData = {
            workflow_id: `workflow_${Date.now()}`,
            created: new Date().toISOString(),
            nodes: [],
            connections: []
        };
        
        // Export nodes with complete data
        const nodeObjById = new Map();
        this.nodes.forEach(node => {
            const nodeObj = {
                id: node.id,
                type: node.type,
                position: {
                    x: node.position.x,
                    y: node.position.y
                },
                properties: { ...node.properties }, // Create a copy
                definition: {
                    name: node.definition.name,
                    type: node.definition.type,
                    category: node.definition.category,
                    description: node.definition.description,
                    inputs: node.definition.inputs || [],
                    outputs: node.definition.outputs || [],
                    properties: node.definition.properties || {}
                },
                locked: !!node.locked,
                color: node.color || null,
                // Filled below
                input_bindings: {}
            };
            workflowData.nodes.push(nodeObj);
            nodeObjById.set(node.id, nodeObj);
        });
        
        // Export connections with complete data
        this.connections.forEach(connection => {
            const conn = {
                id: connection.id,
                source: {
                    nodeId: connection.source.nodeId,
                    name: connection.source.name,
                    type: connection.source.type
                },
                target: {
                    nodeId: connection.target.nodeId,
                    name: connection.target.name,
                    type: connection.target.type
                },
                color: connection.color || null
            };
            workflowData.connections.push(conn);
            
            // Populate per-node input_bindings
            const targetNode = nodeObjById.get(conn.target.nodeId);
            if (targetNode) {
                targetNode.input_bindings = targetNode.input_bindings || {};
                targetNode.input_bindings[conn.target.name] = {
                    fromNodeId: conn.source.nodeId,
                    fromPort: conn.source.name
                };
            }
        });

        // Compute execution order (topological sort)
        workflowData.execution_order = this.computeExecutionOrder(workflowData);
        
        return workflowData;
    }

    // Topological sort to determine a safe execution order
    computeExecutionOrder(workflowData) {
        const nodes = workflowData.nodes.map(n => n.id);
        const indegree = new Map(nodes.map(id => [id, 0]));
        const adj = new Map(nodes.map(id => [id, []]));

        workflowData.connections.forEach(conn => {
            const u = conn.source.nodeId;
            const v = conn.target.nodeId;
            if (!adj.has(u)) adj.set(u, []);
            adj.get(u).push(v);
            indegree.set(v, (indegree.get(v) || 0) + 1);
        });

        const queue = [];
        indegree.forEach((deg, id) => { if (deg === 0) queue.push(id); });

        const order = [];
        let idx = 0;
        while (idx < queue.length) {
            const u = queue[idx++];
            order.push(u);
            const neighbors = adj.get(u) || [];
            neighbors.forEach(v => {
                indegree.set(v, indegree.get(v) - 1);
                if (indegree.get(v) === 0) queue.push(v);
            });
        }

        // If cycle exists, order will be shorter than nodes
        if (order.length !== nodes.length) {
            if (window.logger) {
                window.logger.warn('Cycle detected or unresolved dependencies in graph. Execution order may be partial.');
            }
        }
        return order;
    }
    
    importWorkflow(workflowData) {
        // Don't clear canvas if user cancels
        const shouldClear = this.nodes.size === 0 || confirm('This will replace the current workflow. Continue?');
        if (!shouldClear) return;
        
        this.clearCanvas(false);
        
        const nodeIdMapping = new Map(); // Map old IDs to new IDs
        let createdNodeCount = 0;
        let skippedNodeCount = 0;
        
        // Import nodes first
        if (workflowData.nodes) {
            workflowData.nodes.forEach(nodeData => {
                try {
                    const definition = nodeData.definition || (window.nodePalette && window.nodePalette.getNodeDefinition ? window.nodePalette.getNodeDefinition(nodeData.type) : null);
                    if (!definition) {
                        skippedNodeCount++;
                        if (window.logger) window.logger.warn(`Import: missing definition for node type '${nodeData.type}', skipping node ${nodeData.id}`);
                        return;
                    }
                    const newX = (nodeData.position && nodeData.position.x != null) ? nodeData.position.x : 0;
                    const newY = (nodeData.position && nodeData.position.y != null) ? nodeData.position.y : 0;
                    const newNodeId = this.createNode(definition, newX, newY);
                    const node = this.nodes.get(newNodeId);
                    if (node && nodeData.properties) {
                        // Copy properties
                        node.properties = { ...nodeData.properties };
                        
                        // Safely refresh properties panel if needed
                        if (window.nodeProperties && typeof window.nodeProperties.refreshProperties === 'function') {
                            window.nodeProperties.refreshProperties();
                        }
                    }
                    // Apply locked state from imported data
                    if (node && nodeData.locked) {
                        node.locked = true;
                        if (node.element) node.element.classList.add('locked');
                    }
                    // Apply node color if provided
                    if (node && nodeData.color) {
                        node.color = nodeData.color;
                        this.applyNodeVisualStyle(node);
                    }
                    // Map old ID to new ID for connection restoration
                    nodeIdMapping.set(nodeData.id, newNodeId);
                    createdNodeCount++;
                } catch (err) {
                    skippedNodeCount++;
                    console.error('Error creating node during import:', err, nodeData);
                    if (window.logger) {
                        const nid = (nodeData && nodeData.id) ? nodeData.id : '';
                        const emsg = (err && err.message) ? err.message : String(err);
                        window.logger.error('Import: failed to create node ' + nid + ': ' + emsg);
                    }
                }
            });
            if (window.logger) window.logger.info(`Import: created ${createdNodeCount} node(s), skipped ${skippedNodeCount}`);
        }
        
        // Import connections after all nodes are created
        if (workflowData.connections) {
            setTimeout(() => {
                let createdConn = 0;
                let skippedConn = 0;
                workflowData.connections.forEach(connectionData => {
                    try {
                        const sourceNodeId = nodeIdMapping.get(connectionData.source.nodeId);
                        const targetNodeId = nodeIdMapping.get(connectionData.target.nodeId);
                        if (!sourceNodeId || !targetNodeId) {
                            skippedConn++;
                            return;
                        }
                        const sourceNode = this.nodes.get(sourceNodeId);
                        const targetNode = this.nodes.get(targetNodeId);
                        if (!sourceNode || !targetNode) {
                            skippedConn++;
                            return;
                        }
                        // Find connection points
                        const sourceElement = sourceNode.element.querySelector(
                            `.connection-point[data-connection-type="${connectionData.source.type}"][data-connection-name="${connectionData.source.name}"]`
                        );
                        const targetElement = targetNode.element.querySelector(
                            `.connection-point[data-connection-type="${connectionData.target.type}"][data-connection-name="${connectionData.target.name}"]`
                        );
                        if (!sourceElement || !targetElement) {
                            skippedConn++;
                            return;
                        }
                        const source = {
                            element: sourceElement,
                            nodeId: sourceNodeId,
                            type: connectionData.source.type,
                            name: connectionData.source.name
                        };
                        const target = {
                            element: targetElement,
                            nodeId: targetNodeId,
                            type: connectionData.target.type,
                            name: connectionData.target.name
                        };
                        const newConnId = this.createConnection(source, target);
                        // Restore connection color if present
                        if (newConnId && connectionData.color) {
                            const conn = this.connections.get(newConnId);
                            if (conn) {
                                conn.color = connectionData.color;
                                this.applyConnectionColor(conn);
                            }
                        }
                        createdConn++;
                    } catch (err) {
                        skippedConn++;
                        console.error('Error creating connection during import:', err, connectionData);
                        if (window.logger) {
                            const emsg = (err && err.message) ? err.message : String(err);
                            window.logger.error('Import: failed to create connection: ' + emsg);
                        }
                    }
                });
                if (window.logger) window.logger.info(`Import: created ${createdConn} connection(s), skipped ${skippedConn}`);
                
                // Update canvas bounds and redraw connections
                this.updateCanvasBounds();
                this.redrawAllConnections();
            }, 100); // Small delay to ensure DOM is ready
        }
    }
}

// Export for use in other modules
window['WorkflowCanvas'] = WorkflowCanvas;
