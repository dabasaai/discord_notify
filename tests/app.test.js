import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const silentLogger = { log() {}, warn() {}, error() {} };

function fakeLoader(map) {
  return {
    get: (a) => map[a],
    list: () => Object.entries(map).map(([alias, v]) => ({ alias, ...v })),
    add: async (alias, { channelId, label }) => {
      if (map[alias]) {
        const e = new Error(`channel alias already exists: "${alias}"`);
        e.statusCode = 400;
        throw e;
      }
      map[alias] = { channelId, label, originalAlias: alias };
      return map[alias];
    },
    remove: async (alias) => {
      if (!map[alias]) return false;
      delete map[alias];
      return true;
    },
  };
}

function fakeBot({ ready = true, send } = {}) {
  return {
    isReady: () => ready,
    send: send ?? (async () => ({ id: 'msg-1' })),
  };
}

test('GET /health 回傳狀態', async () => {
  const app = createApp({
    bot: fakeBot(),
    channelLoader: fakeLoader({ x: { channelId: '1' } }),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.botReady, true);
  assert.equal(res.body.channelCount, 1);
});

test('缺 x-api-key 回 401', async () => {
  const app = createApp({
    bot: fakeBot(),
    channelLoader: fakeLoader({}),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app).post('/notify').send({ channel: 'x', title: 't' });
  assert.equal(res.status, 401);
});

test('未知頻道回 400', async () => {
  const app = createApp({
    bot: fakeBot(),
    channelLoader: fakeLoader({}),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app)
    .post('/notify')
    .set('x-api-key', 'k')
    .send({ channel: 'nope', title: 't' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /unknown channel/);
});

test('bot 未就緒回 503', async () => {
  const app = createApp({
    bot: fakeBot({ ready: false }),
    channelLoader: fakeLoader({ x: { channelId: '1' } }),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app)
    .post('/notify')
    .set('x-api-key', 'k')
    .send({ channel: 'x', title: 't' });
  assert.equal(res.status, 503);
});

test('成功發送回傳 messageId', async () => {
  let captured;
  const app = createApp({
    bot: fakeBot({
      send: async (channelId, payload) => {
        captured = { channelId, payload };
        return { id: 'msg-42' };
      },
    }),
    channelLoader: fakeLoader({ deploy: { channelId: '999' } }),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app)
    .post('/notify')
    .set('x-api-key', 'k')
    .send({ channel: 'deploy', title: '部署完成', level: 'success', service: 'api' });
  assert.equal(res.status, 200);
  assert.equal(res.body.messageId, 'msg-42');
  assert.equal(captured.channelId, '999');
  assert.equal(captured.payload.embeds.length, 1);
});

test('Discord 失敗回 502', async () => {
  const app = createApp({
    bot: fakeBot({ send: async () => { throw new Error('boom'); } }),
    channelLoader: fakeLoader({ x: { channelId: '1' } }),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app)
    .post('/notify')
    .set('x-api-key', 'k')
    .send({ channel: 'x', title: 't' });
  assert.equal(res.status, 502);
});

test('POST /channels 新增頻道回 201', async () => {
  const map = {};
  const app = createApp({
    bot: fakeBot(),
    channelLoader: fakeLoader(map),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app)
    .post('/channels')
    .set('x-api-key', 'k')
    .send({ alias: 'news', channelId: '123', label: 'News' });
  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.channel.alias, 'news');
  assert.equal(res.body.channel.channelId, '123');
  assert.equal(map.news.channelId, '123');
});

test('POST /channels test=true 會發測試訊息', async () => {
  const app = createApp({
    bot: fakeBot({ send: async () => ({ id: 'msg-test' }) }),
    channelLoader: fakeLoader({}),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app)
    .post('/channels')
    .set('x-api-key', 'k')
    .send({ alias: 'news', channelId: '123', test: true });
  assert.equal(res.status, 201);
  assert.equal(res.body.test.ok, true);
  assert.equal(res.body.test.messageId, 'msg-test');
});

test('POST /channels 重複 alias 回 400', async () => {
  const app = createApp({
    bot: fakeBot(),
    channelLoader: fakeLoader({ news: { channelId: '1' } }),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app)
    .post('/channels')
    .set('x-api-key', 'k')
    .send({ alias: 'news', channelId: '2' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /already exists/);
});

test('POST /channels 缺 x-api-key 回 401', async () => {
  const app = createApp({
    bot: fakeBot(),
    channelLoader: fakeLoader({}),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app).post('/channels').send({ alias: 'x', channelId: '1' });
  assert.equal(res.status, 401);
});

test('DELETE /channels/:alias 移除回 200', async () => {
  const map = { news: { channelId: '1' } };
  const app = createApp({
    bot: fakeBot(),
    channelLoader: fakeLoader(map),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app).delete('/channels/news').set('x-api-key', 'k');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal('news' in map, false);
});

test('DELETE /channels/:alias 不存在回 404', async () => {
  const app = createApp({
    bot: fakeBot(),
    channelLoader: fakeLoader({}),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app).delete('/channels/nope').set('x-api-key', 'k');
  assert.equal(res.status, 404);
});

test('頻道無效回 400', async () => {
  const app = createApp({
    bot: fakeBot({
      send: async () => {
        const e = new Error('missing');
        e.code = 'CHANNEL_INVALID';
        throw e;
      },
    }),
    channelLoader: fakeLoader({ x: { channelId: '1' } }),
    apiKey: 'k',
    logger: silentLogger,
  });
  const res = await request(app)
    .post('/notify')
    .set('x-api-key', 'k')
    .send({ channel: 'x', title: 't' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'CHANNEL_INVALID');
});
