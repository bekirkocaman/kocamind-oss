const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createRemoteMcp, ConnectorAuthError } = require('../connectors/remoteMcp');

const TOKEN = 'dogru-token';

function buildServer() {
  const server = new McpServer({ name: 'sahte-notion', version: '1.0.0' });
  server.registerTool('search', {
    description: 'Sayfalarda arar',
    inputSchema: { query: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ query }) => ({ content: [{ type: 'text', text: `Sonuç: ${query}` }] }));
  server.registerTool('create_page', {
    description: 'Sayfa oluşturur',
    inputSchema: { title: z.string() },
  }, async ({ title }) => ({ content: [{ type: 'text', text: `Oluşturuldu: ${title}` }] }));
  server.registerTool('fail', { description: 'Hata verir', inputSchema: {} }, async () => ({ isError: true, content: [{ type: 'text', text: 'İzin yok' }] }));
  return server;
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.post('/mcp', async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.status(401).json({ error: 'unauthorized' });
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const listener = await new Promise(resolve => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  return { url: `http://127.0.0.1:${listener.address().port}/mcp`, close: () => new Promise(resolve => listener.close(resolve)) };
}

test('uzak MCP: araçları listeler, okuma/yazma ayrımını annotations ile yapar', async t => {
  const server = await startServer();
  t.after(server.close);
  const mcp = createRemoteMcp();
  const tools = await mcp.listTools({ url: server.url }, TOKEN);
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  assert.deepEqual(Object.keys(byName).sort(), ['create_page', 'fail', 'search']);
  assert.equal(byName.search.readOnly, true);
  assert.equal(byName.create_page.readOnly, false);
  assert.equal(byName.search.inputSchema.type, 'object');
  assert.ok(byName.search.inputSchema.properties.query);
});

test('uzak MCP: aracı çağırır, metin içeriğini ve hata bayrağını döndürür', async t => {
  const server = await startServer();
  t.after(server.close);
  const mcp = createRemoteMcp();
  assert.deepEqual(await mcp.callTool({ url: server.url }, TOKEN, 'search', { query: 'plan' }), { isError: false, text: 'Sonuç: plan' });
  assert.deepEqual(await mcp.callTool({ url: server.url }, TOKEN, 'fail', {}), { isError: true, text: 'İzin yok' });
});

test('uzak MCP: geçersiz token ConnectorAuthError fırlatır', async t => {
  const server = await startServer();
  t.after(server.close);
  const mcp = createRemoteMcp();
  await assert.rejects(() => mcp.listTools({ url: server.url }, 'yanlis'), ConnectorAuthError);
});
