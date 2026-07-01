import { readFile, writeFile, rename } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import chokidar from 'chokidar';

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

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
      const normalized = {};
      for (const [alias, val] of Object.entries(parsed)) {
        const key = alias.toLowerCase();
        if (key in normalized) {
          throw new Error(`duplicate channel alias (case-insensitive): "${alias}"`);
        }
        normalized[key] = { ...val, originalAlias: alias };
      }
      this.channels = normalized;
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
    if (typeof alias !== 'string') return undefined;
    return this.channels[alias.toLowerCase()];
  }

  async add(alias, { channelId, label } = {}) {
    if (typeof alias !== 'string' || !alias.trim()) {
      throw badRequest('alias is required');
    }
    if (typeof channelId !== 'string' || !channelId.trim()) {
      throw badRequest('channelId is required');
    }
    const key = alias.toLowerCase();
    const current = await this.#readRaw();
    for (const existing of Object.keys(current)) {
      if (existing.toLowerCase() === key) {
        throw badRequest(`channel alias already exists: "${existing}"`);
      }
    }
    const entry = { channelId: channelId.trim() };
    if (label != null && String(label).trim()) entry.label = String(label).trim();
    current[alias.trim()] = entry;
    await this.#writeRaw(current);
    await this.load();
    return this.get(alias);
  }

  async remove(alias) {
    if (typeof alias !== 'string' || !alias.trim()) {
      throw badRequest('alias is required');
    }
    const key = alias.toLowerCase();
    const current = await this.#readRaw();
    const foundKey = Object.keys(current).find((k) => k.toLowerCase() === key);
    if (!foundKey) return false;
    delete current[foundKey];
    await this.#writeRaw(current);
    await this.load();
    return true;
  }

  list() {
    return Object.values(this.channels).map((v) => ({
      alias: v.originalAlias,
      channelId: v.channelId,
      label: v.label,
    }));
  }

  async #readRaw() {
    let raw;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      throw err;
    }
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    this.#validate(parsed);
    return parsed;
  }

  async #writeRaw(obj) {
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
    await rename(tmp, this.filePath);
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
