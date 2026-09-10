import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function checkArtifacts(root) {
  const errors = [];
  const read = path => readFileSync(resolve(root, path), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  if (pkg.name !== 'wqt-platform' || lock.name !== pkg.name || lock.packages?.['']?.name !== pkg.name) errors.push('Root package names must all be wqt-platform.');
  const files = new Set(['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/README.md', 'docs/wqt-application-architecture.md', 'docs/engineering-history.md']);
  function collect(path) {
    if (!existsSync(resolve(root, path))) { errors.push('Missing directory: ' + path); return; }
    for (const item of readdirSync(resolve(root, path), { withFileTypes: true })) {
      const child = path + '/' + item.name;
      if (item.isDirectory()) collect(child);
      else if (item.isFile() && child.endsWith('.md')) files.add(child);
    }
  }
  for (const path of ['docs/changes', 'docs/architecture', 'docs/development', '.github']) collect(path);
  const changes = resolve(root, 'docs/changes');
  const ids = new Set();
  if (existsSync(changes)) {
    for (const item of readdirSync(changes, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const match = /^(WQT-[0-9]{3,})-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(item.name);
      if (!match) { errors.push('Invalid change directory: ' + item.name); continue; }
      if (ids.has(match[1])) errors.push('Duplicate change ID: ' + match[1]);
      ids.add(match[1]);
      const prefix = 'docs/changes/' + item.name + '/';
      const single = existsSync(resolve(root, prefix + 'change.md'));
      const required = single ? { 'change.md': ['## 目标与范围', '## 验收标准', '## 步骤', '## 验证记录', '## 验收与交付'] }
        : { 'spec.md': ['## 目标与范围', '## 验收标准', '## 确认与验收'], 'plan.md': ['## 步骤', '## 回退'], 'evidence.md': ['## 验证记录', '## 验收与交付'] };
      for (const [name, headings] of Object.entries(required)) {
        const path = prefix + name;
        if (!existsSync(resolve(root, path))) { errors.push('Missing artifact: ' + path); continue; }
        const body = read(path);
        for (const heading of headings) if (!body.split(/\r?\n/).includes(heading)) errors.push(path + ': missing ' + heading);
      }
    }
  }
  for (const path of files) {
    if (!existsSync(resolve(root, path))) { errors.push('Missing document: ' + path); continue; }
    const body = read(path);
    if ((body.match(/^\s*```/gm) || []).length % 2) errors.push('Unbalanced code fence: ' + path);
    const prose = body.replace(/```[^\n]*\n[\s\S]*?```/g, '');
    for (const match of prose.matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue;
      const target = href.split('#')[0];
      if (!target) continue;
      if (!existsSync(resolve(dirname(resolve(root, path)), target))) errors.push(path + ': broken link ' + href);
    }
  }
  return { errors, documentCount: files.size, changeCount: ids.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = checkArtifacts(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
    for (const error of result.errors) console.error(error);
    if (result.errors.length) process.exitCode = 1;
    else console.log('Artifacts OK: ' + result.documentCount + ' documents, ' + result.changeCount + ' changes. Structure only; no acceptance or runtime guarantee.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
