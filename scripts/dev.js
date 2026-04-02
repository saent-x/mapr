import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Load .env file into process.env
try {
  const envFile = readFileSync(resolve(root, '.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      // Strip inline comments (only for unquoted values)
      const hashIdx = value.indexOf('#');
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
} catch { /* no .env file */ }

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
};

function prefix(label, color) {
  return `${color}[${label}]${colors.reset}`;
}

function pipe(proc, label, color) {
  const tag = prefix(label, color);
  const format = (data) =>
    data
      .toString()
      .split('\n')
      .filter((l) => l.trim())
      .forEach((line) => console.log(`${tag} ${line}`));

  proc.stdout?.on('data', format);
  proc.stderr?.on('data', format);
}

// Start backend server
const server = spawn('node', ['server/index.js'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '1' },
});
pipe(server, 'server', colors.magenta);

// Start Vite dev server
const vite = spawn('npx', ['vite'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '1' },
});
pipe(vite, ' vite ', colors.cyan);

// Graceful shutdown
function shutdown() {
  server.kill('SIGTERM');
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`${prefix('server', colors.magenta)} exited with code ${code}`);
  }
});

vite.on('exit', (code) => {
  // If Vite exits, kill everything
  shutdown();
});
