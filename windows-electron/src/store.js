const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  applyingDisplayName,
  defaultScriptHubOptions,
  detectFormat,
  materializeArguments,
  sanitizeSurgeModule,
  sgmoduleName,
  suggestedNameFromSource
} = require('./module-utils');
const { SCRIPT_HUB_MODULE_URL } = require('./script-hub-engine');

class Store {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.dataFile = path.join(dataRoot, 'windows-prototype.json');
    this.previewDir = path.join(dataRoot, 'Previews');
    this.componentsDir = path.join(dataRoot, 'Components');
    this.overridesDir = path.join(dataRoot, 'Overrides');
    this.assetsDir = path.join(dataRoot, 'Assets');
    this.engineDir = path.join(dataRoot, 'ScriptHubEngine');
    this.combinedPath = path.join(dataRoot, 'Combined.cache');
    this.data = null;
  }

  async load() {
    await Promise.all([
      fs.mkdir(this.previewDir, { recursive: true }),
      fs.mkdir(this.componentsDir, { recursive: true }),
      fs.mkdir(this.overridesDir, { recursive: true }),
      fs.mkdir(this.assetsDir, { recursive: true }),
      fs.mkdir(this.engineDir, { recursive: true })
    ]);
    try {
      this.data = JSON.parse(await fs.readFile(this.dataFile, 'utf8'));
    } catch {
      this.data = {
        settings: {
          combinedModuleFileName: 'Surge-Relay.sgmodule',
          scriptHubModuleURL: SCRIPT_HUB_MODULE_URL,
          automaticallyUpdateModules: false,
          refreshIntervalMinutes: 60,
          automaticallyPublish: false,
          storageMode: 'local',
          localModuleDirectory: path.join(this.dataRoot, 'Published'),
          launchAtLogin: false,
          github: {
            owner: '',
            repository: '',
            branch: 'main',
            directory: 'modules',
            token: '',
            repositoryIsPrivate: null
          },
          webServerEnabled: true,
          webServerPort: 0
        },
        upstreamState: {
          revision: null,
          lastUpdatedAt: null,
          lastError: null
        },
        modules: [],
        activity: {
          isWorking: false,
          status: 'Windows version ready',
          progress: null,
          currentModuleID: null,
          error: null
        }
      };
      await this.save();
    }
    this.data.modules = this.data.modules || [];
    this.data.settings = {
      combinedModuleFileName: 'Surge-Relay.sgmodule',
      scriptHubModuleURL: SCRIPT_HUB_MODULE_URL,
      automaticallyUpdateModules: false,
      refreshIntervalMinutes: 60,
      automaticallyPublish: false,
      storageMode: 'local',
      localModuleDirectory: path.join(this.dataRoot, 'Published'),
      launchAtLogin: false,
      github: { owner: '', repository: '', branch: 'main', directory: 'modules', token: '', repositoryIsPrivate: null },
      webServerEnabled: true,
      webServerPort: 0,
      ...(this.data.settings || {})
    };
    this.data.settings.github = {
      owner: '',
      repository: '',
      branch: 'main',
      directory: 'modules',
      token: '',
      repositoryIsPrivate: null,
      ...(this.data.settings.github || {})
    };
    this.data.upstreamState = this.data.upstreamState || { revision: null, lastUpdatedAt: null, lastError: null };
    return this.data;
  }

  async save() {
    await fs.mkdir(this.dataRoot, { recursive: true });
    await fs.writeFile(this.dataFile, JSON.stringify(this.data, null, 2));
  }

  previewPath(id) {
    return path.join(this.previewDir, `${id}.sgmodule`);
  }

  async readPreview(id) {
    return fs.readFile(this.previewPath(id), 'utf8');
  }

  async writePreview(id, content) {
    await fs.mkdir(this.previewDir, { recursive: true });
    await fs.writeFile(this.previewPath(id), content, 'utf8');
  }

  async deletePreview(id) {
    await fs.rm(this.previewPath(id), { force: true });
  }

  componentPath(id) {
    return path.join(this.componentsDir, `${id}.sgmodule`);
  }

  overridePath(id) {
    return path.join(this.overridesDir, `${id}.sgmodule`);
  }

  async writeComponent(id, content) {
    const sanitized = sanitizeSurgeModule(content);
    await fs.writeFile(this.componentPath(id), sanitized, 'utf8');
    await fs.writeFile(this.previewPath(id), sanitized, 'utf8');
  }

  async readComponent(id) {
    try {
      return sanitizeSurgeModule(await fs.readFile(this.overridePath(id), 'utf8'));
    } catch {
      return sanitizeSurgeModule(await fs.readFile(this.componentPath(id), 'utf8'));
    }
  }

  async readConvertedComponent(id) {
    return sanitizeSurgeModule(await fs.readFile(this.componentPath(id), 'utf8'));
  }

  async writeOverride(id, content) {
    const sanitized = sanitizeSurgeModule(content);
    await fs.writeFile(this.overridePath(id), sanitized, 'utf8');
    await fs.writeFile(this.previewPath(id), sanitized, 'utf8');
  }

  async restoreOverride(id) {
    await fs.rm(this.overridePath(id), { force: true });
    return this.readConvertedComponent(id);
  }

  async removeModuleFiles(id) {
    await Promise.all([
      fs.rm(this.previewPath(id), { force: true }),
      fs.rm(this.componentPath(id), { force: true }),
      fs.rm(this.overridePath(id), { force: true }),
      fs.rm(path.join(this.assetsDir, id), { recursive: true, force: true })
    ]);
  }

  async writeCombined(content) {
    await fs.writeFile(this.combinedPath, content, 'utf8');
    if (this.data.settings.storageMode === 'local') {
      await fs.mkdir(this.data.settings.localModuleDirectory, { recursive: true });
      await fs.writeFile(
        path.join(this.data.settings.localModuleDirectory, sgmoduleName(this.data.settings.combinedModuleFileName)),
        content,
        'utf8'
      );
    }
  }

  async readCombined() {
    return fs.readFile(this.combinedPath, 'utf8');
  }

  async replaceAssets(id, assets) {
    const root = path.join(this.assetsDir, id);
    await fs.rm(root, { recursive: true, force: true });
    for (const asset of assets) {
      const relativePrefix = `assets/${id}/`;
      if (!asset.relativePath.startsWith(relativePrefix)) throw new Error('生成脚本的保存路径无效。');
      const destination = path.join(root, asset.relativePath.slice(relativePrefix.length));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, asset.data);
    }
  }

  async generatedAssetFiles() {
    const files = [];
    await collectFiles(this.assetsDir, files, this.assetsDir);
    return files.map((file) => ({
      name: `assets/${file.relative.replace(/\\/g, '/')}`,
      data: file.data
    })).sort((left, right) => left.name.localeCompare(right.name));
  }

  async saveEngineScripts(scripts) {
    await fs.mkdir(this.engineDir, { recursive: true });
    await Promise.all(Object.entries(scripts).map(([name, content]) => fs.writeFile(path.join(this.engineDir, name), content)));
  }

  async hasEngineScript(name) {
    try {
      await fs.access(path.join(this.engineDir, name));
      return true;
    } catch {
      return false;
    }
  }

  async readEngineScript(name) {
    return fs.readFile(path.join(this.engineDir, name), 'utf8');
  }

  makeModule(payload, existing = null) {
    const sourceURL = String(payload.sourceURL || '').trim();
    const name = String(payload.name || '').trim() || suggestedNameFromSource(sourceURL);
    const sourceFormat = payload.sourceFormat || existing?.sourceFormat || 'automatic';
    const detected = detectFormat(sourceFormat, sourceURL);
    return {
      id: existing?.id || randomUUID(),
      name,
      sourceURL,
      sourceFormat,
      outputFileName: existing?.outputFileName || this.uniqueOutputFileName(name),
      isEnabled: payload.isEnabled ?? existing?.isEnabled ?? true,
      state: existing?.state || 'never',
      lastUpdatedAt: existing?.lastUpdatedAt || null,
      lastError: null,
      iconURL: existing?.iconURL || null,
      publishedURL: null,
      hasOverrideConflict: false,
      detectedSourceFormat: detected,
      argumentOverrides: existing?.argumentOverrides || {},
      createdAt: existing?.createdAt || new Date().toISOString(),
      contentHash: existing?.contentHash || null,
      scriptHubOptions: {
        ...defaultScriptHubOptions(),
        ...(existing?.scriptHubOptions || {}),
        ...(payload.scriptHubOptions || {})
      }
    };
  }

  uniqueOutputFileName(name) {
    const preferred = sgmoduleName(name);
    const used = new Set(this.data.modules.map((module) => module.outputFileName.toLowerCase()));
    if (!used.has(preferred.toLowerCase())) return preferred;
    const base = preferred.replace(/\.sgmodule$/i, '');
    let index = 2;
    while (used.has(`${base}-${index}.sgmodule`.toLowerCase())) index += 1;
    return `${base}-${index}.sgmodule`;
  }
}

async function collectFiles(root, output, base) {
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await collectFiles(full, output, base);
    else if (entry.isFile()) {
      output.push({ relative: path.relative(base, full), data: await fs.readFile(full) });
    }
  }
}

module.exports = { Store };
