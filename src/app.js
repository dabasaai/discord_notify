import express from 'express';
import { apiKeyAuth } from './middleware/auth.js';
import { buildEmbed } from './bot.js';

export function createApp({ bot, channelLoader, apiKey, logger = console }) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      botReady: bot.isReady(),
      channelCount: channelLoader.list().length,
    });
  });

  const auth = apiKeyAuth(apiKey);

  app.get('/channels', auth, (req, res) => {
    res.json({ channels: channelLoader.list() });
  });

  app.post('/channels', auth, async (req, res) => {
    const { alias, channelId, label, test } = req.body ?? {};
    let created;
    try {
      created = await channelLoader.add(alias, { channelId, label });
    } catch (err) {
      if (err.statusCode === 400) {
        return res.status(400).json({ error: err.message });
      }
      logger.error('[channels] add failed', err);
      return res.status(500).json({ error: 'failed to add channel' });
    }
    const result = {
      ok: true,
      channel: { alias: created.originalAlias, channelId: created.channelId, label: created.label },
    };
    if (test) {
      if (!bot.isReady()) {
        result.test = { ok: false, error: 'discord bot not ready' };
      } else {
        try {
          const embed = buildEmbed({
            title: `頻道測試: ${created.originalAlias}`,
            level: 'success',
            message: '頻道已登記，Bot 發送權限正常',
            service: 'channel-admin',
          });
          const sent = await bot.send(created.channelId, { embeds: [embed] });
          result.test = { ok: true, messageId: sent.id };
        } catch (err) {
          result.test = { ok: false, error: err.message };
        }
      }
    }
    return res.status(201).json(result);
  });

  app.delete('/channels/:alias', auth, async (req, res) => {
    try {
      const removed = await channelLoader.remove(req.params.alias);
      if (!removed) {
        return res.status(404).json({ error: `unknown channel: ${req.params.alias}` });
      }
      return res.json({ ok: true, removed: req.params.alias });
    } catch (err) {
      if (err.statusCode === 400) {
        return res.status(400).json({ error: err.message });
      }
      logger.error('[channels] remove failed', err);
      return res.status(500).json({ error: 'failed to remove channel' });
    }
  });

  app.post('/notify', auth, async (req, res) => {
    const { channel, title, level, message, service, fields, mention } = req.body ?? {};
    if (!channel || typeof channel !== 'string') {
      return res.status(400).json({ error: 'channel is required' });
    }
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }
    const target = channelLoader.get(channel);
    if (!target) {
      return res.status(400).json({ error: `unknown channel: ${channel}` });
    }
    if (!bot.isReady()) {
      return res.status(503).json({ error: 'discord bot not ready' });
    }

    const embed = buildEmbed({ title, level, message, service, fields });
    const payload = { embeds: [embed] };
    if (mention && typeof mention === 'string') {
      payload.content = mention;
      payload.allowedMentions = { parse: ['users', 'roles', 'everyone'] };
    }

    try {
      const sent = await bot.send(target.channelId, payload);
      return res.json({ ok: true, messageId: sent.id, channel });
    } catch (err) {
      const code = err.code;
      if (code === 'CHANNEL_INVALID' || code === 'FORBIDDEN_OR_MISSING') {
        logger.warn(`[notify] ${code}: ${err.message}`);
        return res.status(400).json({ error: err.message, code });
      }
      logger.error('[notify] send failed', err);
      return res.status(502).json({ error: 'discord send failed', detail: err.message });
    }
  });

  app.use((err, req, res, next) => {
    logger.error('[app] unhandled', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
