const { gitBlobSHA1 } = require('./module-utils');

class GitHubClient {
  async test(settings) {
    assertConfigured(settings);
    const metadata = await this.request(settings, `/repos/${settings.owner}/${settings.repository}`);
    return Boolean(metadata.private);
  }

  async publish(files, settings) {
    assertConfigured(settings);
    if (!settings.token) throw new Error('缺少 GitHub Token。');
    if (!files.length) throw new Error('没有文件需要发布。');
    const isPrivate = await this.test(settings);
    if (!isPrivate) throw new Error('为避免公开仓库被滥用，发布目标必须是私有仓库。');

    const changed = [];
    for (const file of files) {
      const sha = await this.existingSHA(file.name, settings);
      if (sha !== gitBlobSHA1(file.data)) changed.push(file);
    }
    if (!changed.length) return { publishedFiles: [], commitSHA: null };

    const branch = encodeURIComponent(settings.branch);
    const reference = await this.request(settings, `/repos/${settings.owner}/${settings.repository}/git/ref/heads/${branch}`);
    const head = await this.request(settings, `/repos/${settings.owner}/${settings.repository}/git/commits/${reference.object.sha}`);
    const tree = [];
    for (const file of changed) {
      const blob = await this.request(settings, `/repos/${settings.owner}/${settings.repository}/git/blobs`, {
        method: 'POST',
        body: { content: Buffer.from(file.data).toString('base64'), encoding: 'base64' }
      });
      tree.push({ path: repositoryPath(file.name, settings), mode: '100644', type: 'blob', sha: blob.sha });
    }
    const nextTree = await this.request(settings, `/repos/${settings.owner}/${settings.repository}/git/trees`, {
      method: 'POST',
      body: { base_tree: head.tree.sha, tree }
    });
    const commit = await this.request(settings, `/repos/${settings.owner}/${settings.repository}/git/commits`, {
      method: 'POST',
      body: {
        message: `Update ${changed.length} files via Surge Relay Windows`,
        tree: nextTree.sha,
        parents: [head.sha]
      }
    });
    await this.request(settings, `/repos/${settings.owner}/${settings.repository}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: false }
    });
    return { publishedFiles: changed.map((file) => file.name), commitSHA: commit.sha };
  }

  async existingSHA(fileName, settings) {
    const path = encodeURIComponent(repositoryPath(fileName, settings)).replace(/%2F/g, '/');
    const response = await this.rawRequest(settings, `/repos/${settings.owner}/${settings.repository}/contents/${path}?ref=${encodeURIComponent(settings.branch)}`);
    if (response.status === 404) return null;
    const data = await parseJSONResponse(response);
    if (!response.ok) throw new Error(data.message || `GitHub HTTP ${response.status}`);
    return data.sha;
  }

  async request(settings, path, options = {}) {
    const response = await this.rawRequest(settings, path, options);
    const data = await parseJSONResponse(response);
    if (!response.ok) throw new Error(data.message || `GitHub HTTP ${response.status}`);
    return data;
  }

  async rawRequest(settings, path, options = {}) {
    return fetch(`https://api.github.com${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'SurgeRelayWindows/1.0',
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  }
}

function assertConfigured(settings) {
  if (!settings?.owner || !settings?.repository || !settings?.branch) {
    throw new Error('GitHub 仓库配置不完整。');
  }
}

async function parseJSONResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

function repositoryPath(fileName, settings) {
  const directory = String(settings.directory || '').replace(/^\/+|\/+$/g, '');
  return [directory, fileName].filter(Boolean).join('/');
}

module.exports = { GitHubClient, repositoryPath };
