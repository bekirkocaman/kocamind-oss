'use strict';

function createToolRegistry(tools = []) {
  const map = new Map();

  for (const tool of tools) {
    if (map.has(tool.name)) {
      throw new Error(`Araç zaten kayıtlı: ${tool.name}`);
    }
    map.set(tool.name, tool);
  }

  function list() {
    return Array.from(map.values());
  }

  function get(name) {
    return map.get(name);
  }

  function validate(name, rawArguments) {
    const tool = map.get(name);
    if (!tool) {
      throw new Error(`Bilinmeyen araç: ${name}`);
    }

    let parsed = rawArguments;
    if (typeof rawArguments === 'string') {
      try {
        parsed = JSON.parse(rawArguments);
      } catch {
        throw new Error('Geçersiz JSON.');
      }
    }

    return tool.validate(parsed);
  }

  function toModelTools() {
    return Array.from(map.values()).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.jsonSchema,
      },
    }));
  }

  return {
    list,
    get,
    validate,
    toModelTools,
  };
}

module.exports = { createToolRegistry };
