/**
 * WebSocket Client for Visual AGI Node Editor
 * Based on ProjectLuna AGI WebSocket client with adaptations for node workflows
 */
class WorkflowWebSocket {
    constructor(url = null) {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.heartbeatInterval = null;
        this.messageQueue = [];
        this.subscribers = new Map();

        // Determine URL automatically when not explicitly provided
        const autoUrl = (() => {
            try {
                if (typeof window !== 'undefined') {
                    // Allow explicit override
                    if (window.WS_URL) return window.WS_URL;
                    const loc = window.location;
                    const isHttps = loc && loc.protocol === 'https:';
                    const host = (loc && loc.hostname) ? loc.hostname : 'localhost';
                    if (isHttps) {
                        // Production: nodesin.space or Cloudflare Pages
                        if (
                            host === 'nodesin.space' ||
                            host.endsWith('.nodesin.space') ||
                            host.endsWith('.pages.dev')
                        ) {
                            // Use Cloudflare Tunnel public hostname
                            return 'wss://ws.nodesin.space';
                        }
                        // Default to same-origin path behind reverse proxy
                        return `wss://${host}/ws`;
                    } else {
                        // Local development
                        return 'ws://localhost:8001';
                    }
                }
            } catch (_) { /* ignore and fall back */ }
            return 'ws://localhost:8001';
        })();

        // WebSocket server configuration
        this.config = {
            url: url || autoUrl,
            heartbeatInterval: 30000,
            reconnectOnClose: true
        };

        // Ping/latency tracking
        this.pingInfo = {
            lastSentAt: null,  // performance.now()
            rttMs: null
        };
        
        this.connect();
    }

    // Compatibility aliases for consumer code expecting .on() and getAvailableNodes()
    on(eventType, callback) {
        return this.subscribe(eventType, callback);
    }

    getAvailableNodes() {
        return this.requestAvailableNodes();
    }

    connect() {
        console.log('🔌 Attempting to connect to WebSocket...');
        
        try {
            this.ws = new WebSocket(this.config.url);
            this.setupEventHandlers();
        } catch (error) {
            console.error('❌ WebSocket connection failed:', error);
            this.handleConnectionFailure();
        }
    }

    setupEventHandlers() {
        this.ws.onopen = (event) => {
            console.log('✅ WebSocket connected to Visual AGI Node Editor');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.updateConnectionStatus('online');
            this.startHeartbeat();
            this.processMessageQueue();
            
            // Request available nodes immediately
            setTimeout(() => this.requestAvailableNodes(), 1000);
            // Send an immediate app-level ping to populate ping display quickly
            this.sendAppPing();

            const payload = { timestamp: Date.now() };
            this.notifySubscribers('connected', payload);
            // Alias for compatibility with main.js
            this.notifySubscribers('open', payload);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                console.error('❌ Failed to parse WebSocket message:', error);
            }
        };

        this.ws.onclose = (event) => {
            console.log('🔌 WebSocket connection closed:', event.code, event.reason);
            this.isConnected = false;
            this.updateConnectionStatus('offline');
            this.stopHeartbeat();
            this.resetPingDisplay();
            const payload = { 
                code: event.code, 
                reason: event.reason,
                timestamp: Date.now()
            };
            this.notifySubscribers('disconnected', payload);
            // Alias for compatibility with main.js
            this.notifySubscribers('close', payload);
            
            if (this.config.reconnectOnClose && !event.wasClean) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            this.notifySubscribers('error', { error, timestamp: Date.now() });
            this.handleConnectionFailure();
        };
    }

    handleMessage(data) {
        if (data && data.type !== 'pong') {
            console.log('📨 Received WebSocket message:', data.type);
        }
        
        switch (data.type) {
            case 'available_nodes':
                this.handleAvailableNodes(data.data);
                break;
            case 'node_execution_start':
                this.handleNodeExecutionStart(data.data);
                break;
            case 'node_execution_complete':
                this.handleNodeExecutionComplete(data.data);
                break;
            case 'workflow_complete':
                this.handleWorkflowComplete(data.data);
                break;
            case 'execution_error':
                this.handleExecutionError(data.data);
                break;
            case 'execution_progress':
                this.handleExecutionProgress(data.data);
                break;
            case 'connection_established':
                this.handleConnectionEstablished(data.data);
                break;
            // Persistence-related messages
            case 'workflow_saved':
                this.notifySubscribers('workflow_saved', data.data);
                break;
            case 'workflow_loaded':
                this.notifySubscribers('workflow_loaded', data.data);
                break;
            case 'workflow_list':
                this.notifySubscribers('workflow_list', data.data);
                break;
            case 'workflow_deleted':
                this.notifySubscribers('workflow_deleted', data.data);
                break;
            case 'workflow_renamed':
                this.notifySubscribers('workflow_renamed', data.data);
                break;
            case 'pong':
                this.handleHeartbeatResponse(data.data);
                break;
            case 'error':
                this.handleServerError(data.data);
                break;
            default:
                console.log('📋 Unknown message type:', data.type);
                this.notifySubscribers('message', data);
        }
    }

    handleAvailableNodes(payload) {
        console.log('📦 Received available nodes:', payload.count);
        this.notifySubscribers('available_nodes', payload);
        
        // Update node palette if available
        if (window.nodePalette && payload.nodes) {
            window.nodePalette.updateFromServer(payload.nodes);
        }
    }

    handleNodeExecutionStart(payload) {
        console.log('🚀 Node execution started:', payload.node_id);
        this.notifySubscribers('node_execution_start', payload);
        
        // Update visual feedback
        if (window.workflowCanvas) {
            const node = window.workflowCanvas.nodes.get(payload.node_id);
            if (node) {
                node.element.classList.add('executing');
            }
        }
    }

    handleNodeExecutionComplete(payload) {
        console.log('✅ Node execution completed:', payload.node_id);
        this.notifySubscribers('node_execution_complete', payload);
        
        // Update visual feedback
        if (window.workflowCanvas) {
            const node = window.workflowCanvas.nodes.get(payload.node_id);
            if (node) {
                node.element.classList.remove('executing');
            }
        }
        
        // Update execution time
        if (payload.execution_time_ms && document.getElementById('execution-time')) {
            document.getElementById('execution-time').textContent = `${payload.execution_time_ms}ms`;
        }
    }

    handleWorkflowComplete(payload) {
        console.log('🎉 Workflow execution completed:', payload.execution_id);
        this.notifySubscribers('workflow_complete', payload);
        
        // Update execution button
        if (window.app) {
            window.app.executionState = 'idle';
            window.app.updateExecutionButton();
        }
    }

    handleExecutionError(payload) {
        console.error('❌ Execution error:', payload.error);
        this.notifySubscribers('execution_error', payload);
        
        // Update visual feedback
        if (payload.node_id && window.workflowCanvas) {
            const node = window.workflowCanvas.nodes.get(payload.node_id);
            if (node) {
                node.element.classList.remove('executing');
                node.element.classList.add('error');
                setTimeout(() => {
                    node.element.classList.remove('error');
                }, 3000);
            }
        }
    }

    handleExecutionProgress(payload) {
        this.notifySubscribers('execution_progress', payload);
        
        // Update progress metrics
        if (window.app) {
            window.app.updateExecutionProgress(payload);
        }
    }

    handleConnectionEstablished(payload) {
        console.log('🎯 Connection established with server');
        this.notifySubscribers('connection_established', payload);
    }

    handleHeartbeatResponse(payload) {
        // Compute RTT from last app-level ping
        if (this.pingInfo && this.pingInfo.lastSentAt != null) {
            const rtt = Math.round(performance.now() - this.pingInfo.lastSentAt);
            this.pingInfo.rttMs = rtt;
            this.updatePingDisplay(rtt);
            // Clear lastSentAt to avoid computing against very old timestamp if next pong is delayed
            this.pingInfo.lastSentAt = null;
        }
    }

    handleServerError(payload) {
        console.error('🚨 Server error:', payload);
        this.notifySubscribers('server_error', payload);
        
        // Add error to logs
        if (window.logManager) {
            window.logManager.addLog('error', payload.message || 'Server error occurred');
        }
    }

    send(message) {
        if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(message));
                if (message && message.type !== 'ping') {
                    console.log('📤 Sent WebSocket message:', message.type);
                }
                return true;
            } catch (error) {
                console.error('❌ Failed to send WebSocket message:', error);
                this.messageQueue.push(message);
                return false;
            }
        } else {
            console.log('📋 WebSocket not connected, queuing message');
            this.messageQueue.push(message);
            return false;
        }
    }

    processMessageQueue() {
        while (this.messageQueue.length > 0 && this.isConnected) {
            const message = this.messageQueue.shift();
            this.send(message);
        }
    }

    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected) {
                this.sendAppPing();
            }
        }, this.config.heartbeatInterval);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Maximum reconnection attempts reached');
            this.updateConnectionStatus('offline');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
        this.updateConnectionStatus('connecting');
        
        setTimeout(() => {
            if (!this.isConnected) {
                this.connect();
            }
        }, delay);
    }

    handleConnectionFailure() {
        this.isConnected = false;
        this.updateConnectionStatus('offline');
        
        if (this.config.reconnectOnClose) {
            this.scheduleReconnect();
        }
    }

    updateConnectionStatus(status) {
        const statusIndicator = document.getElementById('connection-status');
        const statusText = document.getElementById('status-text');
        
        if (statusIndicator && statusText) {
            statusIndicator.className = `status-${status}`;
            
            const statusTextMap = {
                'online': 'Connected',
                'connecting': 'Connecting...',
                'offline': 'Disconnected'
            };
            
            statusText.textContent = statusTextMap[status] || 'Unknown';
            if (status !== 'online') {
                this.resetPingDisplay();
            }
        }
    }

    // --- Ping helpers ---
    sendAppPing() {
        this.pingInfo.lastSentAt = performance.now();
        this.send({ type: 'ping', data: { timestamp: Date.now() } });
    }

    updatePingDisplay(ms) {
        const el = document.getElementById('ping-value');
        if (el) {
            // Determine thresholds
            const isNum = isFinite(ms);
            let color = '';
            if (isNum) {
                // Green <= 100ms, Yellow <= 250ms, Red > 250ms
                if (ms <= 100) {
                    color = '#22c55e'; // green
                } else if (ms <= 250) {
                    color = '#eab308'; // yellow/amber
                } else {
                    color = '#ef4444'; // red
                }
            }

            el.textContent = isNum ? String(ms) : '--';
            el.style.color = color;
        }
    }

    resetPingDisplay() {
        const el = document.getElementById('ping-value');
        if (el) {
            el.textContent = '--';
            el.style.color = '';
        }
        if (this.pingInfo) {
            this.pingInfo.lastSentAt = null;
            this.pingInfo.rttMs = null;
        }
    }

    // Subscription system for external components
    subscribe(eventType, callback) {
        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, []);
        }
        this.subscribers.get(eventType).push(callback);
        
        return () => {
            const callbacks = this.subscribers.get(eventType);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index > -1) {
                    callbacks.splice(index, 1);
                }
            }
        };
    }

    notifySubscribers(eventType, data) {
        const callbacks = this.subscribers.get(eventType);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('❌ Error in subscriber callback:', error);
                }
            });
        }
    }

    // Public API methods for node editor
    executeWorkflow(workflowData) {
        const sent = this.send({
            type: 'execute_workflow',
            data: workflowData
        });
        // Return a result-like object to match callers expecting { success }
        return Promise.resolve({ success: !!sent, error: sent ? null : 'WebSocket not connected' });
    }

    stopExecution() {
        return this.send({
            type: 'stop_execution'
        });
    }

    requestAvailableNodes() {
        return this.send({
            type: 'get_available_nodes'
        });
    }

    validateWorkflow(workflowData) {
        return this.send({
            type: 'validate_workflow',
            data: workflowData
        });
    }

    // --- Persistence helpers ---
    saveWorkflow(workflowData, { timeoutMs = 10000 } = {}) {
        const sent = this.send({ type: 'save_workflow', data: workflowData });
        if (!sent) {
            return Promise.resolve({ success: false, error: 'WebSocket not connected' });
        }
        return new Promise((resolve) => {
            const offSaved = this.on('workflow_saved', (payload) => {
                offSaved(); offErr();
                resolve({ success: true, data: payload });
            });
            const offErr = this.on('server_error', (payload) => {
                offSaved(); offErr();
                resolve({ success: false, error: (payload && payload.message) ? payload.message : 'Server error' });
            });
            setTimeout(() => {
                offSaved(); offErr();
                resolve({ success: false, error: 'Timeout waiting for workflow_saved' });
            }, timeoutMs);
        });
    }

    listWorkflows({ timeoutMs = 10000 } = {}) {
        const sent = this.send({ type: 'list_workflows' });
        if (!sent) {
            return Promise.resolve({ success: false, error: 'WebSocket not connected' });
        }
        return new Promise((resolve) => {
            const offList = this.on('workflow_list', (payload) => {
                offList(); offErr();
                resolve({ success: true, data: payload });
            });
            const offErr = this.on('server_error', (payload) => {
                offList(); offErr();
                resolve({ success: false, error: (payload && payload.message) ? payload.message : 'Server error' });
            });
            setTimeout(() => {
                offList(); offErr();
                resolve({ success: false, error: 'Timeout waiting for workflow_list' });
            }, timeoutMs);
        });
    }

    loadWorkflow(workflowId, { timeoutMs = 10000 } = {}) {
        const sent = this.send({ type: 'load_workflow', data: { workflow_id: workflowId } });
        if (!sent) {
            return Promise.resolve({ success: false, error: 'WebSocket not connected' });
        }
        return new Promise((resolve) => {
            const offLoaded = this.on('workflow_loaded', (payload) => {
                offLoaded(); offErr();
                resolve({ success: true, data: payload });
            });
            const offErr = this.on('server_error', (payload) => {
                offLoaded(); offErr();
                resolve({ success: false, error: (payload && payload.message) ? payload.message : 'Server error' });
            });
            setTimeout(() => {
                offLoaded(); offErr();
                resolve({ success: false, error: 'Timeout waiting for workflow_loaded' });
            }, timeoutMs);
        });
    }

    deleteWorkflow(workflowId, { timeoutMs = 10000 } = {}) {
        const sent = this.send({ type: 'delete_workflow', data: { workflow_id: workflowId } });
        if (!sent) {
            return Promise.resolve({ success: false, error: 'WebSocket not connected' });
        }
        return new Promise((resolve) => {
            const offDeleted = this.on('workflow_deleted', (payload) => {
                offDeleted(); offErr();
                resolve({ success: true, data: payload });
            });
            const offErr = this.on('server_error', (payload) => {
                offDeleted(); offErr();
                resolve({ success: false, error: (payload && payload.message) ? payload.message : 'Server error' });
            });
            setTimeout(() => {
                offDeleted(); offErr();
                resolve({ success: false, error: 'Timeout waiting for workflow_deleted' });
            }, timeoutMs);
        });
    }

    renameWorkflow(workflowId, name, { timeoutMs = 10000 } = {}) {
        const sent = this.send({ type: 'rename_workflow', data: { workflow_id: workflowId, name } });
        if (!sent) {
            return Promise.resolve({ success: false, error: 'WebSocket not connected' });
        }
        return new Promise((resolve) => {
            const offRenamed = this.on('workflow_renamed', (payload) => {
                offRenamed(); offErr();
                resolve({ success: true, data: payload });
            });
            const offErr = this.on('server_error', (payload) => {
                offRenamed(); offErr();
                resolve({ success: false, error: (payload && payload.message) ? payload.message : 'Server error' });
            });
            setTimeout(() => {
                offRenamed(); offErr();
                resolve({ success: false, error: 'Timeout waiting for workflow_renamed' });
            }, timeoutMs);
        });
    }

    disconnect() {
        console.log('🔌 Disconnecting WebSocket...');
        this.config.reconnectOnClose = false;
        this.stopHeartbeat();
        
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
        }
        
        this.isConnected = false;
        this.updateConnectionStatus('offline');
    }

    getConnectionInfo() {
        return {
            isConnected: this.isConnected,
            url: this.config.url,
            reconnectAttempts: this.reconnectAttempts,
            queuedMessages: this.messageQueue.length
        };
    }
}

// Export for use in other modules
window['WorkflowWebSocket'] = WorkflowWebSocket;
