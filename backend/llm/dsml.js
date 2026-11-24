// DeepSeek bazen araç çağrısını yapılandırılmış `tool_calls` yerine kendi ham
// DSML biçimiyle `content` içine yazar (özellikle düşünme modunda ve
// tool_choice:'none' turunda). Bu metin kullanıcıya sızmasın diye akışta
// tutulur, sonra gerçek araç çağrısına çevrilir.
//
//   <｜DSML｜function_calls>
//   <｜DSML｜invoke name="web_search">
//   <｜DSML｜parameter name="query" string="true">...</｜DSML｜parameter>
//   </｜DSML｜invoke>
//   </｜DSML｜function_calls>

const MARK = String.raw`(?:[|｜]\s*)+DSML\s*(?:[|｜]\s*)+`;
const START_RE = new RegExp(String.raw`<\s*(?:[|｜]\s*)+DSML`);
const INVOKE_RE = new RegExp(String.raw`<\s*${MARK}invoke\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)(?:<\s*\/\s*${MARK}invoke\s*>|$)`, 'g');
const PARAM_RE = new RegExp(String.raw`<\s*${MARK}parameter\s+name\s*=\s*"([^"]+)"(?:\s+string\s*=\s*"(true|false)")?\s*>([\s\S]*?)<\s*\/\s*${MARK}parameter\s*>`, 'g');
// Akışta parça sonu bir DSML işaretinin başlangıcı olabilir mi ("<", "<｜", "<｜DS" ...).
const PARTIAL_START_RE = /<\s*(?:[|｜]\s*)*(?:D(?:S(?:M)?)?)?$/;

function parseParamValue(raw, isString) {
  if (isString !== 'false') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Metindeki DSML araç çağrılarını ayıklar.
 * @returns {{text: string, toolCalls: Array}|null}  DSML yoksa null.
 */
function extractDsmlToolCalls(content, idPrefix = 'dsml') {
  if (typeof content !== 'string') return null;
  const match = START_RE.exec(content);
  if (!match) return null;
  const toolCalls = [];
  for (const [, name, inner] of content.slice(match.index).matchAll(INVOKE_RE)) {
    const args = {};
    for (const [, key, isString, value] of inner.matchAll(PARAM_RE)) {
      args[key] = parseParamValue(value.trim(), isString);
    }
    toolCalls.push({
      id: `${idPrefix}_${toolCalls.length}`,
      type: 'function',
      function: { name: name.trim(), arguments: JSON.stringify(args) },
    });
  }
  return { text: content.slice(0, match.index).trimEnd(), toolCalls };
}

// Akış parçalarını süzer: DSML başlayınca o turun geri kalanını yutar,
// yarım kalmış olası bir işaret başlangıcını bir sonraki parçaya kadar bekletir.
function createDsmlStreamFilter(emit) {
  let pending = '';
  let blocked = false;
  return {
    push(text) {
      if (blocked) return;
      pending += text;
      const start = START_RE.exec(pending);
      if (start) {
        blocked = true;
        if (start.index > 0) emit(pending.slice(0, start.index));
        pending = '';
        return;
      }
      const partial = PARTIAL_START_RE.exec(pending);
      const cut = partial ? partial.index : pending.length;
      if (cut > 0) emit(pending.slice(0, cut));
      pending = pending.slice(cut);
    },
    flush() {
      if (!blocked && pending) emit(pending);
      pending = '';
    },
  };
}

module.exports = { extractDsmlToolCalls, createDsmlStreamFilter };
