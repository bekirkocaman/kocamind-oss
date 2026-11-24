'use strict';

const MODE_TABLE = {
  ask: { read: 'allow', write: 'ask', exec: 'ask' },
  'auto-edit': { read: 'allow', write: 'allow', exec: 'ask' },
  'read-only': { read: 'allow', write: 'deny', exec: 'deny' },
};

const DANGEROUS_PATTERNS = [
  // rm -rf / rm -fr / rm -r -f / rm -f -r
  /\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*|-[a-z]*f[a-z]*\s+-[a-z]*r[a-z]*)\b/i,
  // del /s ya da del /q
  /\bdel\b[^\n;|&]*\/[sq]\b/i,
  // rd /s ya da rmdir /s
  /\b(?:rd|rmdir)\b[^\n;|&]*\/s\b/i,
  // format
  /(?:^|[;&|]\s*)\bformat\s+/i,
  // mkfs
  /\bmkfs(?:\.[a-z0-9]+)?\b/i,
  // dd if=
  /\bdd\s+[^\n;|&]*\bif=/i,
  // shutdown / reboot
  /\b(?:shutdown|reboot)\b/i,
  // git push / git reset --hard / git clean
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+[^\n;|&]*--hard\b/i,
  /\bgit\s+clean\b/i,
  // npm publish
  /\bnpm\s+publish\b/i,
  // curl ... | sh / wget ... | sh
  /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i,
  // sudo
  /(?:^|[;&|]\s*)\bsudo\s+/i,
  // chmod -R 777
  /\bchmod\s+[^\n;|&]*-R\s+777\b/i,
  // > /dev/sd
  />\s*\/dev\/sd[a-z0-9]*/i,
  // Remove-Item ... -Recurse
  /\bRemove-Item\b[^\n;|&]*-Recurse\b/i,
];

function isDangerousCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') return false;
  for (const re of DANGEROUS_PATTERNS) {
    if (re.test(command)) return true;
  }
  return false;
}

function isProtectedPath(rawPath) {
  if (typeof rawPath !== 'string') return false;
  const norm = rawPath.replace(/\\/g, '/').trim();
  const clean = norm.replace(/^\.\//, '');
  const parts = clean.split('/');
  const filename = parts[parts.length - 1];

  if (filename.startsWith('.env')) {
    return true;
  }

  if (
    clean === 'KOCAMIND.md' ||
    clean === 'AGENTS.md' ||
    clean === 'package.json' ||
    clean === '.npmrc' ||
    filename === 'KOCAMIND.md' ||
    filename === 'AGENTS.md' ||
    filename === 'package.json' ||
    filename === '.npmrc'
  ) {
    return true;
  }

  if (
    clean === '.kocamind' ||
    clean.startsWith('.kocamind/') ||
    parts.includes('.kocamind') ||
    clean === '.git' ||
    clean.startsWith('.git/') ||
    parts.includes('.git')
  ) {
    return true;
  }

  return false;
}

function createApprovalPolicy({ mode = 'ask' } = {}) {
  const rules = MODE_TABLE[mode];
  if (!rules) {
    throw new Error('Geçersiz onay modu.');
  }

  function decide(tool, args = {}) {
    const risk = tool && tool.risk ? tool.risk : 'read';
    const baseDecision = rules[risk] || 'ask';

    if (baseDecision === 'deny') {
      return 'deny';
    }

    if (
      tool &&
      (tool.name === 'write_file' || tool.name === 'edit_file') &&
      args &&
      typeof args.path === 'string' &&
      isProtectedPath(args.path)
    ) {
      return 'ask';
    }

    if (
      ((tool && tool.name === 'run_command') || risk === 'exec') &&
      args &&
      typeof args.command === 'string' &&
      isDangerousCommand(args.command)
    ) {
      return 'ask';
    }

    return baseDecision;
  }

  return {
    mode,
    decide,
  };
}

module.exports = { createApprovalPolicy, isDangerousCommand };
