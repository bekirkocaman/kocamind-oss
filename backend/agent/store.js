const { randomUUID } = require('crypto');

class FirestoreAgentStore {
  constructor(db) {
    this.db = db;
  }

  async createRun(data) {
    const id = data.id || randomUUID();
    await this.db.collection('agent_runs').doc(id).set({
      ...data,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return id;
  }

  async updateRun(id, patch) {
    await this.db.collection('agent_runs').doc(id).set({
      ...patch,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  async getRun(id) {
    const snapshot = await this.db.collection('agent_runs').doc(id).get();
    return snapshot.exists ? snapshot.data() : null;
  }

  async logTool(data) {
    const id = data.id || randomUUID();
    await this.db.collection('tool_executions').doc(id).set({
      ...data,
      id,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  async createConfirmation(data) {
    const id = data.id || randomUUID();
    await this.db.collection('confirmation_requests').doc(id).set({
      ...data,
      id,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  async resolveConfirmation(id, userId, approved) {
    const ref = this.db.collection('confirmation_requests').doc(id);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Onay isteği bulunamadı.');
      const data = snapshot.data();
      if (data.userId !== userId) throw new Error('Bu onay isteğine erişemezsin.');
      if (data.status !== 'pending') throw new Error('Bu onay isteği daha önce sonuçlandırılmış.');
      transaction.update(ref, {
        status: approved ? 'approved' : 'rejected',
        resolvedAt: new Date().toISOString(),
      });
      return data;
    });
  }
}

class MemoryAgentStore {
  constructor() {
    this.runs = new Map();
    this.confirmations = new Map();
    this.toolLogs = [];
  }
  async createRun(data) { const id = data.id || randomUUID(); this.runs.set(id, { ...data, id }); return id; }
  async updateRun(id, patch) { this.runs.set(id, { ...this.runs.get(id), ...patch }); }
  async getRun(id) { return this.runs.get(id) || null; }
  async logTool(data) { this.toolLogs.push(data); return data.id || randomUUID(); }
  async createConfirmation(data) { const id = data.id || randomUUID(); this.confirmations.set(id, { ...data, id, status: 'pending' }); return id; }
  async resolveConfirmation(id, userId, approved) {
    const data = this.confirmations.get(id);
    if (!data) throw new Error('Onay isteği bulunamadı.');
    if (data.userId !== userId) throw new Error('Bu onay isteğine erişemezsin.');
    if (data.status !== 'pending') throw new Error('Bu onay isteği daha önce sonuçlandırılmış.');
    this.confirmations.set(id, { ...data, status: approved ? 'approved' : 'rejected' });
    return data;
  }
}

module.exports = { FirestoreAgentStore, MemoryAgentStore };
