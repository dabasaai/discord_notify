import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { spawn } from 'node:child_process';

const LEVELS = {
  info:     { color: 0x3498db, emoji: 'ℹ️' },
  success:  { color: 0x2ecc71, emoji: '✅' },
  warning:  { color: 0xf1c40f, emoji: '⚠️' },
  error:    { color: 0xe74c3c, emoji: '🚨' },
  critical: { color: 0x8b0000, emoji: '🔥' },
};

export function buildEmbed({ title, level = 'info', message, service, fields }) {
  const meta = LEVELS[level] ?? LEVELS.info;
  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} ${title}`)
    .setColor(meta.color)
    .setTimestamp(new Date());
  if (message) embed.setDescription(String(message).slice(0, 4000));
  if (service) embed.setFooter({ text: String(service) });
  if (Array.isArray(fields) && fields.length) {
    embed.addFields(
      fields.slice(0, 25).map((f) => ({
        name: String(f.name ?? '').slice(0, 256) || '\u200B',
        value: String(f.value ?? '').slice(0, 1024) || '\u200B',
        inline: Boolean(f.inline),
      })),
    );
  }
  return embed;
}

export class Bot {
  constructor({ token, alertCommand = '', logger = console } = {}) {
    this.token = token;
    this.alertCommand = alertCommand;
    this.logger = logger;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.ready = false;
    this.#bindEvents();
  }

  #bindEvents() {
    this.client.once('clientReady', () => {
      this.ready = true;
      this.logger.log(`[bot] ready as ${this.client.user?.tag}`);
    });
    this.client.on('shardDisconnect', (_ev, shardId) => {
      this.ready = false;
      this.#alert(`⚠️ discord-notify bot shard ${shardId} disconnected`);
    });
    this.client.on('shardError', (err, shardId) => {
      this.logger.error(`[bot] shard ${shardId} error`, err);
      this.#alert(`⚠️ discord-notify bot shard ${shardId} error: ${err.message}`);
    });
    this.client.on('shardReady', () => {
      this.ready = true;
    });
  }

  async login() {
    await this.client.login(this.token);
  }

  async destroy() {
    await this.client.destroy();
  }

  isReady() {
    return this.ready && this.client.isReady();
  }

  async send(channelId, payload) {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      const err = new Error(`channel ${channelId} not found or not text-based`);
      err.code = 'CHANNEL_INVALID';
      throw err;
    }
    return sendWithRetry(channel, payload, this.logger);
  }

  #alert(text) {
    this.logger.warn(`[bot] ${text}`);
    if (!this.alertCommand) return;
    try {
      const child = spawn(this.alertCommand, [text], { stdio: 'ignore', detached: true });
      child.on('error', (err) => this.logger.warn(`[bot] alert command failed: ${err.message}`));
      child.unref();
    } catch (err) {
      this.logger.warn(`[bot] alert spawn error: ${err.message}`);
    }
  }
}

async function sendWithRetry(channel, payload, logger, attempt = 0) {
  try {
    return await channel.send(payload);
  } catch (err) {
    const status = err.status ?? err.httpStatus;
    if (status === 403 || status === 404) {
      err.code = err.code || 'FORBIDDEN_OR_MISSING';
      throw err;
    }
    if (status === 429 && err.retryAfter != null && attempt < 2) {
      const wait = Math.min(Number(err.retryAfter) * 1000, 5000);
      logger.warn(`[bot] 429 rate limited, retry in ${wait}ms`);
      await delay(wait);
      return sendWithRetry(channel, payload, logger, attempt + 1);
    }
    const retriable = !status || status >= 500;
    if (retriable && attempt < 2) {
      const backoff = [500, 1500][attempt] ?? 1500;
      logger.warn(`[bot] send failed (${err.message}), retry ${attempt + 1}/2 in ${backoff}ms`);
      await delay(backoff);
      return sendWithRetry(channel, payload, logger, attempt + 1);
    }
    throw err;
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
