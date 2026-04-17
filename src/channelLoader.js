import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import chokidar from 'chokidar';

export class ChannelLoader extends EventEmitter {
  constructor(filePath, { logger = console } = {}) {
    super();
    this.filePath = filePath;
    this.logger = logger;
    this.channels = {};
    this.watcher = null;
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.#validate(parsed);
      this.channels = parsed;
      this.emit('loaded', this.channels);
      return this.channels;
    } catch (err) {
      if (Object.keys(this.channels).length === 0) {
        throw new Error(`Failed to load ${this.filePath}: ${err.message}`);
      }
      this.logger.warn(
        `[channelLoader] reload failed, keeping previous config: ${err.message}`,
      );
      this.emit('reloadError', err);
      return this.channels;
    }
  }

  watch() {
    this.watcher = chokidar.watch(this.filePath, {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      ignoreInitial: true,
      usePolling: true,
      interval: 1000,
    });
    this.watcher.on('change', () => this.load());
    this.watcher.on('add', () => this.load());
    return this;
  }

  async stop() {
    if (this.watcher) await this.watcher.close();
  }

  get(alias) {
    return this.channels[alias];
  }

  list() {
    return Object.entries(this.channels).map(([alias, v]) => ({
      alias,
      channelId: v.channelId,
      label: v.label,
    }));
  }

  #validate(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('channels.json must be a JSON object');
    }
    for (const [alias, val] of Object.entries(obj)) {
      if (!val || typeof val !== 'object') {
        throw new Error(`channel "${alias}" must be an object`);
      }
      if (typeof val.channelId !== 'string' || !val.channelId.trim()) {
        throw new Error(`channel "${alias}" missing channelId`);
      }
    }
  }
}
