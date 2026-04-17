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
