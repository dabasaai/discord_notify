import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
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

test('alias 不分大小寫', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ NFC: { channelId: '7' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await loader.load();
  assert.equal(loader.get('nfc').channelId, '7');
  assert.equal(loader.get('NFC').channelId, '7');
  assert.equal(loader.get('Nfc').channelId, '7');
  assert.equal(loader.list()[0].alias, 'NFC', '保留原始大小寫顯示');
  await rm(dir, { recursive: true, force: true });
});

test('大小寫重複的 alias 視為衝突', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ NFC: { channelId: '1' }, nfc: { channelId: '2' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await assert.rejects(() => loader.load(), /duplicate/);
  await rm(dir, { recursive: true, force: true });
});

test('add 新增頻道並寫回檔案', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ a: { channelId: '1' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await loader.load();
  const created = await loader.add('news', { channelId: '555', label: 'News' });
  assert.equal(created.channelId, '555');
  assert.equal(loader.get('news').channelId, '555');
  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(onDisk.news.channelId, '555');
  assert.equal(onDisk.news.label, 'News');
  assert.equal(onDisk.a.channelId, '1', '保留既有頻道');
  await rm(dir, { recursive: true, force: true });
});

test('add 缺 channelId 拒絕', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ a: { channelId: '1' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await loader.load();
  await assert.rejects(() => loader.add('x', {}), /channelId/);
  await rm(dir, { recursive: true, force: true });
});

test('add 重複 alias(不分大小寫)拒絕', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ News: { channelId: '1' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await loader.load();
  await assert.rejects(() => loader.add('news', { channelId: '2' }), /already exists/);
  await rm(dir, { recursive: true, force: true });
});

test('remove 移除頻道', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ a: { channelId: '1' }, News: { channelId: '2' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await loader.load();
  const removed = await loader.remove('news');
  assert.equal(removed, true, 'remove 不分大小寫');
  assert.equal(loader.get('news'), undefined);
  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal('News' in onDisk, false);
  assert.equal(onDisk.a.channelId, '1');
  await rm(dir, { recursive: true, force: true });
});

test('remove 不存在的頻道回 false', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cn-'));
  const file = path.join(dir, 'channels.json');
  await writeFile(file, JSON.stringify({ a: { channelId: '1' } }));
  const loader = new ChannelLoader(file, { logger: silentLogger });
  await loader.load();
  assert.equal(await loader.remove('nope'), false);
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
