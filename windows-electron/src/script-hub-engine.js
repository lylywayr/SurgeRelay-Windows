const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const {
  applyingDisplayName,
  conversionURL,
  detectFormat,
  iconURLIn,
  sanitizeSurgeModule,
  sha256,
  validateSurgeModule
} = require('./module-utils');

const SCRIPT_HUB_MODULE_URL = 'https://raw.githubusercontent.com/Script-Hub-Org/Script-Hub/main/modules/script-hub.surge.sgmodule';

class ScriptHubEngine {
  constructor(store) {
    this.store = store;
  }

  async ensureScripts() {
    if (await this.store.hasEngineScript('Rewrite-Parser.js')) return;
    await this.refresh();
  }

  async refresh() {
    const response = await fetch(this.store.data.settings.scriptHubModuleURL || SCRIPT_HUB_MODULE_URL, {
      headers: { 'User-Agent': 'SurgeRelayWindows/1.0' }
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Script-Hub module HTTP ${response.status}: ${body.slice(0, 240)}`);
    if (!body.includes('script.hub') || !body.includes('script-path=')) {
      throw new Error('上游文件不是可识别的 Script-Hub Surge 模块。');
    }

    const scripts = {};
    let revisionMaterial = body;
    for (const url of scriptURLs(body)) {
      const scriptResponse = await fetch(url, { headers: { 'User-Agent': 'SurgeRelayWindows/1.0' } });
      const script = await scriptResponse.text();
      if (!scriptResponse.ok || !script.trim()) throw new Error(`无法获取 Script-Hub 脚本：${url}`);
      scripts[path.posix.basename(new URL(url).pathname)] = script;
      revisionMaterial += script;
    }
    if (!scripts['Rewrite-Parser.js']) throw new Error('Script-Hub 上游没有引用 Rewrite-Parser.js。');
    this.store.data.upstreamState = {
      revision: sha256(revisionMaterial).slice(0, 12),
      lastUpdatedAt: new Date().toISOString(),
      lastError: null
    };
    await this.store.saveEngineScripts(scripts);
    await this.store.save();
  }

  async convert(module) {
    const resolved = detectFormat(module.sourceFormat, module.sourceURL);
    if (resolved === 'surge') {
      const response = await fetch(module.sourceURL, { headers: { 'User-Agent': 'SurgeRelayWindows/1.0' } });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
      const content = sanitizeSurgeModule(applyingDisplayName(module.name, body));
      validateSurgeModule(content);
      return { content, requestURL: module.sourceURL, assets: [] };
    }

    await this.ensureScripts();
    const parser = await this.store.readEngineScript('Rewrite-Parser.js');
    const converter = await this.store.readEngineScript('script-converter.js');
    const requestURL = conversionURL(module);
    const converted = await executeScriptHubScript(parser, {
      requestURL,
      converterScript: converter
    });
    const materialized = await this.materializeConvertedScripts(converted, module, converter);
    const content = sanitizeSurgeModule(applyingDisplayName(module.name, materialized.content));
    validateSurgeModule(content);
    return { content, requestURL, assets: materialized.assets };
  }

  async materializeConvertedScripts(content, module, converterScript) {
    const matches = [...String(content).matchAll(/script-path\s*=\s*(http:\/\/script\.hub\/convert\/_start_\/.*?\/_end_\/[^,\s]+)/g)];
    const urls = [...new Set(matches.map((match) => match[1]))].sort();
    if (!urls.length) return { content, assets: [] };

    let rewritten = content;
    const assets = [];
    for (const source of urls) {
      const converted = await executeScriptHubScript(converterScript, { requestURL: source });
      if (!converted.trim()) throw new Error('脚本转换返回了空内容。');
      const hash = sha256(source).slice(0, 12);
      const tail = decodeURIComponent(source.split('/_end_/').pop().split('?')[0] || 'script.js');
      const fileName = tail.toLowerCase().endsWith('.js') ? tail : `${tail}.js`;
      const relativePath = `assets/${module.id}/${hash}-${fileName}`;
      const localURL = `./${relativePath.replace(/\\/g, '/')}`;
      rewritten = rewritten.split(source).join(localURL);
      assets.push({ relativePath, data: Buffer.from(converted, 'utf8') });
    }
    return { content: rewritten, assets };
  }
}

async function executeScriptHubScript(script, { requestURL, converterScript = null }) {
  let output = null;
  let exception = null;
  const timers = new Set();

  const context = vm.createContext({
    $environment: { 'surge-version': 'Surge Relay Windows 1.0' },
    $request: { url: requestURL, method: 'GET', headers: { 'User-Agent': 'SurgeRelayWindows/1.0' } },
    $persistentStore: {
      read: () => null,
      write: () => true
    },
    $notification: { post: () => {} },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms = 0, ...args) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn(...args);
      }, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      timers.delete(timer);
      clearTimeout(timer);
    },
    $done: (value = {}) => {
      output = value?.response?.body ?? value?.body ?? '';
    }
  });

  context.$httpClient = {};
  for (const method of ['get', 'post', 'put', 'delete']) {
    context.$httpClient[method] = (request, callback) => {
      performHTTP(method.toUpperCase(), request, converterScript)
        .then(({ status, headers, body }) => callback(null, { status, statusCode: status, headers }, body))
        .catch((error) => callback(String(error?.message || error), null, ''));
    };
  }

  try {
    vm.runInContext(script, context, { timeout: 10000 });
  } catch (error) {
    exception = error;
  }

  const deadline = Date.now() + 30000;
  while (output === null && !exception && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  for (const timer of timers) clearTimeout(timer);
  if (exception) throw exception;
  if (output === null) throw new Error('Script-Hub 内置引擎未在限定时间内返回结果。');
  return String(output);
}

async function performHTTP(method, value, converterScript) {
  const url = typeof value === 'string' ? value : value.url;
  const parsed = new URL(url);
  if (parsed.hostname === 'script.hub' && parsed.pathname.includes('/convert/_start_/') && converterScript) {
    return {
      status: 200,
      headers: {},
      body: await executeScriptHubScript(converterScript, { requestURL: url })
    };
  }
  const response = await fetch(url, {
    method,
    headers: typeof value === 'string' ? undefined : value.headers,
    body: typeof value === 'string' ? undefined : value.body
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
}

function scriptURLs(moduleText) {
  const seen = new Set();
  return [...moduleText.matchAll(/script-path=(https:\/\/raw\.githubusercontent\.com\/[^,\s?]+)(?:\?[^,\s]*)?/g)]
    .map((match) => match[1])
    .filter((url) => !seen.has(url) && seen.add(url));
}

module.exports = { SCRIPT_HUB_MODULE_URL, ScriptHubEngine };
