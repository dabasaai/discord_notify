import 'dotenv/config';
import { ChannelLoader } from './channelLoader.js';
import { Bot } from './bot.js';
import { createApp } from './app.js';

const {
  DISCORD_BOT_TOKEN,
  API_KEY,
  PORT = '3020',
  CHANNELS_FILE = '/app/channels.json',
  ALERT_COMMAND = '',
} = process.env;

if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');
if (!API_KEY) throw new Error('API_KEY is required');

const loader = new ChannelLoader(CHANNELS_FILE);
await loader.load();
loader.watch();
loader.on('reloadError', (err) => {
  console.warn('[index] channels reload error:', err.message);
});
loader.on('loaded', (chs) => {
  console.log(`[index] channels loaded: ${Object.keys(chs).join(', ') || '(none)'}`);
});

const bot = new Bot({ token: DISCORD_BOT_TOKEN, alertCommand: ALERT_COMMAND });
await bot.login();

const app = createApp({ bot, channelLoader: loader, apiKey: API_KEY });
const port = Number(PORT);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[index] listening on :${port}`);
});

async function shutdown(signal) {
  console.log(`[index] ${signal} received, shutting down`);
  server.close();
  await loader.stop();
  await bot.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
