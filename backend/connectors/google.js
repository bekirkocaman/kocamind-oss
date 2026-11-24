// Google Takvim ve Drive için yerleşik bağlayıcılar. Uzak MCP bağlayıcılarıyla
// aynı arayüzü sunar: listTools() ve callTool(token, ad, argümanlar).
// Drive `drive.file` kapsamıyla yalnızca KocaMind'in oluşturduğu ya da kullanıcının
// KocaMind ile açtığı dosyaları görür.
const { z } = require('zod');
const { ConnectorAuthError } = require('./remoteMcp');

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink';
const MAX_FILE_CHARS = 50000;

const dateTime = z.string().min(10).max(40).refine(value => !Number.isNaN(Date.parse(value)), 'Geçerli bir tarih/saat olmalı (ISO 8601).');

function tool(definition) {
  return definition;
}

async function googleFetch(fetchFn, token, url, init = {}) {
  const response = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (response.status === 401) throw new ConnectorAuthError();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || response.status;
    throw new Error(`Google isteği başarısız (${reason}).`);
  }
  return response;
}

function eventTime(value, timeZone) {
  // Yalnızca tarih (YYYY-MM-DD) tüm gün etkinliğidir.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: value, timeZone };
}

function slimEvent(event) {
  return {
    id: event.id,
    summary: event.summary || '(başlıksız)',
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    location: event.location || null,
    description: event.description ? String(event.description).slice(0, 500) : null,
    link: event.htmlLink || null,
  };
}

function createGoogleCalendar({ fetchFn = fetch, now = () => new Date() } = {}) {
  const tools = [
    tool({
      name: 'list_events',
      description: 'Kullanıcının birincil Google Takvim\'indeki etkinlikleri listeler. Varsayılan: şu andan itibaren yaklaşan etkinlikler.',
      readOnly: true,
      schema: z.object({
        time_min: dateTime.optional(),
        time_max: dateTime.optional(),
        query: z.string().max(200).optional(),
        max_results: z.number().int().min(1).max(50).optional(),
      }).strict(),
      inputSchema: {
        type: 'object',
        properties: {
          time_min: { type: 'string', description: 'Başlangıç (ISO 8601), ör. 2026-10-13T00:00:00+03:00' },
          time_max: { type: 'string', description: 'Bitiş (ISO 8601)' },
          query: { type: 'string', description: 'Başlık/açıklamada aranacak metin' },
          max_results: { type: 'integer', description: '1-50, varsayılan 10' },
        },
      },
      run: async (token, args) => {
        const params = new URLSearchParams({
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: String(args.max_results || 10),
          timeMin: new Date(args.time_min || now()).toISOString(),
        });
        if (args.time_max) params.set('timeMax', new Date(args.time_max).toISOString());
        if (args.query) params.set('q', args.query);
        const response = await googleFetch(fetchFn, token, `${CALENDAR_API}/calendars/primary/events?${params}`);
        const data = await response.json();
        return { events: (data.items || []).map(slimEvent) };
      },
    }),
    tool({
      name: 'create_event',
      description: 'Kullanıcının birincil Google Takvim\'ine yeni etkinlik ekler. Yalnızca tarih (YYYY-MM-DD) verilirse tüm gün etkinliği olur.',
      readOnly: false,
      schema: z.object({
        summary: z.string().min(1).max(300),
        start: dateTime,
        end: dateTime,
        time_zone: z.string().max(60).optional(),
        description: z.string().max(4000).optional(),
        location: z.string().max(300).optional(),
      }).strict(),
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Etkinlik başlığı' },
          start: { type: 'string', description: 'Başlangıç: ISO 8601 tarih-saat ya da YYYY-MM-DD' },
          end: { type: 'string', description: 'Bitiş: ISO 8601 tarih-saat ya da YYYY-MM-DD' },
          time_zone: { type: 'string', description: 'Varsayılan Europe/Istanbul' },
          description: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['summary', 'start', 'end'],
      },
      run: async (token, args) => {
        const timeZone = args.time_zone || 'Europe/Istanbul';
        const body = {
          summary: args.summary,
          start: eventTime(args.start, timeZone),
          end: eventTime(args.end, timeZone),
          ...(args.description ? { description: args.description } : {}),
          ...(args.location ? { location: args.location } : {}),
        };
        const response = await googleFetch(fetchFn, token, `${CALENDAR_API}/calendars/primary/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { created: true, event: slimEvent(await response.json()) };
      },
    }),
  ];
  return builtinConnector(tools);
}

const FILE_ID = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/, 'Geçersiz dosya kimliği.');
const EXPORT_TYPES = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

function isTextMime(mimeType = '') {
  return mimeType.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(mimeType);
}

function multipartBody(metadata, content, boundary) {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

function createGoogleDrive({ fetchFn = fetch, boundary = () => `kocamind-${Date.now().toString(36)}` } = {}) {
  const tools = [
    tool({
      name: 'list_files',
      description: 'Google Drive\'da KocaMind\'in erişebildiği dosyaları listeler (KocaMind ile oluşturulan veya açılan dosyalar). İsteğe bağlı ada göre arar.',
      readOnly: true,
      schema: z.object({ query: z.string().max(200).optional(), max_results: z.number().int().min(1).max(50).optional() }).strict(),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Dosya adında geçen metin' },
          max_results: { type: 'integer', description: '1-50, varsayılan 20' },
        },
      },
      run: async (token, args) => {
        const clauses = ['trashed = false'];
        if (args.query) clauses.push(`name contains '${args.query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
        const params = new URLSearchParams({
          q: clauses.join(' and '),
          pageSize: String(args.max_results || 20),
          orderBy: 'modifiedTime desc',
          fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)',
        });
        const response = await googleFetch(fetchFn, token, `${DRIVE_API}/files?${params}`);
        const data = await response.json();
        return { files: data.files || [] };
      },
    }),
    tool({
      name: 'read_file',
      description: 'Google Drive\'daki bir dosyanın metin içeriğini okur (Google Dokümanlar, E-Tablolar, Slaytlar ve metin dosyaları).',
      readOnly: true,
      schema: z.object({ file_id: FILE_ID }).strict(),
      inputSchema: { type: 'object', properties: { file_id: { type: 'string', description: 'list_files sonucundaki id' } }, required: ['file_id'] },
      run: async (token, { file_id: fileId }) => {
        const metaResponse = await googleFetch(fetchFn, token, `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size,webViewLink`);
        const meta = await metaResponse.json();
        let url;
        if (EXPORT_TYPES[meta.mimeType]) url = `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(EXPORT_TYPES[meta.mimeType])}`;
        else if (isTextMime(meta.mimeType)) url = `${DRIVE_API}/files/${fileId}?alt=media`;
        else return { file: meta, content: null, note: 'Bu dosya türünün metni okunamıyor.' };
        const content = await (await googleFetch(fetchFn, token, url)).text();
        return {
          file: meta,
          content: content.length > MAX_FILE_CHARS ? `${content.slice(0, MAX_FILE_CHARS)}\n…(kısaltıldı)` : content,
        };
      },
    }),
    tool({
      name: 'create_file',
      description: 'Google Drive\'da yeni bir metin dosyası ya da Google Dokümanı oluşturur.',
      readOnly: false,
      schema: z.object({
        name: z.string().min(1).max(200),
        content: z.string().max(200000),
        as_google_doc: z.boolean().optional(),
      }).strict(),
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Dosya adı' },
          content: { type: 'string', description: 'Dosya içeriği (düz metin)' },
          as_google_doc: { type: 'boolean', description: 'true ise Google Dokümanı olarak oluşturulur' },
        },
        required: ['name', 'content'],
      },
      run: async (token, args) => {
        const separator = boundary();
        const metadata = { name: args.name, ...(args.as_google_doc ? { mimeType: 'application/vnd.google-apps.document' } : { mimeType: 'text/plain' }) };
        const response = await googleFetch(fetchFn, token, DRIVE_UPLOAD, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${separator}` },
          body: multipartBody(metadata, args.content, separator),
        });
        return { created: true, file: await response.json() };
      },
    }),
  ];
  return builtinConnector(tools);
}

function builtinConnector(tools) {
  const byName = new Map(tools.map(item => [item.name, item]));
  // remoteMcp ile aynı imza: (connector, token, ...).
  return {
    async listTools() {
      return tools.map(({ name, description, inputSchema, readOnly }) => ({ name, description, inputSchema, readOnly }));
    },
    async callTool(connector, token, name, args) {
      const definition = byName.get(name);
      if (!definition) throw new Error('Bilinmeyen araç.');
      const parsed = definition.schema.safeParse(args || {});
      if (!parsed.success) {
        return { isError: true, text: `Geçersiz parametre: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}` };
      }
      return { isError: false, text: JSON.stringify(await definition.run(token, parsed.data)) };
    },
  };
}

module.exports = { createGoogleCalendar, createGoogleDrive };
