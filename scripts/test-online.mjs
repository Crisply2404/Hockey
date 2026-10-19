import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const runtime = path.resolve('.scratch/runtime');
await mkdir(runtime, { recursive: true });
const endpoint = process.env.HOCKEY_TEST_WS_URL ?? 'ws://127.0.0.1:8797/ws';
let worker;
let output = '';

try {
  if (!process.env.HOCKEY_TEST_WS_URL) {
    worker = spawn('cf/worker/node_modules/.bin/wrangler', [
      'dev', '--config', 'cf/worker/wrangler.toml', '--ip', '127.0.0.1', '--port', '8797',
      '--persist-to', path.join(runtime, 'online-test-state'),
    ], {
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(runtime, 'online-test.log') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', (data) => { output += data; });
    worker.stderr.on('data', (data) => { output += data; });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Worker startup timeout\n${output}`)), 20_000);
      const inspect = (data) => {
        if (data.toString().includes('Ready on')) { clearTimeout(timer); resolve(); }
      };
      worker.stdout.on('data', inspect);
      worker.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Worker exited (${code})\n${output}`)); });
    });
    await ready;
  }
  const child = spawn('node_modules/.bin/tsx', ['--test', 'tests/online.test.ts', ...process.argv.slice(2)], {
    env: { ...process.env, HOCKEY_TEST_WS_URL: endpoint },
    stdio: 'inherit',
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Online checks failed (${code})`);
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await Promise.race([once(worker, 'exit'), delay(5000)]);
    if (worker.exitCode === null) worker.kill('SIGKILL');
  }
}
