const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Store } = require('./store');
const { GitHubClient, repositoryPath } = require('./github-client');
const { ScriptHubEngine } = require('./script-hub-engine');
const {
  applyingDisplayName,
  argumentInfo,
  configuredSummary,
  defaultScriptHubOptions,
  detectFormat,
  displayNameIn,
  iconURLIn,
  materializeArguments,
  mergeModules,
  sanitizeSurgeModule,
  sgmoduleName,
  sha256,
  suggestedNameFromSource,
  titleForFormat
} = require('./module-utils');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

async function createServer({ webRoot, dataRoot, platform = {} }) {
  const store = new Store(dataRoot);
  await store.load();
  const scriptHub = new ScriptHubEngine(store);
  const github = new GitHubClient();
  const clients = new Set();
  let scheduler = null;

  const changed = () => broadcast(clients, statePayload(store));
  const restartScheduler = () => {
    if (scheduler) clearInterval(scheduler);
    scheduler = null;
    const minutes = Number(store.data.settings.refreshIntervalMinutes || 0);
    if (!store.data.settings.automaticallyUpdateModules || minutes <= 0) return;
    scheduler = setInterval(() => {
      if (!store.data.activity?.isWorking) updateAll(store, scriptHub, github, changed).then(changed, changed);
    }, minutes * 60 * 1000);
  };
  restartScheduler();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/api/events') return openEvents(response, clients, statePayload(store));
      if (url.pathname.startsWith('/api/')) {
        await routeAPI(request, response, url, { store, scriptHub, github, platform, changed, restartScheduler });
        return;
      }
      await serveStatic(response, webRoot, url.pathname);
    } catch (error) {
      sendJSON(response, 500, { error: error.message, message: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => {
      if (scheduler) clearInterval(scheduler);
      server.close();
    }
  };
}

async function routeAPI(request, response, url, context) {
  const { store, scriptHub, github, platform, changed, restartScheduler } = context;

  if (request.method === 'GET' && url.pathname === '/api/state') return sendJSON(response, 200, statePayload(store));
  if (request.method === 'GET' && url.pathname === '/api/settings') return sendJSON(response, 200, safeSettings(store));

  if (request.method === 'PUT' && url.pathname === '/api/settings') {
    const body = await readJSON(request);
    store.data.settings = mergeSettings(store.data.settings, body);
    if (platform.setLaunchAtLogin) platform.setLaunchAtLogin(Boolean(store.data.settings.launchAtLogin));
    await store.save();
    restartScheduler();
    changed();
    return sendJSON(response, 200, { ok: true, message: '设置已保存。', settings: safeSettings(store) });
  }

  if (request.method === 'POST' && url.pathname === '/api/launch-at-login') {
    const body = await readJSON(request);
    store.data.settings.launchAtLogin = Boolean(body.enabled);
    if (platform.setLaunchAtLogin) platform.setLaunchAtLogin(store.data.settings.launchAtLogin);
    await store.save();
    changed();
    return sendJSON(response, 200, { ok: true, message: '开机启动设置已更新。' });
  }

  if (request.method === 'POST' && url.pathname === '/api/script-hub/refresh') {
    await scriptHub.refresh();
    changed();
    return sendJSON(response, 200, { ok: true, message: `Script-Hub 引擎已更新：${store.data.upstreamState.revision}` });
  }

  if (request.method === 'POST' && url.pathname === '/api/github/test') {
    const isPrivate = await github.test(store.data.settings.github);
    store.data.settings.github.repositoryIsPrivate = isPrivate;
    await store.save();
    changed();
    return sendJSON(response, 200, { ok: true, isPrivate, message: isPrivate ? 'GitHub 私有仓库连接有效。' : '仓库可访问，但不是私有仓库。' });
  }

  if (request.method === 'POST' && url.pathname === '/api/publish-all') {
    const report = await publishAll(store, github);
    changed();
    return sendJSON(response, 200, { ok: true, message: publishMessage(report), report });
  }

  if (request.method === 'POST' && url.pathname === '/api/update-all') {
    updateAll(store, scriptHub, github, changed).then(changed, changed);
    return sendJSON(response, 202, { ok: true, message: '已开始更新全部模块。' });
  }

  if (request.method === 'POST' && url.pathname === '/api/source/name') {
    const body = await readJSON(request);
    return sendJSON(response, 200, { name: await sourceName(body.url) });
  }

  if (request.method === 'POST' && url.pathname === '/api/modules') {
    const body = await readJSON(request);
    const module = store.makeModule(body);
    store.data.modules.push(module);
    store.data.activity.status = `已添加 ${module.name}。`;
    await store.save();
    changed();
    return sendJSON(response, 201, { ok: true, message: store.data.activity.status });
  }

  if (request.method === 'GET' && url.pathname === '/api/combined/preview') {
    return sendText(response, 200, await combinedPreview(store));
  }

  const match = url.pathname.match(/^\/api\/modules\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return sendJSON(response, 404, { error: 'Not found', message: 'Not found' });

  const [, id, action] = match;
  const module = store.data.modules.find((item) => item.id === id);
  if (!module) return sendJSON(response, 404, { error: 'Module not found', message: '找不到这个模块。' });

  if (!action && request.method === 'PUT') {
    Object.assign(module, store.makeModule(await readJSON(request), module), { id: module.id });
    store.data.activity.status = `已保存 ${module.name}。`;
    await store.save();
    changed();
    return sendJSON(response, 200, { ok: true, message: store.data.activity.status });
  }

  if (!action && request.method === 'DELETE') {
    store.data.modules = store.data.modules.filter((item) => item.id !== id);
    await store.removeModuleFiles(id);
    await rebuildCombined(store);
    store.data.activity.status = `已删除 ${module.name}。`;
    await store.save();
    changed();
    return sendJSON(response, 200, { ok: true, message: store.data.activity.status });
  }

  if (action === 'enabled' && request.method === 'POST') {
    const body = await readJSON(request);
    module.isEnabled = Boolean(body.enabled);
    await rebuildCombined(store);
    store.data.activity.status = `${module.name} 已${module.isEnabled ? '启用' : '停用'}。`;
    await store.save();
    changed();
    return sendJSON(response, 200, { ok: true, message: store.data.activity.status });
  }

  if (action === 'update' && request.method === 'POST') {
    updateOne(store, scriptHub, module).then(() => rebuildCombined(store).then(changed), changed);
    return sendJSON(response, 202, { ok: true, message: `已开始更新 ${module.name}。` });
  }

  if (action === 'preview' && request.method === 'GET') return sendText(response, 200, await previewForModule(store, module));

  if (action === 'preview' && request.method === 'PUT') {
    const content = sanitizeSurgeModule(applyingDisplayName(module.name, await readText(request)));
    await store.writeOverride(id, content);
    module.hasOverrideConflict = false;
    module.contentHash = sha256(content);
    await rebuildCombined(store);
    store.data.activity.status = `已保存 ${module.name} 的手动编辑。`;
    await store.save();
    changed();
    return sendJSON(response, 200, { ok: true, message: store.data.activity.status });
  }

  if (action === 'preview' && request.method === 'DELETE') {
    const restored = await store.restoreOverride(id);
    await rebuildCombined(store);
    changed();
    return sendText(response, 200, materializeArguments(restored, module.argumentOverrides || {}));
  }

  if (action === 'arguments' && request.method === 'GET') {
    const content = await safeConverted(store, id);
    const payload = argumentInfo(content);
    payload.arguments = payload.arguments.map((argument) => ({
      ...argument,
      value: module.argumentOverrides?.[argument.key] ?? argument.defaultValue
    }));
    return sendJSON(response, 200, payload);
  }

  if (action === 'arguments' && request.method === 'PUT') {
    const body = await readJSON(request);
    module.argumentOverrides = module.argumentOverrides || {};
    const content = await safeConverted(store, id);
    const info = argumentInfo(content);
    const definition = info.arguments.find((item) => item.key === body.key);
    if (!definition) return sendJSON(response, 400, { error: 'Invalid argument', message: '找不到这个模块参数。' });
    const normalized = String(body.value ?? '').trim();
    if (normalized === definition.defaultValue) delete module.argumentOverrides[body.key];
    else module.argumentOverrides[body.key] = normalized;
    await rebuildCombined(store);
    await store.save();
    changed();
    return sendJSON(response, 200, { ok: true, message: `${module.name} 的模块参数已更新。` });
  }

  if (action === 'arguments' && request.method === 'DELETE') {
    module.argumentOverrides = {};
    await rebuildCombined(store);
    await store.save();
    changed();
    return sendJSON(response, 200, { ok: true, message: `${module.name} 的模块参数已恢复默认值。` });
  }

  if (action === 'override-conflict' && request.method === 'POST') {
    module.hasOverrideConflict = false;
    await store.save();
    changed();
    return sendJSON(response, 200, { ok: true, message: '已保留本地编辑。' });
  }

  return sendJSON(response, 405, { error: 'Method not allowed', message: 'Method not allowed' });
}

function statePayload(store) {
  const modules = store.data.modules.map((module) => {
    const sourceFormat = detectFormat(module.sourceFormat, module.sourceURL);
    const publishedURL = module.publishedURL || rawGitHubURL(module.outputFileName, store.data.settings.github);
    return {
      id: module.id,
      name: module.name,
      sourceURL: module.sourceURL,
      sourceFormat: module.sourceFormat,
      sourceFormatTitle: titleForFormat(sourceFormat),
      outputFileName: module.outputFileName,
      isEnabled: module.isEnabled,
      state: module.state,
      stateTitle: titleForState(module.state),
      lastUpdatedAt: module.lastUpdatedAt,
      lastError: module.lastError,
      iconURL: module.iconURL,
      publishedURL,
      advancedSummary: configuredSummary(module.scriptHubOptions),
      hasOverrideConflict: module.hasOverrideConflict,
      scriptHubOptions: { ...defaultScriptHubOptions(), ...(module.scriptHubOptions || {}) },
      policy: module.scriptHubOptions?.policy || '',
      includeKeywords: module.scriptHubOptions?.includeKeywords || '',
      excludeKeywords: module.scriptHubOptions?.excludeKeywords || '',
      mitmAdd: module.scriptHubOptions?.mitmAdd || '',
      mitmRemove: module.scriptHubOptions?.mitmRemove || '',
      noResolve: Boolean(module.scriptHubOptions?.noResolve),
      enableJQ: module.scriptHubOptions?.enableJQ !== false
    };
  });
  const newest = modules.map((module) => module.lastUpdatedAt).filter(Boolean).sort().at(-1) || null;
  return {
    combined: {
      name: 'Surge Relay Summary',
      fileName: sgmoduleName(store.data.settings.combinedModuleFileName),
      sourceCount: modules.length,
      enabledCount: modules.filter((module) => module.isEnabled).length,
      lastUpdatedAt: newest,
      subscriptionURL: rawGitHubURL(sgmoduleName(store.data.settings.combinedModuleFileName), store.data.settings.github)
    },
    modules,
    activity: store.data.activity
  };
}

async function updateAll(store, scriptHub, github, changed) {
  store.data.activity = { isWorking: true, status: '正在更新模块...', progress: 0, currentModuleID: null, error: null };
  await store.save();
  changed();

  const enabled = store.data.modules.filter((module) => module.isEnabled);
  for (let index = 0; index < enabled.length; index += 1) {
    const module = enabled[index];
    store.data.activity.currentModuleID = module.id;
    store.data.activity.progress = enabled.length ? index / enabled.length : null;
    await store.save();
    changed();
    await updateOne(store, scriptHub, module);
  }
  await rebuildCombined(store);

  let publishReport = null;
  if (store.data.settings.automaticallyPublish) {
    publishReport = await publishAll(store, github);
  }
  store.data.activity = {
    isWorking: false,
    status: publishReport ? publishMessage(publishReport) : (enabled.length ? '模块更新完成。' : '没有启用的模块需要更新。'),
    progress: null,
    currentModuleID: null,
    error: store.data.activity.error
  };
  await store.save();
}

async function updateOne(store, scriptHub, module) {
  module.state = 'updating';
  module.lastError = null;
  try {
    const result = await scriptHub.convert(module);
    await store.writeComponent(module.id, result.content);
    await store.replaceAssets(module.id, result.assets || []);
    module.iconURL = iconURLIn(result.content, module.sourceURL);
    module.contentHash = sha256(result.content);
    module.conversionEngineRevision = store.data.upstreamState?.revision || null;
    module.lastUpdatedAt = new Date().toISOString();
    module.state = 'success';
    module.lastError = null;
  } catch (error) {
    module.state = 'failed';
    module.lastError = error.message;
    store.data.activity.error = error.message;
  }
  await store.save();
}

async function rebuildCombined(store) {
  const components = [];
  for (const module of store.data.modules.filter((item) => item.isEnabled)) {
    try {
      const content = await store.readComponent(module.id);
      components.push({ module, content: materializeArguments(content, module.argumentOverrides || {}) });
    } catch {
      // Modules that have not been converted yet are skipped until the next update.
    }
  }
  if (!components.length) return;
  await store.writeCombined(mergeModules(components));
}

async function publishAll(store, github) {
  const combined = Buffer.from(await store.readCombined(), 'utf8');
  const files = [{ name: sgmoduleName(store.data.settings.combinedModuleFileName), data: combined }];
  for (const module of store.data.modules) {
    try {
      const content = materializeArguments(await store.readComponent(module.id), module.argumentOverrides || {});
      files.push({ name: module.outputFileName, data: Buffer.from(applyingDisplayName(module.name, content), 'utf8') });
    } catch {
      // A module without converted content cannot be published independently yet.
    }
  }
  files.push(...await store.generatedAssetFiles());
  const report = await github.publish(files, store.data.settings.github);
  for (const module of store.data.modules) {
    module.publishedURL = rawGitHubURL(module.outputFileName, store.data.settings.github);
  }
  await store.save();
  return report;
}

async function sourceName(sourceURL) {
  try {
    const response = await fetch(sourceURL, { headers: { 'User-Agent': 'SurgeRelayWindows/1.0' } });
    const body = await response.text();
    return displayNameIn(body) || suggestedNameFromSource(sourceURL);
  } catch {
    return suggestedNameFromSource(sourceURL);
  }
}

async function previewForModule(store, module) {
  try {
    return materializeArguments(await store.readComponent(module.id), module.argumentOverrides || {});
  } catch {
    return [`# ${module.name}`, '# 暂无缓存内容。', '# 请先执行更新。'].join('\n');
  }
}

async function safeConverted(store, id) {
  try {
    return await store.readConvertedComponent(id);
  } catch {
    return '';
  }
}

async function combinedPreview(store) {
  try {
    return await store.readCombined();
  } catch {
    const parts = [];
    for (const module of store.data.modules.filter((item) => item.isEnabled)) {
      parts.push(await previewForModule(store, module));
    }
    return parts.join('\n\n');
  }
}

function safeSettings(store) {
  return {
    ...store.data.settings,
    github: {
      ...store.data.settings.github,
      token: store.data.settings.github.token ? '********' : ''
    }
  };
}

function mergeSettings(current, patch) {
  const next = { ...current, ...patch };
  next.github = { ...current.github, ...(patch.github || {}) };
  if (patch.github?.token === '********') next.github.token = current.github.token;
  return next;
}

function rawGitHubURL(fileName, settings) {
  if (!settings?.owner || !settings?.repository || !settings?.branch) return null;
  const fullPath = repositoryPath(fileName, settings).split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${settings.owner}/${settings.repository}/${settings.branch}/${fullPath}`;
}

function publishMessage(report) {
  if (!report.publishedFiles?.length) return '没有文件需要发布。';
  const suffix = report.commitSHA ? ` 提交 ${report.commitSHA.slice(0, 8)}` : '';
  return `已发布 ${report.publishedFiles.length} 个文件到 GitHub。${suffix}`;
}

async function serveStatic(response, webRoot, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\/+/, ''));
  if (relative.includes('..')) return sendJSON(response, 404, { error: 'Not found', message: 'Not found' });
  const filePath = path.join(webRoot, relative);
  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache, must-revalidate'
    });
    response.end(data);
  } catch {
    await serveStatic(response, webRoot, '/');
  }
}

function openEvents(response, clients, payload) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  clients.add(response);
  response.write(`event: state\ndata: ${JSON.stringify(payload)}\n\n`);
  response.on('close', () => clients.delete(response));
}

function broadcast(clients, payload) {
  const data = `event: state\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(data);
}

function titleForState(state) {
  if (state === 'success') return '已更新';
  if (state === 'failed') return '更新失败';
  if (state === 'updating') return '正在更新';
  if (state === 'current') return '已是最新';
  return '尚未更新';
}

async function readText(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readJSON(request) {
  const text = await readText(request);
  return text ? JSON.parse(text) : {};
}

function sendJSON(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}

module.exports = { createServer };
