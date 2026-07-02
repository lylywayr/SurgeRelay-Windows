const crypto = require('node:crypto');
const path = require('node:path');

const sourceFormatTitles = {
  automatic: 'Automatic',
  quantumultX: 'Quantumult X Rewrite',
  loon: 'Loon Plugin',
  surge: 'Surge Module'
};

function sanitizeBaseName(value) {
  const base = String(value || 'module')
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'module';
}

function sgmoduleName(value) {
  const base = sanitizeBaseName(value);
  return base.toLowerCase().endsWith('.sgmodule') ? base : `${base}.sgmodule`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function gitBlobSHA1(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  return crypto
    .createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buffer.length}\0`), buffer]))
    .digest('hex');
}

function suggestedNameFromSource(sourceURL) {
  try {
    const url = new URL(sourceURL);
    const last = path.posix.basename(url.pathname) || url.hostname;
    return sanitizeBaseName(decodeURIComponent(last)).replace(/-/g, ' ');
  } catch {
    return sanitizeBaseName(sourceURL).replace(/-/g, ' ');
  }
}

function detectFormat(format, sourceURL) {
  if (format && format !== 'automatic') return format;
  const value = String(sourceURL || '').toLowerCase();
  if (value.endsWith('.sgmodule') || value.includes('/surge/')) return 'surge';
  if (value.endsWith('.plugin') || value.includes('/loon/')) return 'loon';
  if (value.includes('/quantumultx/') || value.includes('/quantumult-x/') || value.includes('/qx/')) return 'quantumultX';
  return 'quantumultX';
}

function scriptHubType(format, sourceURL) {
  const resolved = detectFormat(format, sourceURL);
  if (resolved === 'loon') return 'loon-plugin';
  if (resolved === 'surge') return 'surge-module';
  return 'qx-rewrite';
}

function titleForFormat(format) {
  return sourceFormatTitles[format] || sourceFormatTitles.automatic;
}

function defaultScriptHubOptions() {
  return {
    scriptConversionKeywords: '',
    convertAllScripts: false,
    responseScriptConversionKeywords: '',
    convertAllResponseScripts: false,
    compatibilityOnly: false,
    prependScript: '',
    scriptEvalOriginal: '',
    scriptEvalConverted: '',
    scriptEvalOriginalURL: '',
    scriptEvalConvertedURL: '',
    includeKeywords: '',
    excludeKeywords: '',
    syncMITMToForceHTTP: false,
    removeCommentedRewrites: true,
    keepMapLocalHeaders: false,
    useJSDelivr: false,
    policy: '',
    mitmAdd: '',
    mitmRemove: '',
    mitmRemoveRegex: '',
    scriptNameTargets: '',
    scriptNames: '',
    timeoutTargets: '',
    timeoutValues: '',
    engineTargets: '',
    engineValues: '',
    cronTargets: '',
    cronExpressions: '',
    argumentTargets: '',
    argumentValues: '',
    noResolve: false,
    sniKeywords: '',
    preMatchingKeywords: '',
    enableJQ: true,
    requestHeaders: '',
    evalOriginal: '',
    evalConverted: '',
    evalOriginalURL: '',
    evalConvertedURL: ''
  };
}

function scriptHubQueryItems(options = {}) {
  const merged = { ...defaultScriptHubOptions(), ...options };
  const values = [
    ['del', String(merged.removeCommentedRewrites)],
    ['jqEnabled', String(merged.enableJQ)],
    ['noNtf', 'true']
  ];
  const addText = (name, value) => {
    const text = String(value || '').trim();
    if (text) values.push([name, value]);
  };
  const addBool = (name, value) => {
    if (value) values.push([name, 'true']);
  };

  addText('jsc', merged.convertAllScripts ? '.' : merged.scriptConversionKeywords);
  addText('jsc2', merged.convertAllResponseScripts ? '.' : merged.responseScriptConversionKeywords);
  addBool('compatibilityOnly', merged.compatibilityOnly);
  addText('prepend', merged.prependScript);
  addText('evJsori', merged.scriptEvalOriginal);
  addText('evJsmodi', merged.scriptEvalConverted);
  addText('evUrlori', merged.scriptEvalOriginalURL);
  addText('evUrlmodi', merged.scriptEvalConvertedURL);
  addText('y', merged.includeKeywords);
  addText('x', merged.excludeKeywords);
  addBool('synMitm', merged.syncMITMToForceHTTP);
  addBool('keepHeader', merged.keepMapLocalHeaders);
  addBool('jsDelivr', merged.useJSDelivr);
  addText('policy', merged.policy);
  addText('hnadd', merged.mitmAdd);
  addText('hndel', merged.mitmRemove);
  addText('hnregdel', merged.mitmRemoveRegex);
  addText('njsnametarget', merged.scriptNameTargets);
  addText('njsname', merged.scriptNames);
  addText('timeoutt', merged.timeoutTargets);
  addText('timeoutv', merged.timeoutValues);
  addText('enginet', merged.engineTargets);
  addText('enginev', merged.engineValues);
  addText('cron', merged.cronTargets);
  addText('cronexp', merged.cronExpressions);
  addText('arg', merged.argumentTargets);
  addText('argv', merged.argumentValues);
  addBool('nore', merged.noResolve);
  addText('sni', merged.sniKeywords);
  addText('pm', merged.preMatchingKeywords);
  addText('headers', merged.requestHeaders);
  addText('evalScriptori', merged.evalOriginal);
  addText('evalScriptmodi', merged.evalConverted);
  addText('evalUrlori', merged.evalOriginalURL);
  addText('evalUrlmodi', merged.evalConvertedURL);
  return values;
}

function conversionURL(module) {
  const sourceURL = new URL(module.sourceURL);
  const source = sourceURL.href.split('#')[0];
  const fileName = encodeURIComponent(sanitizeBaseName(module.outputFileName || module.name));
  const params = new URLSearchParams([
    ['type', scriptHubType(module.sourceFormat, module.sourceURL)],
    ['target', 'surge-module'],
    ...scriptHubQueryItems(module.scriptHubOptions)
  ]);
  return `http://script.hub/file/_start_/${source}/_end_/${fileName}.sgmodule?${params.toString()}`;
}

function displayNameIn(content) {
  const match = String(content).match(/^\s*#!\s*name\s*=\s*(.+?)\s*$/im);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || null;
}

function iconURLIn(content, source) {
  const match = String(content).match(/^\s*#!\s*icon\s*=\s*(.+?)\s*$/im);
  if (!match) return null;
  try {
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    const url = new URL(value, source || undefined);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function applyingDisplayName(name, content) {
  const line = `#!name=${String(name || '').trim()}`;
  const normalized = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/^\s*#!name\s*=.*$/im.test(normalized)) {
    return normalized.replace(/^\s*#!name\s*=.*$/im, line);
  }
  return `${line}\n${normalized}`;
}

function argumentInfo(content) {
  const args = metadataValue('arguments', content);
  if (!args) return { arguments: [], help: null };
  const definitions = parseArguments(args).map(([key, defaultValue]) => ({ key, defaultValue, value: defaultValue }));
  const help = metadataValue('arguments-desc', content)?.replace(/\\n/g, '\n').trim() || null;
  return { arguments: definitions, help };
}

function materializeArguments(content, overrides = {}) {
  const info = argumentInfo(content);
  let resolved = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const definition of info.arguments) {
    const value = overrides[definition.key] ?? definition.defaultValue;
    resolved = resolved.split(`%${definition.key}%`).join(value);
    resolved = resolved.split(`{{{${definition.key}}}}`).join(value);
  }
  const output = [];
  let previousEmpty = false;
  for (const line of resolved.split('\n')) {
    const trimmed = line.trim();
    if (/^#!\s*arguments(?:-desc)?\s*=/i.test(trimmed)) continue;
    if (trimmed && !trimmed.startsWith('#!') && (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith(';'))) continue;
    if (!trimmed) {
      if (previousEmpty || !output.length) continue;
      previousEmpty = true;
    } else {
      previousEmpty = false;
    }
    output.push(line);
  }
  while (output.length && !output.at(-1).trim()) output.pop();
  return `${output.join('\n')}\n`;
}

function sanitizeSurgeModule(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const preamble = [];
  const sections = [];
  let current = null;
  const generatedScripts = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 2) {
      current = { header: trimmed, name: trimmed.slice(1, -1), lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      preamble.push(rawLine);
      continue;
    }
    if (/^Body Rewrite$/i.test(current.name) && isEmptyBodyRewrite(trimmed)) continue;
    if (/^Map Local$/i.test(current.name)) {
      const script = convertedLoonScript(trimmed, [...existingScriptNames(sections), ...generatedScripts]);
      if (script && !generatedScripts.includes(script)) {
        generatedScripts.push(script);
        continue;
      }
    }
    current.lines.push(rawLine);
  }

  if (generatedScripts.length) {
    const scriptSection = sections.find((section) => /^Script$/i.test(section.name));
    if (scriptSection) {
      if (scriptSection.lines.length && scriptSection.lines.at(-1).trim()) scriptSection.lines.push('');
      scriptSection.lines.push(...generatedScripts);
    } else {
      sections.push({ header: '[Script]', name: 'Script', lines: generatedScripts });
    }
  }

  const output = [...preamble];
  for (const section of sections) {
    if (output.length && output.at(-1).trim()) output.push('');
    output.push(section.header, ...section.lines);
  }
  while (output.length && !output.at(-1).trim()) output.pop();
  return `${output.join('\n')}\n`;
}

function validateSurgeModule(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) throw new Error('转换结果为空。');
  if (trimmed.startsWith('<!DOCTYPE html') || trimmed.includes('Script Hub 重写转换: ❌')) {
    throw new Error(trimmed.slice(0, 240));
  }
  const markers = ['#!name=', '[General]', '[MITM]', '[Script]', '[URL Rewrite]', '[Header Rewrite]', '[Rule]'];
  if (!markers.some((marker) => trimmed.includes(marker))) {
    throw new Error('没有检测到 Surge 模块标记或可用配置段。');
  }
}

function mergeModules(components) {
  const parsed = components.map(({ module, content }) => parseModule(module, sanitizeSurgeModule(materializeArguments(content, {}))));
  if (!parsed.some((item) => item.sections.length)) throw new Error('没有找到可合并的 Surge 配置段。');
  const output = [
    '#!name=Surge Relay',
    `#!desc=由 Surge Relay 整合 ${components.length} 个模块`,
    `#!author=Surge Relay${mergedAuthors(parsed)}`,
    '#!category=Surge Relay'
  ];
  const requirements = [...new Set(parsed.flatMap((item) => item.requirements).map(sanitizeRequirement).filter(Boolean))].sort();
  if (requirements.length) output.push(`#!requirement=${requirements.map((item) => `(${item})`).join(' && ')}`);
  for (const sectionName of orderedSectionNames(parsed)) {
    const groups = parsed
      .map((item) => ({ module: item.module, section: item.sections.find((section) => section.name.toLowerCase() === sectionName.toLowerCase()) }))
      .filter((item) => item.section)
      .map((item) => ({ module: item.module, lines: item.section.lines }));
    const lines = mergeLines(groups, sectionName);
    if (!lines.length) continue;
    output.push('', `[${sectionName}]`, ...lines);
  }
  return `${output.join('\n').trim()}\n`;
}

function metadataValue(name, content) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content || '').match(new RegExp(`^\\s*#!\\s*${escaped}\\s*=\\s*(.*?)\\s*$`, 'im'));
  return match?.[1];
}

function parseArguments(value) {
  const pairs = value.includes('=')
    ? value.split('&').map((pair) => pair.split(/=(.*)/s).slice(0, 2))
    : value.split(',').map((pair) => pair.split(/:(.*)/s).slice(0, 2));
  return pairs
    .filter((pair) => pair.length === 2)
    .map(([key, val]) => [decodeURIComponent(key || '').trim(), decodeURIComponent(val || '').trim().replace(/^['"]|['"]$/g, '')])
    .filter(([key]) => key);
}

function isEmptyBodyRewrite(line) {
  if (!/^http-(?:request|response)(?:-jq)?\s+\S+/i.test(line)) return false;
  const parts = line.split(/\s+/, 3);
  if (parts.length < 3) return true;
  const value = parts[2].trim();
  return parts[0].toLowerCase().endsWith('-jq') ? !value.replace(/^['"]|['"]$/g, '').trim() : !value;
}

function convertedLoonScript(line, existing) {
  const match = line.match(/^(.+?)\s+url\s+script-(request|response)-(body|header)\s+(https?:\/\/\S+)(?:\s+.*)?$/i);
  if (!match) return null;
  const identifier = uniqueScriptName(sanitizeBaseName(path.posix.basename(new URL(match[4]).pathname, path.posix.extname(new URL(match[4]).pathname))), existing);
  return `${identifier} = type=http-${match[2].toLowerCase()}, pattern=${match[1]}, requires-body=${match[3].toLowerCase() === 'body' ? '1' : '0'}, script-path=${match[4]}`;
}

function existingScriptNames(sections) {
  const script = sections.find((section) => /^Script$/i.test(section.name));
  if (!script) return [];
  return script.lines.map((line) => line.split('=')[0]?.trim()).filter(Boolean);
}

function uniqueScriptName(raw, existing) {
  const base = String(raw || 'converted_script').replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[_-]+|[_-]+$/g, '') || 'converted_script';
  const unavailable = new Set(existing.map((item) => String(item).toLowerCase()));
  if (!unavailable.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (unavailable.has(`${base}_${suffix}`.toLowerCase())) suffix += 1;
  return `${base}_${suffix}`;
}

function parseModule(module, content) {
  const sections = [];
  const requirements = [];
  const authors = [];
  let current = null;
  for (const rawLine of String(content || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('[') && line.endsWith(']') && line.length > 2) {
      current = { name: line.slice(1, -1), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      if (line) current.lines.push(rawLine);
    } else if (line.startsWith('#!requirement=')) {
      requirements.push(line.slice('#!requirement='.length));
    } else if (line.startsWith('#!author=')) {
      authors.push(line.slice('#!author='.length));
    }
  }
  return { module, sections, requirements, authors };
}

function mergedAuthors(modules) {
  const authors = [...new Set(modules.flatMap((item) => item.authors))].sort();
  return authors.length ? ` · ${authors.join(' · ')}` : '';
}

function orderedSectionNames(modules) {
  const preferred = ['General', 'MITM', 'Rule', 'Host', 'URL Rewrite', 'Header Rewrite', 'Body Rewrite', 'Map Local', 'Script'];
  const names = [];
  for (const name of preferred) {
    if (modules.some((item) => item.sections.some((section) => section.name.toLowerCase() === name.toLowerCase()))) names.push(name);
  }
  for (const name of modules.flatMap((item) => item.sections.map((section) => section.name))) {
    if (!names.some((existing) => existing.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

function mergeLines(groups, sectionName) {
  if (/^(General|MITM)$/i.test(sectionName)) return mergeKeyValueLines(groups);
  const output = [];
  const seen = new Set();
  for (const group of groups) {
    for (const line of group.lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith(';')) continue;
      if (!seen.has(line)) {
        seen.add(line);
        output.push(line);
      }
    }
  }
  return output;
}

function mergeKeyValueLines(groups) {
  const order = [];
  const values = new Map();
  for (const group of groups) {
    for (const line of group.lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith(';')) continue;
      const index = line.indexOf('=');
      if (index < 0) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      const normalized = key.toLowerCase();
      if (!values.has(normalized)) order.push(normalized);
      const existing = values.get(normalized);
      const combined = existing && combineDirective(existing.value, value);
      if (combined) values.set(normalized, { key: existing.key, value: combined });
      else if (!existing) values.set(normalized, { key, value });
    }
  }
  return order.map((key) => values.get(key)).filter(Boolean).map((item) => `${item.key} = ${item.value}`);
}

function combineDirective(lhs, rhs) {
  const directive = ['%APPEND%', '%INSERT%'].find((item) => lhs.startsWith(item) && rhs.startsWith(item));
  if (!directive) return null;
  const seen = new Set();
  const items = `${lhs.slice(directive.length)},${rhs.slice(directive.length)}`
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && !seen.has(item) && seen.add(item));
  return `${directive} ${items.join(', ')}`;
}

function sanitizeRequirement(requirement) {
  if (!['SYSTEM', 'SYSTEM_VERSION', 'DEVICE_MODEL'].some((item) => requirement.includes(item))) return requirement;
  const matches = requirement.match(/CORE_VERSION\s*(?:>=|<=|==|=|>|<)\s*[0-9]+/gi);
  return matches?.join(' && ') || null;
}

function configuredSummary(options = {}) {
  const defaults = defaultScriptHubOptions();
  const labels = [];
  if (options.policy) labels.push(`Policy: ${options.policy}`);
  if (options.includeKeywords) labels.push('Include filters');
  if (options.excludeKeywords) labels.push('Exclude filters');
  if (options.mitmAdd || options.mitmRemove || options.mitmRemoveRegex) labels.push('MITM changes');
  if (options.noResolve !== defaults.noResolve) labels.push('no-resolve');
  if (options.enableJQ !== defaults.enableJQ) labels.push('JQ changed');
  return labels.length ? labels.join(' | ') : null;
}

module.exports = {
  defaultScriptHubOptions,
  applyingDisplayName,
  argumentInfo,
  conversionURL,
  detectFormat,
  displayNameIn,
  gitBlobSHA1,
  configuredSummary,
  iconURLIn,
  materializeArguments,
  mergeModules,
  sanitizeSurgeModule,
  scriptHubType,
  sha256,
  sgmoduleName,
  suggestedNameFromSource,
  titleForFormat,
  validateSurgeModule
};
