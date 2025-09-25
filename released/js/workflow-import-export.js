/**
 * Workflow Import/Export Manager
 * Handles saving, loading, and serializing workflows
 */
class WorkflowImportExport {
    constructor(workflowCanvas, webSocket = null) {
        this.canvas = workflowCanvas;
        this.storageKey = 'agi_workflows';
        this.ws = webSocket || (typeof window !== 'undefined' ? window['webSocket'] : null);
    }

    setWebSocket(webSocket) {
        this.ws = webSocket;
    }

    /**
     * Generate a default workflow name that is human readable and unique vs local storage
     */
    generateWorkflowName() {
        try {
            const d = new Date();
            const ts = d.toISOString().slice(0, 19).replace(/[:T]/g, '-'); // YYYY-MM-DD-HH-MM-SS
            const base = 'workflow-' + ts;
            const existing = this.getLocalWorkflows();
            const names = Array.isArray(existing) ? existing.map(function (w) { return w && w.name ? String(w.name) : ''; }) : [];
            if (names.indexOf(base) === -1) return base;
            let i = 2;
            let candidate = base + '-' + i;
            while (names.indexOf(candidate) !== -1) {
                i++;
                candidate = base + '-' + i;
            }
            return candidate;
        } catch (e) {
            return 'workflow-' + Date.now();
        }
    }

    /**
     * Save workflow with user-specified name and location
     */
    async saveWorkflow(workflowName = null, saveLocation = null) {
        try {
            console.log('saveWorkflow called with:', workflowName, saveLocation);
            
            // Get save options from user if not provided
            console.log('Calling showSaveDialog...');
            const saveOptions = await this.showSaveDialog(workflowName);
            console.log('Dialog result:', saveOptions);
            
            if (!saveOptions) {
                return {
                    success: false,
                    message: 'Save cancelled by user'
                };
            }

            // Get workflow data from canvas
            const workflowData = this.canvas.exportWorkflow();
            
            // Create workflow metadata
            const workflow = {
                id: workflowData.workflow_id,
                name: saveOptions.name,
                created: workflowData.created,
                modified: new Date().toISOString(),
                version: '1.0',
                nodes: workflowData.nodes,
                connections: workflowData.connections,
                metadata: {
                    nodeCount: workflowData.nodes.length,
                    connectionCount: workflowData.connections.length,
                    canvasTransform: this.canvas.canvasTransform,
                    saveLocation: saveOptions.location
                }
            };

            let result;
            switch (saveOptions.location) {
                case 'file':
                    result = await this.saveToFile(workflow);
                    break;
                case 'localStorage':
                    result = this.saveToLocalStorage(workflow);
                    break;
                case 'backend':
                    result = await this.saveToBackend(workflow);
                    break;
                default:
                    // Default to localStorage
                    result = this.saveToLocalStorage(workflow);
            }

            if (result.success) {
                // Log success
                if (window.logger) {
                    window.logger.info(`Workflow saved: ${workflow.name} (${saveOptions.location})`);
                }

                return {
                    success: true,
                    workflow: workflow,
                    message: `Workflow "${workflow.name}" saved to ${saveOptions.location} successfully`
                };
            } else {
                return result;
            }

        } catch (error) {
            console.error('Error saving workflow:', error);
            if (window.logger) {
                window.logger.error('Failed to save workflow: ' + error.message);
            }
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Load workflow with location selection
     */
    async loadWorkflow(workflowId = null, fromLocation = null) {
        try {
            // Show load dialog to let user choose location and workflow
            const loadOptions = await this.showLoadDialog(fromLocation);
            if (!loadOptions) {
                return {
                    success: false,
                    message: 'Load cancelled by user'
                };
            }

            let workflowToLoad;

            switch (loadOptions.location) {
                case 'file':
                    // Parse file but do not import to canvas here to avoid double-import
                    const fileResult = await this.importFromFile(true);
                    if (fileResult.success) {
                        workflowToLoad = fileResult.workflow;
                    } else {
                        return fileResult;
                    }
                    break;
                    
                case 'localStorage':
                    const savedWorkflows = this.getLocalWorkflows();
                    if (savedWorkflows.length === 0) {
                        return {
                            success: false,
                            message: 'No saved workflows found in local storage'
                        };
                    }

                    if (workflowId) {
                        workflowToLoad = savedWorkflows.find(w => w.id === workflowId);
                        if (!workflowToLoad) {
                            return {
                                success: false,
                                message: `Workflow with ID ${workflowId} not found`
                            };
                        }
                    } else {
                        workflowToLoad = await this.showLocalWorkflowPicker(savedWorkflows);
                        if (!workflowToLoad) {
                            return {
                                success: false,
                                message: 'No workflow selected'
                            };
                        }
                    }
                    break;
                    
                case 'backend':
                    const backendResult = await this.loadFromBackend();
                    if (backendResult.success) {
                        workflowToLoad = backendResult.workflow;
                    } else {
                        return backendResult;
                    }
                    break;
                    
                default:
                    return {
                        success: false,
                        message: 'Invalid load location specified'
                    };
            }

            if (!workflowToLoad) {
                return {
                    success: false,
                    message: 'No workflow found to load'
                };
            }

            // Import workflow to canvas exactly once
            await this.canvas.importWorkflow(workflowToLoad);

            // Restore canvas transform if available
            if (workflowToLoad.metadata && workflowToLoad.metadata.canvasTransform) {
                this.canvas.canvasTransform = { ...workflowToLoad.metadata.canvasTransform };
                this.canvas.applyCanvasTransform();
            }

            if (window.logger) {
                window.logger.info(`Workflow loaded: ${workflowToLoad.name} (${loadOptions.location})`);
            }

            return {
                success: true,
                workflow: workflowToLoad,
                message: `Workflow "${workflowToLoad.name}" loaded from ${loadOptions.location} successfully`
            };

        } catch (error) {
            console.error('Error loading workflow:', error);
            if (window.logger) {
                window.logger.error('Failed to load workflow: ' + error.message);
            }
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Export workflow to JSON file
     */
    async exportToFile(workflowId = null) {
        try {
            let workflowData;

            if (workflowId) {
                // Export specific saved workflow
                const savedWorkflows = this.getLocalWorkflows();
                workflowData = savedWorkflows.find(w => w.id === workflowId);
                if (!workflowData) {
                    throw new Error(`Workflow with ID ${workflowId} not found`);
                }
            } else {
                // Export current canvas state
                const canvasData = this.canvas.exportWorkflow();
                workflowData = {
                    id: canvasData.workflow_id,
                    name: 'Exported Workflow',
                    created: canvasData.created,
                    modified: new Date().toISOString(),
                    version: '1.0',
                    nodes: canvasData.nodes,
                    connections: canvasData.connections,
                    metadata: {
                        nodeCount: canvasData.nodes.length,
                        connectionCount: canvasData.connections.length,
                        canvasTransform: this.canvas.canvasTransform,
                        exportedAt: new Date().toISOString()
                    }
                };
            }

            // Create and download file
            const jsonString = JSON.stringify(workflowData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `${workflowData.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.json`;
            a.click();
            
            URL.revokeObjectURL(url);

            if (window.logger) {
                window.logger.info(`Workflow exported to file: ${a.download}`);
            }

            return {
                success: true,
                filename: a.download,
                message: `Workflow exported as ${a.download}`
            };

        } catch (error) {
            console.error('Error exporting workflow:', error);
            if (window.logger) {
                window.logger.error('Failed to export workflow: ' + error.message);
            }
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Import workflow from JSON file
     */
    async importFromFile(skipCanvasImport = false) {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            
            input.onchange = async (e) => {
                try {
                    const file = e.target.files[0];
                    if (!file) {
                        resolve({
                            success: false,
                            message: 'No file selected'
                        });
                        return;
                    }

                    const text = await file.text();
                    const workflowData = JSON.parse(text);

                    // Validate workflow data
                    if (!this.validateWorkflowData(workflowData)) {
                        resolve({
                            success: false,
                            message: 'Invalid workflow file format'
                        });
                        return;
                    }

                    if (!skipCanvasImport) {
                        // Import to canvas
                        await this.canvas.importWorkflow(workflowData);

                        // Restore canvas transform if available
                        if (workflowData.metadata && workflowData.metadata.canvasTransform) {
                            this.canvas.canvasTransform = { ...workflowData.metadata.canvasTransform };
                            this.canvas.applyCanvasTransform();
                        }
                    }

                    // Save to localStorage for future access
                    this.saveToLocalStorage(workflowData);

                    if (window.logger) {
                        window.logger.info(`Workflow imported from file: ${file.name}`);
                    }

                    resolve({
                        success: true,
                        workflow: workflowData,
                        message: `Workflow "${workflowData.name}" imported successfully`
                    });

                } catch (error) {
                    console.error('Error importing workflow:', error);
                    if (window.logger) {
                        window.logger.error('Failed to import workflow: ' + error.message);
                    }
                    resolve({
                        success: false,
                        error: error.message
                    });
                }
            };

            input.click();
        });
    }

    /**
     * Get list of saved workflows
     */
    getLocalWorkflows() {
        try {
            return JSON.parse((window && window.localStorage ? window.localStorage.getItem(this.storageKey) : null) || '[]');
        } catch (error) {
            console.error('Error reading workflows from localStorage:', error);
            return [];
        }
    }

    /**
     * Delete a saved workflow
     */
    deleteWorkflow(workflowId) {
        try {
            const workflows = this.getLocalWorkflows();
            const filteredWorkflows = workflows.filter(w => w.id !== workflowId);
            if (window && window.localStorage) {
                window.localStorage.setItem(this.storageKey, JSON.stringify(filteredWorkflows));
            }
            
            if (window.logger) {
                window.logger.info(`Workflow deleted: ${workflowId}`);
            }
            
            return {
                success: true,
                message: 'Workflow deleted successfully'
            };
        } catch (error) {
            console.error('Error deleting workflow:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    renameWorkflowLocal(workflowId, newName) {
        try {
            const workflows = this.getLocalWorkflows();
            const idx = workflows.findIndex(w => w.id === workflowId);
            if (idx === -1) {
                return { success: false, error: `Workflow not found: ${workflowId}` };
            }
            workflows[idx].name = newName;
            workflows[idx].modified = new Date().toISOString();
            if (window && window.localStorage) {
                window.localStorage.setItem(this.storageKey, JSON.stringify(workflows));
            }
            if (window.logger) {
                window.logger.info(`Workflow renamed: ${workflowId} -> ${newName}`);
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Show save dialog to get name and location
     */
    async showSaveDialog(suggestedName = null) {
        console.log('showSaveDialog called with:', suggestedName);
        
        return new Promise((resolve) => {
            console.log('Creating save modal...');
            
            // Create modal dialog
            const modal = this.createModal('Save Workflow', `
                <div class="save-dialog">
                    <div class="form-group">
                        <label for="workflow-name">Workflow Name:</label>
                        <input type="text" id="workflow-name" class="form-input" value="${suggestedName || this.generateWorkflowName()}" placeholder="Enter workflow name">
                        <div id="workflow-name-error" class="form-error"></div>
                    </div>
                    <div class="form-group">
                        <label for="save-location">Save Location:</label>
                        <select id="save-location" class="form-select">
                            <option value="localStorage">Local Storage (Browser)</option>
                            <option value="file">Download as File</option>
                            <option value="backend">Backend Server</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <small class="help-text">
                            <strong>Local Storage:</strong> Saved in browser, accessible only on this device<br>
                            <strong>File:</strong> Downloads .json file to your computer
                        </small>
                    </div>
                </div>
            `, [
                { text: 'Save', primary: true, callback: () => {
                    const nameInput = document.getElementById('workflow-name');
                    const errorEl = document.getElementById('workflow-name-error');
                    const name = nameInput ? nameInput.value.trim() : '';
                    const location = document.getElementById('save-location').value;

                    if (!name) {
                        if (errorEl) {
                            errorEl.textContent = 'Please enter a workflow name';
                            errorEl.style.display = 'block';
                        }
                        if (nameInput) {
                            nameInput.focus();
                            nameInput.select();
                        }
                        return false; // Don't close modal
                    }

                    if (errorEl) errorEl.style.display = 'none';
                    resolve({ name, location });
                    return true; // Close modal
                }},
                { text: 'Cancel', callback: () => {
                    resolve(null);
                    return true; // Close modal
                }}
            ]);
        });
    }

    /**
     * Show load dialog to choose location and workflow
     */
    async showLoadDialog(fromLocation = null) {
        return new Promise((resolve) => {
            const modal = this.createModal('Load Workflow', `
                <div class="load-dialog">
                    <div class="form-group">
                        <label for="load-location">Load From:</label>
                        <select id="load-location" class="form-select">
                            <option value="localStorage">Local Storage (Browser)</option>
                            <option value="file">Import from File</option>
                            <option value="backend">Backend Server</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <small class="help-text">
                            <strong>Local Storage:</strong> Load from workflows saved in this browser<br>
                            <strong>File:</strong> Import a .json workflow file from your computer
                        </small>
                    </div>
                </div>
            `, [
                { text: 'Continue', primary: true, callback: () => {
                    const location = document.getElementById('load-location').value;
                    resolve({ location });
                    return true; // Close modal
                }},
                { text: 'Cancel', callback: () => {
                    resolve(null);
                    return true; // Close modal
                }}
            ]);

            // Pre-select location if provided
            if (fromLocation) {
                setTimeout(() => {
                    const select = document.getElementById('load-location');
                    if (select) select.value = fromLocation;
                }, 100);
            }
        });
    }

    /**
     * Create a modal dialog
     */
    createModal(title, content, buttons) {
        console.log('createModal called with title:', title);
        
        // Remove existing modal if any
        const existingModal = document.querySelector('.workflow-modal');
        if (existingModal) {
            console.log('Removing existing modal');
            existingModal.remove();
        }

        // Create modal HTML
        const modal = document.createElement('div');
        modal.className = 'workflow-modal';
        modal.innerHTML = `
            <div class="modal-overlay">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${title}</h3>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        ${content}
                    </div>
                    <div class="modal-footer">
                        ${buttons.map(btn => 
                            `<button class="btn ${btn.primary ? 'btn-primary' : 'btn-secondary'}" data-action="${btn.text.toLowerCase()}">${btn.text}</button>`
                        ).join('')}
                    </div>
                </div>
            </div>
        `;

        // Add to document
        console.log('Appending modal to document body');
        document.body.appendChild(modal);
        console.log('Modal appended successfully');

        // Setup event handlers
        const closeModal = () => {
            modal.remove();
        };

        // Close button
        modal.querySelector('.modal-close').addEventListener('click', closeModal);

        // Button handlers
        buttons.forEach(btn => {
            const button = modal.querySelector(`[data-action="${btn.text.toLowerCase()}"]`);
            button.addEventListener('click', () => {
                const shouldClose = btn.callback();
                if (shouldClose) {
                    closeModal();
                }
            });
        });

        // Close on overlay click
        modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
            if (e.target === modal.querySelector('.modal-overlay')) {
                closeModal();
            }
        });

        // Focus first input
        setTimeout(() => {
            const firstInput = modal.querySelector('input, select');
            if (firstInput) firstInput.focus();
        }, 100);

        return modal;
    }


    /**
     * Private helper methods
     */
    saveToLocalStorage(workflow) {
        try {
            const workflows = this.getLocalWorkflows();
            const existingIndex = workflows.findIndex(w => w.id === workflow.id);
            
            if (existingIndex >= 0) {
                workflows[existingIndex] = workflow;
            } else {
                workflows.push(workflow);
            }
            
            if (window && window.localStorage) {
                window.localStorage.setItem(this.storageKey, JSON.stringify(workflows));
            }
            
            return {
                success: true,
                message: 'Workflow saved to local storage'
            };
        } catch (error) {
            return {
                success: false,
                error: 'Failed to save to local storage: ' + error.message
            };
        }
    }

    /**
     * Save workflow to file
     */
    async saveToFile(workflow) {
        try {
            const jsonString = JSON.stringify(workflow, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `${workflow.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
            a.click();
            
            URL.revokeObjectURL(url);

            return {
                success: true,
                filename: a.download,
                message: 'Workflow downloaded as file'
            };
        } catch (error) {
            return {
                success: false,
                error: 'Failed to save to file: ' + error.message
            };
        }
    }

    /**
     * Save workflow to backend (placeholder for future implementation)
     */
    async saveToBackend(workflow) {
        try {
            if (!this.ws) {
                throw new Error('Backend connection not available');
            }
            // Ensure workflow_id for backend compatibility
            if (!workflow.workflow_id) {
                workflow.workflow_id = workflow.id || 'workflow_' + Date.now();
            }
            const result = await this.ws.saveWorkflow(workflow);
            if (result && result.success) {
                return {
                    success: true,
                    message: 'Workflow saved to backend',
                    info: result.data
                };
            } else {
                throw new Error((result && result.error) ? result.error : 'Unknown backend save error');
            }
        } catch (error) {
            return { success: false, error: 'Failed to save to backend: ' + error.message };
        }
    }

    /**
     * Load workflow from backend (placeholder for future implementation)
     */
    async loadFromBackend() {
        try {
            if (!this.ws) {
                throw new Error('Backend connection not available');
            }
            const listResp = await this.ws.listWorkflows();
            if (!listResp || !listResp.success) {
                throw new Error(listResp ? (listResp.error || 'Failed to get workflow list') : 'Failed to get workflow list');
            }
            const workflows = (listResp && listResp.data && Array.isArray(listResp.data.workflows)) ? listResp.data.workflows : [];
            if (workflows.length === 0) {
                return { success: false, message: 'No saved workflows found on backend' };
            }

            const selection = await this.showBackendWorkflowPicker(workflows);
            if (!selection) {
                return { success: false, message: 'No workflow selected' };
            }

            const workflowId = selection.workflow_id || selection.id;
            const loadResp = await this.ws.loadWorkflow(workflowId);
            if (!loadResp || !loadResp.success) {
                throw new Error(loadResp ? (loadResp.error || 'Failed to load workflow') : 'Failed to load workflow');
            }
            const workflow = loadResp.data;
            return { success: true, workflow, message: 'Loaded "' + selection.name + '" from backend' };
        } catch (error) {
            return { success: false, error: 'Failed to load from backend: ' + error.message };
        }
    }

    /**
     * Show a picker for workflows stored in localStorage
     */
    async showLocalWorkflowPicker(workflows) {
        return new Promise((resolve) => {
            const buildOptions = () => (workflows || [])
                .map((w) => {
                    const mod = w.modified ? new Date(w.modified).toLocaleString() : '';
                    const safeName = (w && w.name) ? String(w.name) : (w && w.id) ? String(w.id) : 'workflow';
                    return `<option value="${w.id}">${safeName} ${mod ? `(${mod})` : ''}</option>`;
                })
                .join('');

            const modal = this.createModal('Select Saved Workflow', `
                <div class="form-group">
                    <label for="local-workflow-select">Saved Workflows:</label>
                    <select id="local-workflow-select" class="form-select">
                        ${buildOptions()}
                    </select>
                </div>
            `, [
                { text: 'Load', primary: true, callback: () => {
                    const sel = document.getElementById('local-workflow-select');
                    const selectedId = sel ? sel.value : null;
                    const selected = (workflows || []).find(w => w.id === selectedId);
                    resolve(selected || null);
                    return true;
                }},
                { text: 'Rename', callback: () => {
                    const sel = document.getElementById('local-workflow-select');
                    const selectedId = sel ? sel.value : null;
                    if (!selectedId) return false;
                    const idx = (workflows || []).findIndex(w => w.id === selectedId);
                    if (idx < 0) return false;
                    const current = workflows[idx];
                    const proposed = prompt('Enter new name:', current && current.name ? current.name : selectedId);
                    const newName = (proposed || '').trim();
                    if (!newName) return false;
                    workflows[idx].name = newName;
                    workflows[idx].modified = new Date().toISOString();
                    // Persist change
                    try {
                        const list = this.getLocalWorkflows();
                        const j = list.findIndex(w => w.id === selectedId);
                        if (j >= 0) {
                            list[j].name = newName;
                            list[j].modified = workflows[idx].modified;
                            if (window && window.localStorage) {
                                window.localStorage.setItem(this.storageKey, JSON.stringify(list));
                            }
                        }
                    } catch (e) {}
                    // Refresh options
                    const select = document.getElementById('local-workflow-select');
                    if (select) {
                        select.innerHTML = buildOptions();
                        select.value = selectedId;
                    }
                    if (window.logger) window.logger.info(`Local workflow renamed to: ${newName}`);
                    return false; // keep picker open
                }},
                { text: 'Delete', callback: () => {
                    const sel = document.getElementById('local-workflow-select');
                    const selectedId = sel ? sel.value : null;
                    if (!selectedId) return false;
                    if (!confirm('Delete this saved workflow from this browser?')) return false;
                    // Remove from local array and storage
                    const idx = (workflows || []).findIndex(w => w.id === selectedId);
                    if (idx >= 0) workflows.splice(idx, 1);
                    try {
                        const list = this.getLocalWorkflows().filter(w => w.id !== selectedId);
                        if (window && window.localStorage) {
                            window.localStorage.setItem(this.storageKey, JSON.stringify(list));
                        }
                    } catch (e) {}
                    const select = document.getElementById('local-workflow-select');
                    if (select) {
                        select.innerHTML = buildOptions();
                        if (workflows.length > 0) select.value = workflows[0].id;
                    }
                    if (window.logger) window.logger.info(`Local workflow deleted: ${selectedId}`);
                    return false; // keep picker open
                }},
                { text: 'Cancel', callback: () => { resolve(null); return true; } }
            ]);
        });
    }

/**
 * Show backend workflow picker
 */
async showBackendWorkflowPicker(workflows) {
    return new Promise((resolve) => {
        const buildOptions = () => workflows
            .map(w => {
                const mod = w.modified ? new Date(w.modified).toLocaleString() : '';
                const id = w.workflow_id || w.id;
                const safeName = (w.name || id);
                return `<option value="${id}">${safeName} ${mod ? `(${mod})` : ''}</option>`;
            })
            .join('');

        const modal = this.createModal('Select Backend Workflow', `
            <div class="form-group">
                <label for="backend-workflow-select">Saved Workflows:</label>
                <select id="backend-workflow-select" class="form-select">
                    ${buildOptions()}
                </select>
            </div>
        `, [
            { text: 'Load', primary: true, callback: () => {
                const sel = document.getElementById('backend-workflow-select');
                const selectedId = sel ? sel.value : null;
                const selected = workflows.find(w => (w.workflow_id || w.id) === selectedId);
                resolve(selected || null);
                return true;
            }},
            { text: 'Rename', callback: () => {
                if (!this.ws) return false;
                const sel = document.getElementById('backend-workflow-select');
                const selectedId = sel ? sel.value : null;
                if (!selectedId) return false;
                const current = workflows.find(w => (w.workflow_id || w.id) === selectedId);
                const proposed = prompt('Enter new name:', current ? current.name : selectedId);
                const newName = (proposed || '').trim();
                if (!newName) return false;
                this.ws.renameWorkflow(selectedId, newName).then((res) => {
                    if (res && res.success) {
                        const target = workflows.find(w => (w.workflow_id || w.id) === selectedId);
                        if (target) { target.name = newName; target.modified = new Date().toISOString(); }
                        const select = document.getElementById('backend-workflow-select');
                        if (select) {
                            select.innerHTML = buildOptions();
                            select.value = selectedId;
                        }
                        if (window.logger) window.logger.info(`Backend workflow renamed to: ${newName}`);
                    } else if (window.logger) {
                        window.logger.error(res ? res.error : 'Backend rename failed');
                    }
                });
                return false; // keep picker open
            }},
            { text: 'Delete', callback: () => {
                if (!this.ws) return false;
                const sel = document.getElementById('backend-workflow-select');
                const selectedId = sel ? sel.value : null;
                if (!selectedId) return false;
                if (!confirm('Delete this workflow from the backend?')) return false;
                this.ws.deleteWorkflow(selectedId).then((res) => {
                    if (res && res.success) {
                        const idx = workflows.findIndex(w => (w.workflow_id || w.id) === selectedId);
                        if (idx >= 0) workflows.splice(idx, 1);
                        const select = document.getElementById('backend-workflow-select');
                        if (select) {
                            select.innerHTML = buildOptions();
                            if (workflows.length > 0) {
                                const newId = workflows[0].workflow_id || workflows[0].id;
                                select.value = newId;
                            }
                        }
                        if (window.logger) window.logger.info(`Backend workflow deleted: ${selectedId}`);
                    } else if (window.logger) {
                        window.logger.error(res ? res.error : 'Backend delete failed');
                    }
                });
                return false; // keep picker open
            }},
            { text: 'Refresh', callback: () => {
                if (!this.ws) return false;
                this.ws.listWorkflows().then((res) => {
                    if (res && res.success && res.data && res.data.workflows) {
                        workflows.length = 0; workflows.push(...res.data.workflows);
                        const select = document.getElementById('backend-workflow-select');
                        if (select) select.innerHTML = buildOptions();
                    } else if (window.logger) {
                        window.logger.error(res ? res.error : 'Failed to refresh backend list');
                    }
                });
                return false; // keep picker open
            }},
            { text: 'Cancel', callback: () => { resolve(null); return true; } }
        ]);
    });
    }

    validateWorkflowData(data) {
        return (
            data &&
            typeof data === 'object' &&
            data.id &&
            data.name &&
            Array.isArray(data.nodes) &&
            Array.isArray(data.connections)
        );
    }
}

// Export for use in other modules
window['WorkflowImportExport'] = WorkflowImportExport;
