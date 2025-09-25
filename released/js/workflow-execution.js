/**
 * Workflow Execution Manager
 * Handles workflow execution, validation, and monitoring
 */
class WorkflowExecution {
    constructor(workflowCanvas, webSocketClient) {
        this.canvas = workflowCanvas;
        this.webSocket = webSocketClient;
        this.executionState = 'idle'; // 'idle', 'running', 'paused', 'completed', 'error'
        this.currentExecution = null;
        this.executionHistory = [];
        this.executionMetrics = {
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            averageExecutionTime: 0
        };
    }

    /**
     * Execute the current workflow
     */
    async executeWorkflow(options = {}) {
        try {
            if (this.executionState === 'running') {
                return {
                    success: false,
                    message: 'Workflow is already running. Stop current execution first.'
                };
            }

            // Export current workflow
            const workflowData = this.canvas.exportWorkflow();
            
            // Validate workflow
            const validation = this.validateWorkflow(workflowData);
            if (!validation.valid) {
                return {
                    success: false,
                    message: 'Workflow validation failed',
                    errors: validation.errors
                };
            }

            // Prepare execution context
            const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const execution = {
                id: executionId,
                workflowId: workflowData.workflow_id,
                startTime: new Date(),
                endTime: null,
                state: 'running',
                progress: {
                    totalNodes: workflowData.nodes.length,
                    completedNodes: 0,
                    failedNodes: 0,
                    currentNode: null
                },
                options: {
                    debugMode: options.debugMode || false,
                    stepByStep: options.stepByStep || false,
                    breakpoints: options.breakpoints || []
                },
                results: {},
                errors: []
            };

            this.currentExecution = execution;
            this.executionState = 'running';
            
            // Update UI
            this.updateExecutionUI();
            
            // Clear previous execution states from nodes
            this.clearNodeExecutionStates();

            // Log execution start
            if (window.logger) {
                window.logger.info(`🚀 Starting workflow execution: ${executionId}`);
                window.logger.info(`   └─ Nodes: ${workflowData.nodes.length}`);
                window.logger.info(`   └─ Connections: ${workflowData.connections.length}`);
                window.logger.info(`   └─ Debug mode: ${execution.options.debugMode}`);
            }

            // Send execution request to backend
            if (this.webSocket && this.webSocket.isConnected()) {
                const result = await this.webSocket.executeWorkflow({
                    ...workflowData,
                    execution_id: executionId,
                    debug_mode: execution.options.debugMode,
                    step_by_step: execution.options.stepByStep
                });

                if (result.success) {
                    return {
                        success: true,
                        executionId: executionId,
                        message: 'Workflow execution started successfully'
                    };
                } else {
                    this.handleExecutionError(result.error);
                    return {
                        success: false,
                        message: result.error
                    };
                }
            } else {
                // Simulate execution if no backend connection
                if (window.logger) {
                    window.logger.warn('No backend connection - simulating workflow execution');
                }
                await this.simulateExecution(execution);
                return {
                    success: true,
                    executionId: executionId,
                    message: 'Workflow executed locally (simulation mode)'
                };
            }

        } catch (error) {
            console.error('Error executing workflow:', error);
            this.handleExecutionError(error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Stop the current workflow execution
     */
    async stopExecution() {
        if (!this.currentExecution || this.executionState === 'idle') {
            return {
                success: false,
                message: 'No workflow is currently running'
            };
        }

        try {
            if (this.webSocket && this.webSocket.isConnected()) {
                await this.webSocket.stopExecution({
                    execution_id: this.currentExecution.id
                });
            }

            this.currentExecution.endTime = new Date();
            this.currentExecution.state = 'stopped';
            this.executionState = 'idle';
            
            this.updateExecutionUI();
            this.clearNodeExecutionStates();
            
            if (window.logger) {
                window.logger.info('🛑 Workflow execution stopped by user');
            }

            return {
                success: true,
                message: 'Workflow execution stopped'
            };

        } catch (error) {
            console.error('Error stopping workflow execution:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Pause the current workflow execution
     */
    async pauseExecution() {
        if (this.executionState !== 'running') {
            return {
                success: false,
                message: 'No workflow is currently running'
            };
        }

        try {
            this.executionState = 'paused';
            this.currentExecution.state = 'paused';
            
            this.updateExecutionUI();
            
            if (window.logger) {
                window.logger.info('⏸️ Workflow execution paused');
            }

            return {
                success: true,
                message: 'Workflow execution paused'
            };

        } catch (error) {
            console.error('Error pausing workflow execution:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Resume a paused workflow execution
     */
    async resumeExecution() {
        if (this.executionState !== 'paused') {
            return {
                success: false,
                message: 'No workflow is currently paused'
            };
        }

        try {
            this.executionState = 'running';
            this.currentExecution.state = 'running';
            
            this.updateExecutionUI();
            
            if (window.logger) {
                window.logger.info('▶️ Workflow execution resumed');
            }

            return {
                success: true,
                message: 'Workflow execution resumed'
            };

        } catch (error) {
            console.error('Error resuming workflow execution:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Validate workflow before execution
     */
    validateWorkflow(workflowData) {
        const errors = [];
        const warnings = [];

        // Check if workflow has nodes
        if (!workflowData.nodes || workflowData.nodes.length === 0) {
            errors.push('Workflow must contain at least one node');
        }

        // Check for disconnected nodes
        const connectedNodeIds = new Set();
        workflowData.connections.forEach(conn => {
            connectedNodeIds.add(conn.source.nodeId);
            connectedNodeIds.add(conn.target.nodeId);
        });

        const disconnectedNodes = workflowData.nodes.filter(node => 
            !connectedNodeIds.has(node.id) && workflowData.nodes.length > 1
        );

        if (disconnectedNodes.length > 0) {
            warnings.push(`${disconnectedNodes.length} disconnected nodes found`);
        }

        // Build quick lookup for nodes and definitions
        const nodeById = new Map(workflowData.nodes.map(n => [n.id, n]));

        // Validate individual nodes
        workflowData.nodes.forEach(nodeData => {
            const node = this.canvas.nodes.get(nodeData.id);
            if (node) {
                // Check required properties
                if (node.definition && node.definition.properties) {
                    Object.entries(node.definition.properties).forEach(([propName, propDef]) => {
                        if (propDef.required && (node.properties[propName] === undefined || node.properties[propName] === null || node.properties[propName] === '')) {
                            errors.push(`Node ${nodeData.id}: Required property '${propName}' is missing`);
                        }
                    });
                }

                // Check input bindings: if an input is defined and not optional, it should be bound
                const inputs = (node.definition && node.definition.inputs) ? node.definition.inputs : [];
                const bindings = nodeData.input_bindings || {};
                inputs.forEach(inputDef => {
                    const isOptional = inputDef.optional === true || inputDef.required === false;
                    if (!isOptional) {
                        if (!bindings || !bindings[inputDef.name]) {
                            errors.push(`Node ${nodeData.id}: Input '${inputDef.name}' is not connected`);
                        }
                    }
                });
            }
        });

        // Check for circular dependencies
        if (this.hasCircularDependencies(workflowData)) {
            errors.push('Workflow contains circular dependencies');
        }

        // Check for type mismatches in connections (warning)
        workflowData.connections.forEach(conn => {
            const sourceNode = nodeById.get(conn.source.nodeId);
            const targetNode = nodeById.get(conn.target.nodeId);
            if (!sourceNode || !targetNode) return;

            const getOutputType = (nodeObj, outputName) => {
                const out = (nodeObj.definition && nodeObj.definition.outputs) ? nodeObj.definition.outputs.find(o => o.name === outputName) : null;
                return out && out.type ? out.type : null;
            };
            const getInputType = (nodeObj, inputName) => {
                const inp = (nodeObj.definition && nodeObj.definition.inputs) ? nodeObj.definition.inputs.find(i => i.name === inputName) : null;
                return inp && inp.type ? inp.type : null;
            };

            const outType = getOutputType(sourceNode, conn.source.name);
            const inType = getInputType(targetNode, conn.target.name);
            if (outType && inType && outType !== inType) {
                warnings.push(`Type mismatch: ${sourceNode.id}.${conn.source.name} (${outType}) -> ${targetNode.id}.${conn.target.name} (${inType})`);
            }
        });

        return {
            valid: errors.length === 0,
            errors: errors,
            warnings: warnings
        };
    }

    /**
     * Check for circular dependencies in the workflow
     */
    hasCircularDependencies(workflowData) {
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

            // Find all outgoing connections from this node
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

    /**
     * Handle execution events from backend
     */
    handleExecutionEvent(event) {
        if (!this.currentExecution) return;

        switch (event.type) {
            case 'node_execution_start':
                this.handleNodeExecutionStart(event.data);
                break;
            case 'node_execution_complete':
                this.handleNodeExecutionComplete(event.data);
                break;
            case 'node_execution_error':
                this.handleNodeExecutionError(event.data);
                break;
            case 'workflow_complete':
                this.handleWorkflowComplete(event.data);
                break;
            case 'execution_error':
                this.handleExecutionError(event.data.error);
                break;
            case 'execution_progress':
                this.handleExecutionProgress(event.data);
                break;
        }
    }

    /**
     * Event handlers for execution events
     */
    handleNodeExecutionStart(data) {
        const node = this.canvas.nodes.get(data.nodeId);
        if (node) {
            node.element.classList.add('executing');
            this.currentExecution.progress.currentNode = data.nodeId;
        }
        
        if (window.logger) {
            window.logger.info(`🔄 Executing node: ${data.nodeId} (${data.nodeType || 'unknown'})`);
        }
    }

    handleNodeExecutionComplete(data) {
        const node = this.canvas.nodes.get(data.nodeId);
        if (node) {
            node.element.classList.remove('executing');
            node.element.classList.add('completed');
            setTimeout(() => {
                node.element.classList.remove('completed');
            }, 2000);
        }

        this.currentExecution.progress.completedNodes++;
        if (data.outputs) {
            this.currentExecution.results[data.nodeId] = data.outputs;
        }

        if (window.logger) {
            window.logger.info(`✅ Node completed: ${data.nodeId} (${data.execution_time_ms || 0}ms)`);
        }

        this.updateExecutionProgress();
    }

    handleNodeExecutionError(data) {
        const node = this.canvas.nodes.get(data.nodeId);
        if (node) {
            node.element.classList.remove('executing');
            node.element.classList.add('error');
            setTimeout(() => {
                node.element.classList.remove('error');
            }, 5000);
        }

        this.currentExecution.progress.failedNodes++;
        this.currentExecution.errors.push({
            nodeId: data.nodeId,
            error: data.error,
            timestamp: new Date()
        });

        if (window.logger) {
            window.logger.error(`❌ Node failed: ${data.nodeId} - ${data.error}`);
        }

        this.updateExecutionProgress();
    }

    handleWorkflowComplete(data) {
        this.currentExecution.endTime = new Date();
        this.currentExecution.state = 'completed';
        this.executionState = 'idle';

        const executionTime = this.currentExecution.endTime - this.currentExecution.startTime;
        
        // Update metrics
        this.executionMetrics.totalExecutions++;
        this.executionMetrics.successfulExecutions++;
        this.updateAverageExecutionTime(executionTime);

        // Add to history
        this.executionHistory.unshift({ ...this.currentExecution });
        if (this.executionHistory.length > 50) {
            this.executionHistory.pop();
        }

        this.updateExecutionUI();
        this.clearNodeExecutionStates();

        if (window.logger) {
            window.logger.info(`🎉 Workflow execution completed in ${executionTime}ms`);
        }

        // Update performance metrics display
        if (data.totalExecutionTime) {
            const executionTimeElement = document.getElementById('execution-time');
            if (executionTimeElement) {
                executionTimeElement.textContent = `${data.totalExecutionTime}ms`;
            }
        }
    }

    handleExecutionError(error) {
        if (this.currentExecution) {
            this.currentExecution.endTime = new Date();
            this.currentExecution.state = 'error';
            this.currentExecution.errors.push({
                error: error,
                timestamp: new Date()
            });
        }

        this.executionState = 'error';
        this.executionMetrics.totalExecutions++;
        this.executionMetrics.failedExecutions++;

        this.updateExecutionUI();
        this.clearNodeExecutionStates();

        if (window.logger) {
            window.logger.error(`💥 Workflow execution failed: ${error}`);
        }

        // Reset state after showing error
        setTimeout(() => {
            if (this.executionState === 'error') {
                this.executionState = 'idle';
                this.updateExecutionUI();
            }
        }, 3000);
    }

    handleExecutionProgress(data) {
        if (this.currentExecution) {
            this.currentExecution.progress = { ...data };
        }
        this.updateExecutionProgress();
    }

    /**
     * UI update methods
     */
    updateExecutionUI() {
        const button = document.getElementById('execute-workflow');
        if (!button) return;

        switch (this.executionState) {
            case 'running':
                button.textContent = 'Stop';
                button.className = 'btn btn-warning';
                break;
            case 'paused':
                button.textContent = 'Resume';
                button.className = 'btn btn-info';
                break;
            case 'error':
                button.textContent = 'Execute';
                button.className = 'btn btn-error';
                break;
            default:
                button.textContent = 'Execute';
                button.className = 'btn btn-primary';
        }
    }

    updateExecutionProgress() {
        // Update progress indicators if they exist
        const progressElements = document.querySelectorAll('.execution-progress');
        progressElements.forEach(element => {
            if (this.currentExecution) {
                const progress = this.currentExecution.progress;
                const percentage = progress.totalNodes > 0 ? 
                    (progress.completedNodes / progress.totalNodes) * 100 : 0;
                element.style.width = `${percentage}%`;
            }
        });
    }

    clearNodeExecutionStates() {
        this.canvas.nodes.forEach(node => {
            node.element.classList.remove('executing', 'completed', 'error');
        });
    }

    updateAverageExecutionTime(newTime) {
        const total = this.executionMetrics.totalExecutions;
        const current = this.executionMetrics.averageExecutionTime;
        this.executionMetrics.averageExecutionTime = ((current * (total - 1)) + newTime) / total;
    }

    /**
     * Simulate execution for testing when backend is not available
     */
    async simulateExecution(execution) {
        const nodes = this.canvas.nodes;
        let nodeIndex = 0;

        for (const [nodeId, node] of nodes) {
            // Simulate node start
            this.handleNodeExecutionStart({ nodeId: nodeId, nodeType: node.type });
            
            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
            
            // Simulate completion (90% success rate)
            if (Math.random() < 0.9) {
                this.handleNodeExecutionComplete({ 
                    nodeId: nodeId,
                    execution_time_ms: Math.round(1000 + Math.random() * 2000),
                    outputs: { result: `Simulated output from ${nodeId}` }
                });
            } else {
                this.handleNodeExecutionError({
                    nodeId: nodeId,
                    error: 'Simulated execution error'
                });
            }

            nodeIndex++;
        }

        // Simulate workflow completion
        setTimeout(() => {
            this.handleWorkflowComplete({
                execution_id: execution.id,
                totalExecutionTime: Date.now() - execution.startTime.getTime()
            });
        }, 500);
    }

    /**
     * Get execution statistics
     */
    getExecutionStatistics() {
        return {
            ...this.executionMetrics,
            currentState: this.executionState,
            currentExecution: this.currentExecution ? {
                id: this.currentExecution.id,
                startTime: this.currentExecution.startTime,
                progress: this.currentExecution.progress
            } : null,
            historyCount: this.executionHistory.length
        };
    }
}

// Export for use in other modules
window['WorkflowExecution'] = WorkflowExecution;
