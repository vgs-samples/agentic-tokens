import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const deleted = (id) => ({ data: { id, type: 'card_deletion', attributes: { status: 'deleted' } } });

// Entirely local fake upstream: never sends a deletion to VGS or Amex.
test('Docker and Netlify deletion proxies preserve IDs, request body and upstream errors', async (t) => {
  const calls = [];
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/auth') return res.end(JSON.stringify({ access_token: 'test-only', expires_in: 300 }));
    calls.push({ method: req.method, path: req.url, body });
    const id = decodeURIComponent(req.url.split('/').at(-1));
    res.statusCode = id === 'rejected' ? 409 : 200;
    res.end(JSON.stringify(id === 'rejected' ? { error: 'amex_upstream_error' } : deleted(id)));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const env = {
    ...process.env, VGS_API_URL: upstreamUrl, VGS_AUTH_URL: `${upstreamUrl}/auth`,
    VGS_CMP_API_URL: upstreamUrl, VGS_CLIENT_ID: 'test-only', VGS_CLIENT_SECRET: 'test-only',
    VGS_VAULT_ENV: 'sandbox', PORT: '0',
  };
  // A separate working directory prevents dotenv from loading developer credentials.
  const cwd = await mkdtemp(join(tmpdir(), 'enrollment-proxy-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  // Report the random listening port without changing production server exports.
  const bootstrap = `import net from 'node:net';
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (...args) {
      this.once('listening', () => console.log('TEST_PORT=' + this.address().port));
      return listen.apply(this, args);
    };
    await import(${JSON.stringify(new URL('../server.js', import.meta.url).href)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', bootstrap], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Demo server did not start')), 10000);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/TEST_PORT=(\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once('error', (err) => { clearTimeout(timeout); reject(err); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Demo server exited: ${code}`)); });
  });
  Object.assign(process.env, env);
  const { default: netlify } = await import('../../netlify/functions/amex-enrollments.js');
  const clients = {
    Docker: (query) => fetch(`http://127.0.0.1:${port}/api/amex-enrollments${query}`, { method: 'DELETE' }),
    Netlify: (query) => netlify(new Request(`http://demo.test/api/amex-enrollments${query}`, { method: 'DELETE' })),
  };
  for (const [name, request] of Object.entries(clients)) {
    await t.test(name, async () => {
      const before = calls.length;
      assert.equal((await request('')).status, 400);
      assert.equal((await request('?enrollmentId=%20')).status, 400);
      assert.equal(calls.length, before);
      const id = 'custom+enrollment=value';
      const response = await request(`?enrollmentId=${encodeURIComponent(id)}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), deleted(id));
      assert.deepEqual(calls.at(-1), {
        method: 'DELETE', path: `/temporary/amex/agentic-tokens/${encodeURIComponent(id)}`, body: '',
      });
      const failure = await request('?enrollmentId=rejected');
      assert.equal(failure.status, 409);
      assert.deepEqual(await failure.json(), { error: 'amex_upstream_error' });
    });
  }
  const methodError = await netlify(new Request('http://demo.test/api/amex-enrollments?enrollmentId=unused'));
  assert.equal(methodError.status, 405);
});
