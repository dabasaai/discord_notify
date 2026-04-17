import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChannelLoader } from '../src/channelLoader.js';

const silentLogger = { log() {}, warn() {}, error() {} };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

test('載入合法 channels.json', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ deploy: { channelId: '111', label: 'D' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await loader.load();
  assert.equal(loader.get('deploy').channelId, '111');
  await rm(dir, { recursive: true, force: true });
});

test('channelId 缺失時拒絕', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ deploy: { label: 'no id' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await assert.rejects(() => loader.load(), /channelId/);
  await rm(dir, { recursive: true, force: true });
});

test('解析失敗時保留前一份設定', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ a: { channelId: '1' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await loader.load();
  assert.equal(loader.get('a').channelId, '1');
  await writeFile(file, '{ invalid json');
  const result = await loader.load();
  assert.equal(result.a.channelId, '1', '應保留舊設定');
  await rm(dir, { recursive: true, force: true });
});

test('chokidar 熱重載變更', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ a: { channelId: '1' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await loader.load();
  loader.watch();
  const loaded = new Promise((resolve) => loader.once('loaded', resolve));
  await wait(100);
  await writeFile(file, JSON.stringify({ a: { channelId: '1' }, b: { channelId: '2' } }));
  await loaded;
  assert.equal(loader.get('b').channelId, '2');
  await loader.stop();
  await rm(dir, { recursive: true, force: true });
});
