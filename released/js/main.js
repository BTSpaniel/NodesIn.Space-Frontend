/**
 * Main Application Entry Point
 * Initializes all components and manages global application state
 */
class VisualAGINodeEditor {
    constructor() {
        this.webSocket = null;
        this.nodePalette = null;
        this.workflowCanvas = null;
        this.nodeProperties = null;
        this.logManager = null;
        this.importExport = null;
        this.execution = null;
        
        this.isInitialized = false;
        this.currentWorkflow = null;
        
        // Splash overlay control
        this.splashDelayMs = 60000; // delay after successful backend connection before dismissing splash
        this.splashDismissed = false;
        
        this.initialize();
    }
    
    async initialize() {
        try {
            console.log('Initializing Visual AGI Node Editor...');
            
            // Initialize core components
            this.initializeLogManager();
            this.initializeNodePalette();
            this.initializeWebSocket();
            this.initializeWorkflowCanvas();
            this.initializeNodeProperties();
            this.initializeWorkflowModules();
            
            // Setup global event listeners
            this.setupGlobalEventListeners();
            this.setupApplicationEvents();
            
            // Initialize UI state
            this.initializeUI();
            // If ad preview/demo is requested, dismiss splash immediately to expose the slot
            try {
                const qp = (typeof window !== 'undefined' && window.location && window.location.search)
                    ? new URLSearchParams(window.location.search)
                    : null;
                const previewRequested = qp && (
                    qp.get('ad_preview') === '1' || qp.get('ad_preview') === 'true' || qp.has('ad_preview') ||
                    qp.get('ad_demo') === '1' || qp.get('ad_demo') === 'true' || qp.has('ad_demo')
                );
                if (previewRequested) {
                    this.hideSplashOverlay(0);
                }
            } catch (__) { /* ignore */ }
            
            this.isInitialized = true;
            this.logManager.addLog('info', 'Visual AGI Node Editor initialized successfully');
            
            // Request available nodes from backend
            if (this.webSocket) {
                this.webSocket.getAvailableNodes();
            }
            
        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.showErrorMessage('Failed to initialize application: ' + error.message);
        }
    }
    
    initializeLogManager() {
        this.logManager = new LogManager();
        window.logManager = this.logManager; // Make globally available
    }
    
    initializeWebSocket() {
        const wsUrl = (window.location.protocol === 'https:'
            ? 'wss://ws.nodesin.space'
            : 'ws://localhost:8001');
        const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const deadlineMs = 8000;
        const tryInit = () => {
            const WWS = (typeof window !== 'undefined' && window.WorkflowWebSocket)
                ? window.WorkflowWebSocket
                : (typeof WorkflowWebSocket !== 'undefined' ? WorkflowWebSocket : null);
            if (WWS) {
                try {
                    console.log('[WS] Connecting to', wsUrl);
                    this.webSocket = new WWS(wsUrl);
                    window.webSocket = this.webSocket; // Make globally available
                    this.setupWebSocketHandlers();
                    // Wire WebSocket into import/export manager for backend persistence
                    if (this.importExport && typeof this.importExport.setWebSocket === 'function') {
                        this.importExport.setWebSocket(this.webSocket);
                    }
                } catch (e) {
                    console.error('Failed to initialize WebSocket:', e);
                }
                return;
            }
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if ((now - start) < deadlineMs) {
                setTimeout(tryInit, 25);
            } else {
                // Keep trying at a slower rate to tolerate very slow script loads
                setTimeout(tryInit, 250);
            }
        };
        // Kick off shortly after DOMContentLoaded
        setTimeout(tryInit, 250);
    }
    
    setupWebSocketHandlers() {
        
        if (!this.webSocket) return;
        
        // Setup WebSocket event handlers
        this.webSocket.on('open', () => {
            this.logManager.addLog('info', 'Connected to AGI backend');
            // Dismiss splash shortly after successful connection
            this.hideSplashOverlay(this.splashDelayMs);
        });
        
        this.webSocket.on('close', () => {
            this.logManager.addLog('warning', 'Disconnected from AGI backend');
        });
        
        this.webSocket.on('error', (error) => {
            this.logManager.addLog('error', 'WebSocket error: ' + error.message);
        });
        
        this.webSocket.on('node_execution_start', (data) => {
            this.handleNodeExecutionStart(data);
        });
        
        this.webSocket.on('node_execution_complete', (data) => {
            this.handleNodeExecutionComplete(data);
        });
        
        this.webSocket.on('workflow_complete', (data) => {
            this.handleWorkflowComplete(data);
        });
        
        this.webSocket.on('execution_error', (data) => {
            this.handleExecutionError(data);
        });
    }

    setupExecutionEventHandlers() {
        if (!this.execution) return;

        // Forward WebSocket events to execution manager
        const eventTypes = [
            'node_execution_start',
            'node_execution_complete', 
            'node_execution_error',
            'workflow_complete',
            'execution_error',
            'execution_progress'
        ];

        eventTypes.forEach(eventType => {
            if (this.webSocket) {
                this.webSocket.on(eventType, (data) => {
                    this.execution.handleExecutionEvent({
                        type: eventType,
                        data: data
                    });
                });
            }
        });
    }
    
    initializeNodePalette() {
        // Prefer global export on window to be resilient to bundling/obfuscation wrappers
        const NP = (typeof window !== 'undefined' && window.NodePalette)
            ? window.NodePalette
            : (typeof NodePalette !== 'undefined' ? NodePalette : null);
        if (!NP) {
            console.error('NodePalette is not defined');
            return;
        }
        this.nodePalette = new NP();
        window.nodePalette = this.nodePalette; // Make globally available
    }
    
    initializeWorkflowCanvas() {
        this.workflowCanvas = new WorkflowCanvas();
        window.workflowCanvas = this.workflowCanvas; // Make globally available
        
        // Set reference to main app for performance metric updates
        this.workflowCanvas.mainApp = this;
    }
    
    initializeNodeProperties() {
        this.nodeProperties = new NodeProperties();
        window.nodeProperties = this.nodeProperties; // Make globally available
        
        // Listen for property changes
        this.nodeProperties.on('propertyChanged', (data) => {
            this.logManager.addLog('debug', `Node ${data.nodeId} property '${data.property}' changed to: ${data.value}`);
        });
    }

    initializeWorkflowModules() {
        const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const deadlineMs = 8000;
        const tryIE = () => {
            const WIE = (typeof window !== 'undefined' && window.WorkflowImportExport)
                ? window.WorkflowImportExport
                : (typeof WorkflowImportExport !== 'undefined' ? WorkflowImportExport : null);
            if (WIE) {
                try {
                    // Initialize import/export manager
                    this.importExport = new WIE(this.workflowCanvas, this.webSocket);
                    window.workflowImportExport = this.importExport; // Make globally available
                } catch (e) {
                    console.error('Failed to initialize Import/Export module:', e);
                    // Retry a bit later
                    setTimeout(tryIE, 250);
                    return;
                }
                // Initialize execution manager (after WebSocket is ready)
                const initExec = () => {
                    try {
                        this.execution = new WorkflowExecution(this.workflowCanvas, this.webSocket);
                        window.workflowExecution = this.execution; // Make globally available
                        // Setup execution event handlers
                        this.setupExecutionEventHandlers();
                    } catch (e) {
                        // If execution class isn’t ready yet, retry soon
                        setTimeout(initExec, 250);
                        return;
                    }
                };
                setTimeout(initExec, 600); // a bit after WS init
                return;
            }
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if ((now - start) < deadlineMs) {
                setTimeout(tryIE, 25);
            } else {
                // Keep trying at a slower pace if still not ready
                setTimeout(tryIE, 250);
            }
        };
        setTimeout(tryIE, 200);
    }
    
    setupGlobalEventListeners() {
        // Menu bar buttons (avoid optional chaining for Closure Compiler compatibility)
        const btnNew = document.getElementById('new-workflow');
        if (btnNew) {
            btnNew.addEventListener('click', () => { this.newWorkflow(); });
        }

        const btnSave = document.getElementById('save-workflow');
        if (btnSave) {
            btnSave.addEventListener('click', () => { this.saveWorkflow(); });
        }

        const btnLoad = document.getElementById('load-workflow');
        if (btnLoad) {
            btnLoad.addEventListener('click', () => { this.loadWorkflow(); });
        }

        const btnExec = document.getElementById('execute-workflow');
        if (btnExec) {
            btnExec.addEventListener('click', () => { this.executeWorkflow(); });
        }
        
        // Tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const target = e.currentTarget || e.target;
                const tab = target && target.dataset ? target.dataset.tab : null;
                if (tab) {
                    this.switchTab(tab);
                }
            });
        });

        // Keyboard shortcuts -> block when splash active (handled in handler)
        document.addEventListener('keydown', (e) => {
            this.handleGlobalKeyDown(e);
        });

        // Window lifecycle events
        window.addEventListener('beforeunload', (e) => {
            if (this.hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            }
        });
        window.addEventListener('resize', () => {
            this.handleWindowResize();
        });

        // Allow splash iframe to request dismissal after user click.
        // Previously we required backend connection to dismiss. That can leave a blank
        // screen if the iframe hides itself but the parent overlay stays. Now we always
        // dismiss, and log a warning if backend is not connected yet.
        window.addEventListener('message', (e) => {
            try {
                const data = e && e.data;
                if (data && data.type === 'splashDismissRequest') {
                    if (!this.webSocket || !this.webSocket.isConnected) {
                        this.logManager && this.logManager.addLog('warning', 'Dismissing splash before backend connection');
                    }
                    this.hideSplashOverlay(0);
                }
            } catch (_) { /* ignore */ }
        });
    }
    
    setupApplicationEvents() {
        // Custom application events can be set up here
        document.addEventListener('nodeExecutionUpdate', (e) => {
            this.updateNodeExecutionStatus(e.detail);
        });
        
        document.addEventListener('workflowValidationError', (e) => {
            this.handleValidationError(e.detail);
        });
    }
    
    initializeUI() {
        // Set initial UI state
        this.updateExecutionButton();
        this.updatePerformanceMetrics();
        
        // Initialize tab system - make sure execution log is active by default
        this.switchTab('execution');
        
        // Initialize log panels
        this.logManager.addLog('info', 'Visual AGI Node Editor ready');
        this.logManager.addLog('debug', 'Drag nodes from the palette to the canvas to start building your workflow');
    }
    
    // Workflow Management
    newWorkflow() {
        if (this.hasUnsavedChanges()) {
            if (!confirm('You have unsaved changes. Create new workflow anyway?')) {
                return;
            }
        }
        
        this.workflowCanvas.clearCanvas();
        this.currentWorkflow = {
            id: this.generateWorkflowId(),
            name: 'Untitled Workflow',
            created: new Date(),
            modified: new Date(),
            nodes: [],
            connections: []
        };
        
        this.logManager.addLog('info', 'New workflow created');
        this.updateWorkflowTitle();
    }
    
    async saveWorkflow() {
        console.log('Save workflow clicked');
        
        if (!this.importExport) {
            console.log('Import/Export module not initialized');
            this.logManager.addLog('error', 'Import/Export module not initialized');
            return;
        }

        try {
            console.log('Calling importExport.saveWorkflow()');
            const result = await this.importExport.saveWorkflow();
            console.log('Save result:', result);
            
            if (result.success) {
                this.currentWorkflow = result.workflow;
                this.updateWorkflowTitle();
                this.showInfoMessage(result.message);
            } else {
                this.showErrorMessage(result.error || 'Failed to save workflow');
            }
        } catch (error) {
            console.error('Error in saveWorkflow:', error);
            this.showErrorMessage('Error saving workflow: ' + error.message);
        }
    }
    
    async loadWorkflow() {
        if (!this.importExport) {
            this.logManager.addLog('error', 'Import/Export module not initialized');
            return;
        }

        if (this.hasUnsavedChanges()) {
            if (!confirm('You have unsaved changes. Load workflow anyway?')) {
                return;
            }
        }

        try {
            const result = await this.importExport.loadWorkflow();
            if (result.success) {
                this.currentWorkflow = result.workflow;
                this.updateWorkflowTitle();
                this.showInfoMessage(result.message);
            } else {
                this.showInfoMessage(result.message || 'No workflow selected');
            }
        } catch (error) {
            this.showErrorMessage('Error loading workflow: ' + error.message);
        }
    }
    
    async executeWorkflow() {
        if (!this.execution) {
            this.logManager.addLog('error', 'Execution module not initialized');
            return;
        }

        // Check if already running and handle stop request
        if (this.execution.executionState === 'running') {
            await this.execution.stopExecution();
            return;
        }

        try {
            const result = await this.execution.executeWorkflow({
                debugMode: false, // Could be made configurable
                stepByStep: false
            });

            if (result.success) {
                this.showInfoMessage(result.message);
            } else {
                this.showErrorMessage(result.message || result.error || 'Execution failed');
            }
        } catch (error) {
            this.showErrorMessage('Error executing workflow: ' + error.message);
        }
    }
    
    stopExecution() {
        if (this.webSocket) {
            this.webSocket.stopExecution();
        }
        
        this.executionState = 'idle';
        this.updateExecutionButton();
        this.logManager.addLog('info', 'Workflow execution stopped');
    }
    
    // Execution Event Handlers
    handleNodeExecutionStart(data) {
        const node = this.workflowCanvas.nodes.get(data.nodeId);
        if (node) {
            node.element.classList.add('executing');
        }
        this.logManager.addLog('info', `Executing node: ${data.nodeId}`);
    }
    
    handleNodeExecutionComplete(data) {
        const node = this.workflowCanvas.nodes.get(data.nodeId);
        if (node) {
            node.element.classList.remove('executing');
        }
        this.logManager.addLog('info', `Node completed: ${data.nodeId}`);
        
        // Update execution time
        if (data.executionTime) {
            document.getElementById('execution-time').textContent = `${data.executionTime}ms`;
        }
    }
    
    handleWorkflowComplete(data) {
        this.executionState = 'idle';
        this.updateExecutionButton();
        this.logManager.addLog('info', 'Workflow execution completed successfully');
        
        if (data.totalExecutionTime) {
            document.getElementById('execution-time').textContent = `${data.totalExecutionTime}ms`;
        }
    }
    
    handleExecutionError(data) {
        this.executionState = 'error';
        this.updateExecutionButton();
        this.logManager.addLog('error', `Execution error: ${data.error}`);
        
        if (data.nodeId) {
            const node = this.workflowCanvas.nodes.get(data.nodeId);
            if (node) {
                node.element.classList.remove('executing');
                node.element.classList.add('error');
                setTimeout(() => {
                    node.element.classList.remove('error');
                }, 3000);
            }
        }
    }
    
    // Validation
    validateWorkflow(workflowData) {
        const errors = [];
        
        // Check if workflow has nodes
        if (!workflowData.nodes || workflowData.nodes.length === 0) {
            errors.push('Workflow must contain at least one node');
        }
        
        // Validate individual nodes
        workflowData.nodes.forEach(nodeData => {
            const node = this.workflowCanvas.nodes.get(nodeData.id);
            if (node) {
                const nodeValidation = this.nodeProperties.validateProperties(node);
                if (!nodeValidation.valid) {
                    errors.push(`Node ${nodeData.id}: ${nodeValidation.errors.join(', ')}`);
                }
            }
        });
        
        // Check for circular dependencies
        if (this.hasCircularDependencies(workflowData)) {
            errors.push('Workflow contains circular dependencies');
        }
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
    
    hasCircularDependencies(workflowData) {
        // Simple cycle detection using DFS
        const visited = new Set();
        const recursionStack = new Set();
        
        const hasCycle = (nodeId) => {
            if (recursionStack.has(nodeId)) {
                return true;
            }
            if (visited.has(nodeId)) {
                return false;
            }
            
            visited.add(nodeId);
            recursionStack.add(nodeId);
            
            // Find all connections from this node
            const outgoingConnections = workflowData.connections.filter(c => c.source.nodeId === nodeId);
            for (const connection of outgoingConnections) {
                if (hasCycle(connection.target.nodeId)) {
                    return true;
                }
            }
            
            recursionStack.delete(nodeId);
            return false;
        };
        
        for (const node of workflowData.nodes) {
            if (hasCycle(node.id)) {
                return true;
            }
        }
        
        return false;
    }
    
    // UI Updates
    updateExecutionButton() {
        if (this.execution) {
            // Delegate to execution module
            this.execution.updateExecutionUI();
        } else {
            // Fallback to original logic
            const button = document.getElementById('execute-workflow');
            if (!button) return;
            
            button.textContent = 'Execute';
            button.className = 'btn btn-primary';
        }
    }
    
    updateWorkflowTitle() {
        const title = this.currentWorkflow ? this.currentWorkflow.name : 'Visual AGI Node Editor';
        document.title = title;
    }
    
    updatePerformanceMetrics() {
        // Update performance metrics display
        if (this.workflowCanvas) {
            const nodeCount = this.workflowCanvas.nodes.size;
            const connectionCount = this.workflowCanvas.connections.size;
            
            // Update DOM elements
            const nodeCountElement = document.getElementById('node-count');
            const connectionCountElement = document.getElementById('connection-count');
            
            if (nodeCountElement) {
                nodeCountElement.textContent = nodeCount;
            }
            if (connectionCountElement) {
                connectionCountElement.textContent = connectionCount;
            }
        }
    }
    
    // Splash Overlay Handling: keep blocking UI until backend connects
    hideSplashOverlay(delayMs = 800) {
        if (this.splashDismissed) return;
        const overlay = document.getElementById('splash-overlay');
        if (!overlay) {
            this.splashDismissed = true;
            try { this.tryShowSponsoredNode(); } catch (e) {}
            return;
        }
        try {
            setTimeout(() => {
                // Add CSS class to fade out, then remove from DOM
                overlay.classList.add('hidden');
                const removeAfter = () => {
                    if (!this.splashDismissed) {
                        this.splashDismissed = true;
                    }
                    // Guard if already removed
                    if (overlay && overlay.parentNode) {
                        overlay.parentNode.removeChild(overlay);
                    }
                    // After overlay is gone, optionally show a sponsored node (production + configured only)
                    try { this.tryShowSponsoredNode(); } catch (e) {}
                    overlay.removeEventListener('transitionend', removeAfter);
                };
                overlay.addEventListener('transitionend', removeAfter);
                // Fallback removal in case transitionend doesn't fire
                setTimeout(removeAfter, 1100);
            }, Math.max(0, delayMs | 0));
        } catch (e) {
            // On any error, just remove immediately
            if (overlay && overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            this.splashDismissed = true;
            try { this.tryShowSponsoredNode(); } catch (e2) {}
        }
    }

    // Sponsored node manager (production only, once per session)
    tryShowSponsoredNode() {
        try {
            // Only in production domain unless preview is explicitly requested
            const isProd = typeof window !== 'undefined' && window.location && window.location.hostname && window.location.hostname.endsWith('nodesin.space');
            const qp = (typeof window !== 'undefined' && window.location && window.location.search)
                ? new URLSearchParams(window.location.search)
                : null;
            const adPreview = !!(qp && (
                qp.get('ad_preview') === '1' || qp.get('ad_preview') === 'true' || qp.has('ad_preview') ||
                qp.get('ad_demo') === '1' || qp.get('ad_demo') === 'true' || qp.has('ad_demo')
            ));
            if (!isProd && !adPreview) return;

            // Require explicit AdSense configuration via globals to avoid placeholders
            // Fallback: read client from <meta name="google-adsense-account" content="ca-pub-...">
            let clientId = window.SPONSORED_AD_CLIENT;
            const slotId = window.SPONSORED_AD_SLOT;
            if (!clientId && typeof document !== 'undefined') {
                const meta = document.querySelector('meta[name="google-adsense-account"]');
                if (meta) {
                    const c = meta.getAttribute('content');
                    if (c) clientId = c;
                }
            }
            if (!adPreview && (!clientId || !slotId)) {
                // No config in normal mode -> do nothing (no placeholders in production)
                return;
            }

            // Once per session
            if (!adPreview && sessionStorage.getItem('sponsored_node_shown') === '1') return;

            // Must have a ready canvas
            if (!this.workflowCanvas || !this.workflowCanvas.canvas || !this.workflowCanvas.nodesContainer) return;

            const width = 336;
            const height = 280;
            const margin = 24; // px from canvas viewport edge
            const ttlMs = adPreview ? 10000 : 25000; // demo/preview: 10s, production: 25s

            // Compute world coordinates for top-right corner of the visible canvas viewport
            const rect = this.workflowCanvas.canvas.getBoundingClientRect();
            const anchorViewportX = rect.right - margin;
            const anchorViewportY = rect.top + margin;
            const world = this.workflowCanvas.viewportToCanvas(anchorViewportX, anchorViewportY);
            const desiredLeft = world.x - width; // right-align with margin
            const desiredTop = world.y; // top margin already applied
            const clamped = this.workflowCanvas.clampToWorld(desiredLeft, desiredTop, width, height);

            // Build sponsored node element (looks like a node but not part of graph)
            const nodeEl = document.createElement('div');
            nodeEl.className = 'workflow-node node-3d sponsored-node';
            nodeEl.style.left = clamped.x + 'px';
            nodeEl.style.top = clamped.y + 'px';
            nodeEl.style.width = width + 'px';
            nodeEl.style.height = height + 'px';
            nodeEl.setAttribute('role', 'complementary');
            nodeEl.setAttribute('aria-label', 'Sponsored');

            // Header with close button
            const header = document.createElement('div');
            header.className = 'node-header';
            const title = document.createElement('span');
            title.className = 'node-title';
            title.textContent = adPreview ? 'Sponsored (Demo)' : 'Sponsored';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'sponsored-close';
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', 'Close sponsored');
            closeBtn.textContent = '×';
            header.appendChild(title);
            header.appendChild(closeBtn);

            // Body wrapper (no padding for exact ad dimensions)
            const body = document.createElement('div');
            body.className = 'node-body sponsored-body';

            if (adPreview) {
                // Render a styled preview frame instead of loading AdSense
                const frame = document.createElement('div');
                frame.className = 'ad-preview-frame';
                // Accessibility labels for reviewers
                frame.setAttribute('role', 'img');
                frame.setAttribute('aria-label', 'Ad demo frame 336 by 280 positioned top-right; auto-dismisses after 10 seconds.');

                const badge = document.createElement('div');
                badge.className = 'ad-preview-badge';
                badge.textContent = 'DEMO';

                const caption = document.createElement('div');
                caption.className = 'ad-preview-caption';
                caption.textContent = 'DEMO MODE';

                const sub = document.createElement('div');
                sub.className = 'ad-preview-sub';
                sub.textContent = '336×280 Ad Slot · Top-right of canvas · Auto-dismisses in 10s';

                frame.appendChild(badge);
                frame.appendChild(caption);
                frame.appendChild(sub);
                body.appendChild(frame);
            } else {
                // AdSense INS element
                const ins = document.createElement('ins');
                ins.className = 'adsbygoogle';
                ins.style.display = 'inline-block';
                ins.style.width = width + 'px';
                ins.style.height = height + 'px';
                ins.setAttribute('data-ad-client', clientId);
                ins.setAttribute('data-ad-slot', slotId);
                ins.setAttribute('data-ad-format', 'rectangle');
                ins.setAttribute('data-full-width-responsive', 'false');
                body.appendChild(ins);
            }

            nodeEl.appendChild(header);
            nodeEl.appendChild(body);

            // Append to canvas layer
            this.workflowCanvas.nodesContainer.appendChild(nodeEl);

            // Enable 3D FX if available
            if (typeof window.fx !== 'undefined' && typeof window.fx.enableNode3D === 'function') {
                try { window.fx.enableNode3D(nodeEl); } catch (_) {}
            }

            // Close button handler (fade out then remove)
            const removeNode = () => {
                try {
                    nodeEl.classList.add('sponsored-fade-out');
                } catch (_) {}
                setTimeout(() => {
                    if (nodeEl && nodeEl.parentNode) nodeEl.parentNode.removeChild(nodeEl);
                }, 420);
            };
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                removeNode();
            });

            // Auto-dismiss after TTL
            setTimeout(removeNode, ttlMs);

            // Only once per session
            if (!adPreview) {
                sessionStorage.setItem('sponsored_node_shown', '1');
            }

            if (!adPreview) {
                // Load AdSense script once, then request ad
                const ensureAdsScript = () => new Promise((resolve) => {
                    if (document.getElementById('adsbygoogle-js')) { resolve(true); return; }
                    const s = document.createElement('script');
                    s.id = 'adsbygoogle-js';
                    s.async = true;
                    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(clientId);
                    s.crossOrigin = 'anonymous';
                    s.onload = () => resolve(true);
                    s.onerror = () => resolve(false);
                    document.head.appendChild(s);
                });

                ensureAdsScript().then(() => {
                    try {
                        (window.adsbygoogle = window.adsbygoogle || []).push({});
                    } catch (_) {
                        // Fail silently if blocked; node remains until TTL/close
                    }
                });
            }
        } catch (err) {
            // Do nothing on any error
        }
    }
    
    // Tab Management
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        
        // Update tab panels
        document.querySelectorAll('.log-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        
        // Map tab names to panel IDs
        const panelMap = {
            'execution': 'execution-log',
            'debug': 'debug-panel', 
            'performance': 'performance-panel'
        };
        
        const panelId = panelMap[tabName];
        if (panelId) {
            document.getElementById(panelId).classList.add('active');
        }
    }
    
    // Global keyboard shortcuts
    handleGlobalKeyDown(e) {
        // While splash overlay is active, block all keyboard interactions
        if (!this.splashDismissed) {
            e.preventDefault();
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'n':
                    e.preventDefault();
                    this.newWorkflow();
                    break;
                case 's':
                    e.preventDefault();
                    this.saveWorkflow();
                    break;
                case 'o':
                    e.preventDefault();
                    this.loadWorkflow();
                    break;
                case 'enter':
                    e.preventDefault();
                    this.executeWorkflow();
                    break;
            }
        }
        
        switch (e.key) {
            case 'F5':
                e.preventDefault();
                this.executeWorkflow();
                break;
            case 'Escape':
                if (this.executionState === 'running') {
                    this.stopExecution();
                }
                break;
        }
    }
    
    // Utility methods
    generateWorkflowId() {
        return 'workflow_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    hasUnsavedChanges() {
        // Simple check - in production this would be more sophisticated
        return this.workflowCanvas && this.workflowCanvas.nodes.size > 0;
    }
    
    handleWindowResize() {
        // Intentionally left blank; the canvas layers manage their own sizing.
    }
    
    // Message display methods
    showErrorMessage(message) {
        // Prefer our styled modal, fallback to alert
        if (window.workflowImportExport && typeof window.workflowImportExport.createModal === 'function') {
            window.workflowImportExport.createModal('Error', `\n                <div class="modal-message">\n                    <p>${message}</p>\n                </div>\n            `, [
                { text: 'OK', primary: true, callback: () => true }
            ]);
        } else {
            alert('Error: ' + message);
        }
    }
    
    showInfoMessage(message) {
        // Prefer our styled modal, fallback to alert
        if (window.workflowImportExport && typeof window.workflowImportExport.createModal === 'function') {
            window.workflowImportExport.createModal('Info', `\n                <div class="modal-message">\n                    <p>${message}</p>\n                </div>\n            `, [
                { text: 'OK', primary: true, callback: () => true }
            ]);
        } else {
            alert('Info: ' + message);
        }
    }
    
    // Cleanup
    destroy() {
        if (this.webSocket) {
            this.webSocket.disconnect();
        }
        
        // Clean up other resources
        this.isInitialized = false;
        console.log('Visual AGI Node Editor destroyed');
    }
}

/**
 * Log Manager for handling application logs
 */
class LogManager {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.logContainers = {
            execution: document.getElementById('execution-log'),
            debug: document.getElementById('debug-panel')
        };
    }
    
    addLog(level, message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = {
            timestamp: timestamp,
            level: level,
            message: message,
            data: data
        };
        
        this.logs.unshift(logEntry);
        
        // Limit log size
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(0, this.maxLogs);
        }
        
        // Update UI
        this.updateLogDisplay(logEntry);
        
        // Console output
        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || '');
    }
    
    updateLogDisplay(logEntry) {
        const logElement = document.createElement('div');
        logElement.className = 'log-entry';
        logElement.innerHTML = `
            <span class="timestamp">${logEntry.timestamp}</span>
            <span class="log-${logEntry.level}">${logEntry.message}</span>
        `;
        
        // Add to appropriate log containers
        if (logEntry.level === 'info' || logEntry.level === 'warning' || logEntry.level === 'error') {
            if (this.logContainers.execution) {
                this.logContainers.execution.insertBefore(logElement, this.logContainers.execution.firstChild);
            }
        }
        
        if (logEntry.level === 'debug') {
            if (this.logContainers.debug) {
                const debugElement = logElement.cloneNode(true);
                this.logContainers.debug.insertBefore(debugElement, this.logContainers.debug.firstChild);
            }
        }
    }
    
    clearLogs() {
        this.logs = [];
        Object.values(this.logContainers).forEach(container => {
            if (container) {
                container.innerHTML = '';
            }
        });
    }
    
    exportLogs() {
        return JSON.stringify(this.logs, null, 2);
    }
}

// Initialize application when DOM is loaded, but wait for core modules to be present
document.addEventListener('DOMContentLoaded', () => {
    const deadlineMs = 8000; // max wait 8s
    const start = performance.now();
    const need = () => {
        const NP = (typeof window !== 'undefined' && window.NodePalette) ? window.NodePalette : (typeof NodePalette !== 'undefined' ? NodePalette : null);
        const WC = (typeof window !== 'undefined' && window.WorkflowCanvas) ? window.WorkflowCanvas : (typeof WorkflowCanvas !== 'undefined' ? WorkflowCanvas : null);
        const NPty = (typeof window !== 'undefined' && window.NodeProperties) ? window.NodeProperties : (typeof NodeProperties !== 'undefined' ? NodeProperties : null);
        const WIE = (typeof window !== 'undefined' && window.WorkflowImportExport) ? window.WorkflowImportExport : (typeof WorkflowImportExport !== 'undefined' ? WorkflowImportExport : null);
        const WWS = (typeof window !== 'undefined' && window.WorkflowWebSocket) ? window.WorkflowWebSocket : (typeof WorkflowWebSocket !== 'undefined' ? WorkflowWebSocket : null);
        return { NP, WC, NPty, WIE, WWS };
    };
    const tick = () => {
        const { NP, WC, NPty, WIE, WWS } = need();
        if (NP && WC && NPty && WIE && WWS) {
            try {
                window.app = new VisualAGINodeEditor();
            } catch (e) {
                console.error('Failed to initialize application:', e);
            }
            return;
        }
        if ((performance.now() - start) < deadlineMs) {
            setTimeout(tick, 25);
        } else {
            console.warn('Core modules not ready in time; proceeding with partial init');
            try { window.app = new VisualAGINodeEditor(); } catch (e) { console.error('Init error (late):', e); }
        }
    };
    tick();
});

// Export for external access
window['VisualAGINodeEditor'] = VisualAGINodeEditor;
window['LogManager'] = LogManager;
