/**
 * Node Palette Management
 * Handles the left sidebar node library with drag and drop functionality
 */
class NodePalette {
    constructor() {
        this.container = document.getElementById('node-palette');
        this.searchInput = document.getElementById('node-search');
        this.nodeDefinitions = new Map();
        this.filteredNodes = [];
        
        this.setupEventListeners();
        // Nodes are provided by the backend via WebSocket (available_nodes).
        // Do not initialize defaults in JS to avoid divergence with Python definitions.
        this.render();
    }
    
    setupEventListeners() {
        // Search functionality
        this.searchInput.addEventListener('input', (e) => {
            this.filterNodes(e.target.value);
        });
        
        // Handle drag start from palette
        this.container.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('node-item')) {
                const nodeType = e.target.dataset.nodeType;
                e.dataTransfer.setData('text/plain', nodeType);
                e.dataTransfer.effectAllowed = 'copy';
                e.target.classList.add('dragging');
            }
        });
        
        this.container.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('node-item')) {
                e.target.classList.remove('dragging');
            }
        });
    }
    
    initializeDefaultNodes() {
        // Deprecated: JS no longer defines nodes. Definitions are supplied by the backend (available_nodes).
        // Kept as a no-op to avoid breaking code that might still call it.
        return;
    }
    
    updateFromServer(nodes) {
        this.nodeDefinitions.clear();
        nodes.forEach(nodeDef => {
            this.addNodeDefinition(nodeDef);
        });
        this.filterNodes(this.searchInput.value); // Re-filter and render
    }

    addNodeDefinition(definition) {
        this.nodeDefinitions.set(definition.type, definition);
    }
    
    filterNodes(searchTerm) {
        const term = searchTerm.toLowerCase();
        this.filteredNodes = Array.from(this.nodeDefinitions.values()).filter(node => 
            node.name.toLowerCase().includes(term) || 
            node.description.toLowerCase().includes(term) ||
            node.category.toLowerCase().includes(term)
        );
        this.render();
    }
    
    render() {
        const nodesToShow = this.filteredNodes.length > 0 || this.searchInput.value ? 
            this.filteredNodes : Array.from(this.nodeDefinitions.values());
        
        // Group nodes by category
        const categories = {};
        nodesToShow.forEach(node => {
            if (!categories[node.category]) {
                categories[node.category] = [];
            }
            categories[node.category].push(node);
        });
        
        // Clear container
        this.container.innerHTML = '';
        
        // Render categories
        Object.keys(categories).sort().forEach(categoryName => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'category';
            
            const categoryHeader = document.createElement('h4');
            categoryHeader.textContent = categoryName;
            categoryDiv.appendChild(categoryHeader);
            
            categories[categoryName].forEach(node => {
                const nodeItem = document.createElement('div');
                nodeItem.className = 'node-item';
                nodeItem.draggable = true;
                nodeItem.dataset.nodeType = node.type;
                nodeItem.innerHTML = `
                    <div style="font-weight: 600; margin-bottom: 2px;">${node.name}</div>
                    <div style="font-size: 11px; color: #8c8c8c;">${node.description}</div>
                `;
                categoryDiv.appendChild(nodeItem);
            });
            
            this.container.appendChild(categoryDiv);
        });
    }
    
    getNodeDefinition(type) {
        return this.nodeDefinitions.get(type);
    }
    
    getAllNodeDefinitions() {
        return Array.from(this.nodeDefinitions.values());
    }
}

// Export for use in other modules
window['NodePalette'] = NodePalette;
