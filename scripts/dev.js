import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

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
