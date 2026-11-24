// Uzak MCP sunucularıyla (Streamable HTTP) konuşan istemci. Her çağrı kısa ömürlü
// bir bağlantı açar ve kapatır; serverless ortamda kalıcı bağlantı tutulmaz.
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const MAX_TOOLS = 100;
const MAX_PAGES = 5;
const MAX_DESCRIPTION = 1000;

class ConnectorAuthError extends Error {
  constructor(message = 'Bağlantının yetkisi geçersiz.') {
    super(message);
    this.name = 'ConnectorAuthError';
  }
}

function isAuthFailure(error) {
  const text = `${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`;
  return error?.name === 'UnauthorizedError' || error?.code === 401 || /\b401\b|unauthori[sz]ed|invalid_token/i.test(text);
}

function textFromContent(content = []) {
  return content
    .map(part => {
      if (part.type === 'text') return part.text;
      if (part.type === 'resource' && part.resource?.text) return part.resource.text;
      if (part.type === 'resource_link') return `${part.name || 'Kaynak'}: ${part.uri}`;
      return `[${part.type} içerik]`;
    })
    .join('\n');
}

function createRemoteMcp({ fetchFn, clientInfo = { name: 'KocaMind', version: '1.0.0' } } = {}) {
  async function withClient(connector, accessToken, fn) {
    const client = new Client(clientInfo);
    const transport = new StreamableHTTPClientTransport(new URL(connector.url), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
      ...(fetchFn ? { fetch: fetchFn } : {}),
    });
    try {
      await client.connect(transport);
      return await fn(client);
    } catch (error) {
      if (isAuthFailure(error)) throw new ConnectorAuthError();
      throw error;
    } finally {
      await client.close().catch(() => {});
    }
  }

  async function listTools(connector, accessToken) {
    return withClient(connector, accessToken, async client => {
      const tools = [];
      let cursor;
      for (let page = 0; page < MAX_PAGES && tools.length < MAX_TOOLS; page++) {
        const result = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...(result.tools || []));
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      return tools.slice(0, MAX_TOOLS).map(tool => ({
        name: tool.name,
        description: String(tool.description || tool.title || tool.name).slice(0, MAX_DESCRIPTION),
        inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
        // Yalnızca sunucunun açıkça "salt okunur" dediği araç onaysız çalışır.
        readOnly: tool.annotations?.readOnlyHint === true,
      }));
    });
  }

  async function callTool(connector, accessToken, name, args) {
    return withClient(connector, accessToken, async client => {
      const result = await client.callTool({ name, arguments: args || {} });
      const text = textFromContent(result.content)
        || (result.structuredContent ? JSON.stringify(result.structuredContent) : '');
      return { isError: result.isError === true, text };
    });
  }

  return { listTools, callTool };
}

module.exports = { createRemoteMcp, ConnectorAuthError, isAuthFailure };
