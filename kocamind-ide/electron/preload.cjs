const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  windowControls: (action) => ipcRenderer.send('window-controls', action),
  workspace: {
    open: () => ipcRenderer.invoke('workspace:open'),
    refresh: () => ipcRenderer.invoke('workspace:refresh'),
    readFile: (relPath) => ipcRenderer.invoke('workspace:readFile', relPath),
    writeFile: (relPath, content) => ipcRenderer.invoke('workspace:writeFile', { path: relPath, content }),
    createFile: (relPath) => ipcRenderer.invoke('workspace:createFile', { path: relPath }),
    createFolder: (relPath) => ipcRenderer.invoke('workspace:createFolder', { path: relPath }),
    rename: (from, to) => ipcRenderer.invoke('workspace:rename', { from, to }),
    delete: (relPath) => ipcRenderer.invoke('workspace:delete', { path: relPath }),
    listFiles: () => ipcRenderer.invoke('workspace:listFiles'),
  },
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    state: () => ipcRenderer.invoke('auth:state'),
  },
  agent: {
    start: (message, mode) => ipcRenderer.invoke('agent:start', { message, mode }),
    approve: (callId, approved) => ipcRenderer.invoke('agent:approve', { callId, approved }),
    abort: () => ipcRenderer.invoke('agent:abort'),
    newSession: () => ipcRenderer.invoke('agent:newSession'),
    listSessions: () => ipcRenderer.invoke('agent:listSessions'),
    resume: (sessionId, mode) => ipcRenderer.invoke('agent:resume', { sessionId, mode }),
    state: () => ipcRenderer.invoke('agent:state'),
    revertLastTurn: () => ipcRenderer.invoke('agent:revertLastTurn'),
    trace: () => ipcRenderer.invoke('agent:trace'),
    listModels: () => ipcRenderer.invoke('agent:listModels'),
    setModel: (selection) => ipcRenderer.invoke('agent:setModel', selection),
    onEvent: (callback) => {
      const h = (_e, payload) => callback(payload);
      ipcRenderer.on('agent:event', h);
      return () => ipcRenderer.removeListener('agent:event', h);
    },
    onDone: (callback) => {
      const h = (_e, payload) => callback(payload);
      ipcRenderer.on('agent:done', h);
      return () => ipcRenderer.removeListener('agent:done', h);
    },
  },
  terminal: {
    run: (command) => ipcRenderer.invoke('terminal:run', { command }),
    kill: () => ipcRenderer.invoke('terminal:kill'),
    state: () => ipcRenderer.invoke('terminal:state'),
    onData: (callback) => {
      const h = (_e, payload) => callback(payload);
      ipcRenderer.on('terminal:data', h);
      return () => ipcRenderer.removeListener('terminal:data', h);
    },
    onExit: (callback) => {
      const h = (_e, payload) => callback(payload);
      ipcRenderer.on('terminal:exit', h);
      return () => ipcRenderer.removeListener('terminal:exit', h);
    },
  },
});
