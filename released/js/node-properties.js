/**
 * Node Properties Panel Management
 * Handles the right sidebar properties panel for node configuration
 */
class NodeProperties {
    constructor() {
        this.container = document.getElementById('node-properties');
        this.currentNode = null;
        this.propertyInputs = new Map();
        // Predeclare frequently used fields to satisfy Closure Compiler
        this.eventHandlers = new Map();
        this.lastHighlightedConnectionId = null;
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Listen for property changes
        this.container.addEventListener('input', (e) => {
            if (e.target.classList.contains('property-input')) {
                this.updateNodeProperty(e.target);
            }
        });
        
        this.container.addEventListener('change', (e) => {
            if (e.target.classList.contains('property-input')) {
                this.updateNodeProperty(e.target);
            }
        });
    }
    
    showNodeProperties(node) {
        this.currentNode = node;
        this.propertyInputs.clear();
        
        if (!node || !node.definition) {
            this.clearProperties();
            return;
        }
        
        const definition = node.definition;
        let html = `
            <div class="property-group">
                <h4>Node Information</h4>
                <div class="property-item">
                    <label class="property-label">ID</label>
                    <input type="text" class="property-input" value="${node.id}" readonly>
                </div>
                <div class="property-item">
                    <label class="property-label">Type</label>
                    <input type="text" class="property-input" value="${definition.name}" readonly>
                </div>
                <div class="property-item">
                    <label class="property-label">Description</label>
                    <textarea class="property-input" readonly rows="2">${definition.description}</textarea>
                </div>
            </div>
        `;
        
        if (definition.properties && Object.keys(definition.properties).length > 0) {
            html += `
                <div class="property-group">
                    <h4>Properties</h4>
            `;
            
            Object.entries(definition.properties).forEach(([key, prop]) => {
                const currentValue = node.properties[key] !== undefined ? node.properties[key] : prop.default;
                html += this.generatePropertyHTML(key, prop, currentValue);
            });
            
            html += `</div>`;
        }
        
        // Input/Output information
        if (definition.inputs && definition.inputs.length > 0) {
            html += `
                <div class="property-group">
                    <h4>Inputs</h4>
            `;
            
            definition.inputs.forEach(input => {
                html += `
                    <div class="property-item">
                        <label class="property-label">${input.name}</label>
                        <div class="connection-info">
                            <span class="connection-type">${input.type}</span>
                            <span class="connection-desc">${input.description}</span>
                        </div>
                    </div>
                `;
            });
            
            html += `</div>`;
        }
        
        if (definition.outputs && definition.outputs.length > 0) {
            html += `
                <div class="property-group">
                    <h4>Outputs</h4>
            `;
            
            definition.outputs.forEach(output => {
                html += `
                    <div class="property-item">
                        <label class="property-label">${output.name}</label>
                        <div class="connection-info">
                            <span class="connection-type">${output.type}</span>
                            <span class="connection-desc">${output.description}</span>
                        </div>
                    </div>
                `;
            });
            
            html += `</div>`;
        }

        // Connections section (incoming/outgoing wires)
        html += this.generateConnectionsHTML(node);
        
        this.container.innerHTML = html;
        
        // Store references to property inputs for easy access
        this.container.querySelectorAll('[data-property-key]').forEach(input => {
            const key = input.dataset.propertyKey;
            this.propertyInputs.set(key, input);
        });

        // Attach handlers for connection list hover/click
        this.attachConnectionListHandlers();
    }
    
    generatePropertyHTML(key, prop, currentValue) {
        const isReadonly = prop.readonly || false;
        const isSensitive = prop.sensitive || false;
        let inputHTML = '';
        
        switch (prop.type) {
            case 'string':
                if (isSensitive) {
                    inputHTML = `<input type="password" class="property-input" 
                                       data-property-key="${key}" 
                                       value="${currentValue || ''}" 
                                       ${isReadonly ? 'readonly' : ''}>`;
                } else {
                    inputHTML = `<input type="text" class="property-input" 
                                       data-property-key="${key}" 
                                       value="${currentValue || ''}" 
                                       ${isReadonly ? 'readonly' : ''}>`;
                }
                break;
                
            case 'number':
                const min = prop.min !== undefined ? `min="${prop.min}"` : '';
                const max = prop.max !== undefined ? `max="${prop.max}"` : '';
                const step = prop.step !== undefined ? `step="${prop.step}"` : '';
                inputHTML = `<input type="number" class="property-input" 
                                   data-property-key="${key}" 
                                   value="${currentValue !== null ? currentValue : ''}" 
                                   ${min} ${max} ${step}
                                   ${isReadonly ? 'readonly' : ''}>`;
                break;
                
            case 'boolean':
                inputHTML = `<input type="checkbox" class="property-input" 
                                   data-property-key="${key}" 
                                   ${currentValue ? 'checked' : ''} 
                                   ${isReadonly ? 'disabled' : ''}>`;
                break;
                
            case 'select':
                inputHTML = `<select class="property-input" 
                                   data-property-key="${key}" 
                                   ${isReadonly ? 'disabled' : ''}>`;
                
                if (prop.options) {
                    prop.options.forEach(option => {
                        const selected = option === currentValue ? 'selected' : '';
                        inputHTML += `<option value="${option}" ${selected}>${option}</option>`;
                    });
                }
                
                inputHTML += `</select>`;
                break;
                
            case 'textarea':
                inputHTML = `<textarea class="property-input" 
                                     data-property-key="${key}" 
                                     rows="${prop.rows || 3}"
                                     ${isReadonly ? 'readonly' : ''}>${currentValue || ''}</textarea>`;
                break;
                
            default:
                inputHTML = `<input type="text" class="property-input" 
                                   data-property-key="${key}" 
                                   value="${currentValue || ''}" 
                                   ${isReadonly ? 'readonly' : ''}>`;
        }
        
        return `
            <div class="property-item">
                <label class="property-label">${prop.label || key}</label>
                ${inputHTML}
                ${prop.help ? `<div class="property-help">${prop.help}</div>` : ''}
            </div>
        `;
    }
    
    updateNodeProperty(inputElement) {
        if (!this.currentNode || !inputElement.dataset.propertyKey) return;
        
        const key = inputElement.dataset.propertyKey;
        let value;
        
        switch (inputElement.type) {
            case 'checkbox':
                value = inputElement.checked;
                break;
            case 'number':
                value = parseFloat(inputElement.value);
                if (isNaN(value)) value = null;
                break;
            default:
                value = inputElement.value;
        }
        
        // Update node properties
        this.currentNode.properties[key] = value;
        
        // Trigger property change event for other components
        this.emit('propertyChanged', {
            nodeId: this.currentNode.id,
            property: key,
            value: value,
            node: this.currentNode
        });
        
        // Log the change
        this.logPropertyChange(key, value);
    }
    
    clearProperties() {
        this.currentNode = null;
        this.propertyInputs.clear();
        this.container.innerHTML = `
            <div class="no-selection">
                <p>Select a node to view its properties</p>
            </div>
        `;
    }
    
    refreshProperties() {
        if (this.currentNode) {
            this.showNodeProperties(this.currentNode);
        }
    }

    // Render connections list HTML for the current node
    generateConnectionsHTML(node) {
        const wc = (typeof window !== 'undefined') ? window['workflowCanvas'] : null;
        if (!wc) return '';

        const incoming = wc.getIncomingConnections(node.id);
        const outgoing = wc.getOutgoingConnections(node.id);

        const renderIncoming = () => {
            if (!incoming.length) return '<div class="property-item"><em>No incoming connections</em></div>';
            return incoming.map(c => {
                const fromNode = wc.nodes.get(c.fromNodeId);
                const fromLabel = fromNode ? `${fromNode.definition.name} (${c.fromNodeId})` : c.fromNodeId;
                return `
                    <div class="property-item connection-item" data-connection-id="${c.connectionId}">
                        <label class="property-label">${c.inputName}</label>
                        <div class="connection-info">
                            <span class="connection-type">from</span>
                            <span class="connection-desc">${fromLabel}.${c.fromPort}</span>
                        </div>
                    </div>
                `;
            }).join('');
        };

        const renderOutgoing = () => {
            if (!outgoing.length) return '<div class="property-item"><em>No outgoing connections</em></div>';
            return outgoing.map(c => {
                const toNode = wc.nodes.get(c.toNodeId);
                const toLabel = toNode ? `${toNode.definition.name} (${c.toNodeId})` : c.toNodeId;
                return `
                    <div class="property-item connection-item" data-connection-id="${c.connectionId}">
                        <label class="property-label">${c.outputName}</label>
                        <div class="connection-info">
                            <span class="connection-type">to</span>
                            <span class="connection-desc">${toLabel}.${c.toPort}</span>
                        </div>
                    </div>
                `;
            }).join('');
        };

        return `
            <div class="property-group">
                <h4>Connections</h4>
                <div id="connections-list">
                    <div class="property-subtitle">Incoming</div>
                    ${renderIncoming()}
                    <div class="property-subtitle" style="margin-top:8px;">Outgoing</div>
                    ${renderOutgoing()}
                </div>
            </div>
        `;
    }

    // Called by canvas when wires change
    refreshConnections(nodeId) {
        if (!this.currentNode || this.currentNode.id !== nodeId) return;
        const wc = (typeof window !== 'undefined') ? window['workflowCanvas'] : null;
        if (!wc) return;
        const list = this.container.querySelector('#connections-list');
        if (!list) return;

        const incoming = wc.getIncomingConnections(nodeId);
        const outgoing = wc.getOutgoingConnections(nodeId);

        const build = (incoming, outgoing) => {
            const inc = incoming.length ? incoming.map(c => {
                const fromNode = wc.nodes.get(c.fromNodeId);
                const fromLabel = fromNode ? `${fromNode.definition.name} (${c.fromNodeId})` : c.fromNodeId;
                return `
                    <div class="property-item connection-item" data-connection-id="${c.connectionId}">
                        <label class="property-label">${c.inputName}</label>
                        <div class="connection-info">
                            <span class="connection-type">from</span>
                            <span class="connection-desc">${fromLabel}.${c.fromPort}</span>
                        </div>
                    </div>`;
            }).join('') : '<div class="property-item"><em>No incoming connections</em></div>';

            const out = outgoing.length ? outgoing.map(c => {
                const toNode = wc.nodes.get(c.toNodeId);
                const toLabel = toNode ? `${toNode.definition.name} (${c.toNodeId})` : c.toNodeId;
                return `
                    <div class="property-item connection-item" data-connection-id="${c.connectionId}">
                        <label class="property-label">${c.outputName}</label>
                        <div class="connection-info">
                            <span class="connection-type">to</span>
                            <span class="connection-desc">${toLabel}.${c.toPort}</span>
                        </div>
                    </div>`;
            }).join('') : '<div class="property-item"><em>No outgoing connections</em></div>';

            return `
                <div class="property-subtitle">Incoming</div>
                ${inc}
                <div class="property-subtitle" style="margin-top:8px;">Outgoing</div>
                ${out}
            `;
        };

        list.innerHTML = build(incoming, outgoing);
        this.attachConnectionListHandlers();
    }

    attachConnectionListHandlers() {
        const items = this.container.querySelectorAll('.connection-item');
        items.forEach(el => {
            const id = el.getAttribute('data-connection-id');
            if (!id) return;
            el.addEventListener('mouseenter', () => this.highlightConnection(id));
            el.addEventListener('mouseleave', () => this.unhighlightConnection(id));
            el.addEventListener('click', () => this.selectConnectionInCanvas(id));
        });
    }

    highlightConnection(connectionId) {
        const wc = (typeof window !== 'undefined') ? window['workflowCanvas'] : null;
        if (!wc) return;
        const conn = wc.connections.get(connectionId);
        if (conn && conn.element) conn.element.classList.add('highlight');
        this.lastHighlightedConnectionId = connectionId;
    }

    unhighlightConnection(connectionId) {
        const wc = (typeof window !== 'undefined') ? window['workflowCanvas'] : null;
        if (!wc) return;
        const conn = wc.connections.get(connectionId);
        if (conn && conn.element) conn.element.classList.remove('highlight');
        if (this.lastHighlightedConnectionId === connectionId) this.lastHighlightedConnectionId = null;
    }

    selectConnectionInCanvas(connectionId) {
        const wc = (typeof window !== 'undefined') ? window['workflowCanvas'] : null;
        if (!wc) return;
        wc.selectConnection(connectionId);
    }
    
    logPropertyChange(property, value) {
        if (window.logManager) {
            window.logManager.addLog('debug', `Property updated: ${property} = ${value}`);
        }
    }
    
    // Event system for property changes
    on(event, handler) {
        if (!this.eventHandlers) {
            this.eventHandlers = new Map();
        }
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }
    
    emit(event, data) {
        if (this.eventHandlers && this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in property event handler for ${event}:`, error);
                }
            });
        }
    }
    
    // Validation methods
    validateProperties(node) {
        if (!node || !node.definition || !node.definition.properties) {
            return { valid: true, errors: [] };
        }
        
        const errors = [];
        const definition = node.definition;
        
        Object.entries(definition.properties).forEach(([key, prop]) => {
            const value = node.properties[key];
            
            // Check required properties
            if (prop.required && (value === null || value === undefined || value === '')) {
                errors.push(`Property '${prop.label || key}' is required`);
            }
            
            // Check number ranges
            if (prop.type === 'number' && value !== null && value !== undefined) {
                if (prop.min !== undefined && value < prop.min) {
                    errors.push(`Property '${prop.label || key}' must be >= ${prop.min}`);
                }
                if (prop.max !== undefined && value > prop.max) {
                    errors.push(`Property '${prop.label || key}' must be <= ${prop.max}`);
                }
            }
            
            // Check string patterns
            if (prop.type === 'string' && prop.pattern && value) {
                const regex = new RegExp(prop.pattern);
                if (!regex.test(value)) {
                    errors.push(`Property '${prop.label || key}' format is invalid`);
                }
            }
        });
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
    
    // Property templates for common node types
    getPropertyTemplate(nodeType) {
        const templates = {
            llm_processor: {
                model: { type: 'select', options: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-haiku'], default: 'gpt-4' },
                max_tokens: { type: 'number', default: 1000, min: 1, max: 4096 },
                temperature: { type: 'number', default: 0.7, min: 0, max: 2, step: 0.1 }
            },
            memory_store: {
                collection: { type: 'string', default: 'default' },
                embedding_model: { type: 'select', options: ['sentence-transformers', 'openai-ada'], default: 'sentence-transformers' }
            },
            discord_send: {
                bot_token: { type: 'string', sensitive: true },
                channel_id: { type: 'string' },
                embed: { type: 'boolean', default: false }
            }
        };
        
        return templates[nodeType] || {};
    }
    
    // Bulk property operations
    setProperties(nodeId, properties) {
        if (this.currentNode && this.currentNode.id === nodeId) {
            Object.entries(properties).forEach(([key, value]) => {
                this.currentNode.properties[key] = value;
                
                // Update UI input if it exists
                const input = this.propertyInputs.get(key);
                if (input) {
                    if (input.type === 'checkbox') {
                        input.checked = value;
                    } else {
                        input.value = value;
                    }
                }
            });
        }
    }
    
    getProperties(nodeId) {
        if (this.currentNode && this.currentNode.id === nodeId) {
            return { ...this.currentNode.properties };
        }
        return null;
    }
}

// Export for use in other modules
window['NodeProperties'] = NodeProperties;
