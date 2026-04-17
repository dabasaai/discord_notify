import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmbed } from '../src/bot.js';

test('info 預設 level', () => {
  const e = buildEmbed({ title: 'Hi' }).toJSON();
  assert.match(e.title, /ℹ️/);
  assert.equal(e.color, 0x3498db);
});

test('critical 使用深紅', () => {
  const e = buildEmbed({ title: 'X', level: 'critical' }).toJSON();
  assert.match(e.title, /🔥/);
  assert.equal(e.color, 0x8b0000);
});

test('fields 被截斷到 25 個', () => {
  const fields = Array.from({ length: 30 }, (_, i) => ({ name: `n${i}`, value: 'v' }));
  const e = buildEmbed({ title: 't', fields }).toJSON();
  assert.equal(e.fields.length, 25);
});

test('service 顯示於 footer', () => {
  const e = buildEmbed({ title: 't', service: 'deploy-bot' }).toJSON();
  assert.equal(e.footer.text, 'deploy-bot');
});
