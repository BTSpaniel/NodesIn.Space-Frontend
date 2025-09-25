/**
 * Frontend Logging System
 * Provides comprehensive logging for the Visual AGI Node Editor
 */
class Logger {
    constructor() {
        this.logContainer = document.getElementById('execution-log');
        this.logs = [];
        this.maxLogs = 1000;
        // Predeclare for Closure Compiler (avoid late property creation warnings)
        this.originalConsole = null;
        this.logLevels = {
            ERROR: { color: '#ff6b6b', priority: 0 },
            WARN: { color: '#ffd93d', priority: 1 },
            INFO: { color: '#6bcf7f', priority: 2 },
            DEBUG: { color: '#4dabf7', priority: 3 }
        };
        
        // Console logging override
        this.setupConsoleOverride();
        
        // Log system startup
        this.info('Visual AGI Node Editor initialized');
    }
    
    setupConsoleOverride() {
        // Store original console methods
        this.originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info,
            debug: console.debug
        };
        
        // Override console methods to also log to our system
        console.log = (...args) => {
            this.originalConsole.log(...args);
            this.debug(args.join(' '));
        };
        
        console.error = (...args) => {
            this.originalConsole.error(...args);
            this.error(args.join(' '));
        };
        
        console.warn = (...args) => {
            this.originalConsole.warn(...args);
            this.warn(args.join(' '));
        };
        
        console.info = (...args) => {
            this.originalConsole.info(...args);
            this.info(args.join(' '));
        };
    }
    
    log(level, message, data = null) {
        const timestamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
        const logEntry = {
            timestamp,
            level,
            message,
            data,
            id: Date.now() + Math.random()
        };
        
        // Add to internal logs
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift(); // Remove oldest log
        }
        
        // Display in UI
        this.displayLog(logEntry);
        
        // Also log to browser console with colors
        const consoleMethod = this.originalConsole[level.toLowerCase()] || this.originalConsole.log;
        const color = this.logLevels[level] ? this.logLevels[level].color : '#ffffff'; // Default to white
        const style = `color: ${color}; font-weight: bold;`;

        if (data) {
            consoleMethod(`%c[${timestamp}] ${message}`, style, data);
        } else {
            consoleMethod(`%c[${timestamp}] ${message}`, style);
        }
    }
    
    displayLog(logEntry) {
        if (!this.logContainer) return;
        
        const logElement = document.createElement('div');
        logElement.className = `log-entry log-${logEntry.level.toLowerCase()}`;
        logElement.innerHTML = `
            <span class="timestamp">${logEntry.timestamp}</span>
            <span class="log-${logEntry.level.toLowerCase()}">${logEntry.message}</span>
        `;
        
        // Add data if present
        if (logEntry.data) {
            const dataElement = document.createElement('div');
            dataElement.className = 'log-data';
            dataElement.textContent = typeof logEntry.data === 'object' 
                ? JSON.stringify(logEntry.data, null, 2)
                : String(logEntry.data);
            logElement.appendChild(dataElement);
        }
        
        // Add to container
        this.logContainer.appendChild(logElement);
        
        // Auto-scroll to bottom
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
        
        // Limit visible logs for performance
        const logElements = this.logContainer.querySelectorAll('.log-entry');
        if (logElements.length > 100) {
            logElements[0].remove();
        }
    }
    
    error(message, data = null) {
        this.log('ERROR', message, data);
    }
    
    warn(message, data = null) {
        this.log('WARN', message, data);
    }
    
    info(message, data = null) {
        this.log('INFO', message, data);
    }
    
    debug(message, data = null) {
        this.log('DEBUG', message, data);
    }
    
    clear() {
        this.logs = [];
        if (this.logContainer) {
            this.logContainer.innerHTML = '<div class="log-entry"><span class="timestamp">00:00:00</span><span class="log-info">Logs cleared</span></div>';
        }
    }
    
    exportLogs() {
        const logsText = this.logs.map(log => 
            `[${log.timestamp}] ${log.level}: ${log.message}${log.data ? ' | ' + JSON.stringify(log.data) : ''}`
        ).join('\n');
        
        const blob = new Blob([logsText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agi-node-editor-logs-${new Date().toISOString().slice(0, 19)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.info('Logs exported successfully');
    }
    
    getStats() {
        const stats = {
            total: this.logs.length,
            errors: this.logs.filter(log => log.level === 'ERROR').length,
            warnings: this.logs.filter(log => log.level === 'WARN').length,
            info: this.logs.filter(log => log.level === 'INFO').length,
            debug: this.logs.filter(log => log.level === 'DEBUG').length
        };
        
        return stats;
    }
}

// Create global logger instance
window['logger'] = new Logger();

// Add logging controls to the interface
document.addEventListener('DOMContentLoaded', () => {
    // Add clear logs button to panel content (parent of log panels)
    const panelContent = document.querySelector('.panel-content');
    if (panelContent) {
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'log-controls';
        controlsDiv.innerHTML = `
            <button class="log-btn" onclick="logger.clear()">Clear Logs</button>
            <button class="log-btn" onclick="logger.exportLogs()">Export Logs</button>
            <button class="log-btn" onclick="console.log('Log Stats:', logger.getStats())">Show Stats</button>
        `;
        panelContent.appendChild(controlsDiv);
    }
});
