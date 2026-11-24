const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleCalendar, createGoogleDrive } = require('../connectors/google');
const { ConnectorAuthError } = require('../connectors/remoteMcp');

function recorder(responder) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  };
  return { calls, fetchFn };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('takvim: araç listesi okuma/yazma ayrımı içerir', async () => {
  const tools = await createGoogleCalendar().listTools();
  assert.deepEqual(tools.map(tool => [tool.name, tool.readOnly]), [['list_events', true], ['create_event', false]]);
});

test('takvim: list_events doğru sorguyu atar ve etkinlikleri sadeleştirir', async () => {
  const { calls, fetchFn } = recorder(() => json({ items: [{ id: 'e1', summary: 'Ders', start: { dateTime: '2026-10-13T10:00:00+03:00' }, end: { dateTime: '2026-10-13T11:00:00+03:00' }, htmlLink: 'https://cal/e1', creator: { email: 'x@y' } }] }));
  const calendar = createGoogleCalendar({ fetchFn, now: () => new Date('2026-10-12T20:00:00Z') });
  const result = await calendar.callTool({}, 'token-1', 'list_events', { query: 'ders', max_results: 5 });
  assert.equal(result.isError, false);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/calendar/v3/calendars/primary/events');
  assert.equal(url.searchParams.get('timeMin'), '2026-10-12T20:00:00.000Z');
  assert.equal(url.searchParams.get('maxResults'), '5');
  assert.equal(url.searchParams.get('q'), 'ders');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token-1');
  const data = JSON.parse(result.text);
  assert.deepEqual(data.events[0], { id: 'e1', summary: 'Ders', start: '2026-10-13T10:00:00+03:00', end: '2026-10-13T11:00:00+03:00', location: null, description: null, link: 'https://cal/e1' });
});

test('takvim: create_event saat dilimli ve tüm gün etkinliklerini doğru kurar', async () => {
  const { calls, fetchFn } = recorder(() => json({ id: 'n1', summary: 'Sınav', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }));
  const calendar = createGoogleCalendar({ fetchFn });
  await calendar.callTool({}, 't', 'create_event', { summary: 'Sınav', start: '2026-10-20', end: '2026-10-21' });
  await calendar.callTool({}, 't', 'create_event', { summary: 'Toplantı', start: '2026-10-20T10:00:00', end: '2026-10-20T11:00:00' });
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body).start, { date: '2026-10-20' });
  assert.deepEqual(JSON.parse(calls[1].init.body).start, { dateTime: '2026-10-20T10:00:00', timeZone: 'Europe/Istanbul' });
});

test('takvim: geçersiz parametre istek atmadan hata döner; 401 yetki hatası fırlatır', async () => {
  const { calls, fetchFn } = recorder(() => json({}, 401));
  const calendar = createGoogleCalendar({ fetchFn });
  const invalid = await calendar.callTool({}, 't', 'create_event', { summary: 'x', start: 'yarın', end: 'sonra' });
  assert.equal(invalid.isError, true);
  assert.equal(calls.length, 0);
  await assert.rejects(() => calendar.callTool({}, 't', 'list_events', {}), ConnectorAuthError);
});

test('drive: arama sorgusundaki tırnak kaçırılır', async () => {
  const { calls, fetchFn } = recorder(() => json({ files: [] }));
  await createGoogleDrive({ fetchFn }).callTool({}, 't', 'list_files', { query: "Bekir'in notu" });
  assert.equal(new URL(calls[0].url).searchParams.get('q'), "trashed = false and name contains 'Bekir\\'in notu'");
});

test('drive: Google Dokümanı metin olarak dışa aktarılır, ikili dosya okunmaz', async () => {
  const { calls, fetchFn } = recorder(url => {
    if (url.includes('/export')) return new Response('Doküman metni', { status: 200 });
    if (url.includes('doc1234567')) return json({ id: 'doc1234567', name: 'Not', mimeType: 'application/vnd.google-apps.document' });
    return json({ id: 'img1234567', name: 'foto.png', mimeType: 'image/png' });
  });
  const drive = createGoogleDrive({ fetchFn });
  const doc = JSON.parse((await drive.callTool({}, 't', 'read_file', { file_id: 'doc1234567' })).text);
  assert.equal(doc.content, 'Doküman metni');
  assert.match(calls[1].url, /export\?mimeType=text%2Fplain/);
  const image = JSON.parse((await drive.callTool({}, 't', 'read_file', { file_id: 'img1234567' })).text);
  assert.equal(image.content, null);
  const bad = await drive.callTool({}, 't', 'read_file', { file_id: '../../etc' });
  assert.equal(bad.isError, true);
});

test('drive: create_file multipart istek gönderir', async () => {
  const { calls, fetchFn } = recorder(() => json({ id: 'f1', name: 'rapor' }));
  const drive = createGoogleDrive({ fetchFn, boundary: () => 'SINIR' });
  const result = await drive.callTool({}, 't', 'create_file', { name: 'rapor', content: 'Merhaba', as_google_doc: true });
  assert.equal(JSON.parse(result.text).created, true);
  assert.equal(calls[0].init.headers['Content-Type'], 'multipart/related; boundary=SINIR');
  assert.match(calls[0].init.body, /"mimeType":"application\/vnd\.google-apps\.document"/);
  assert.match(calls[0].init.body, /\r\nMerhaba\r\n--SINIR--/);
});
