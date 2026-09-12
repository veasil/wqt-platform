import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChange } from '../scripts/artifacts/new-change.mjs';
import { checkArtifacts } from '../scripts/artifacts/check.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wqt-artifacts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['docs/changes', 'docs/architecture', 'docs/development', '.github']) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/README.md', 'docs/wqt-application-architecture.md', 'docs/engineering-history.md']) writeFileSync(join(root, file), '# Document\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'wqt-platform' }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'wqt-platform', packages: { '': { name: 'wqt-platform' } } }));
  return root;
}

test('creates a valid draft without claiming approval and protects duplicate IDs', t => {
  const root = fixture(t);
  const target = createChange(root, 'WQT-002', 'example');
  const spec = readFileSync(join(target, 'spec.md'), 'utf8');
  assert.match(spec, /状态：草案/);
  assert.match(spec, /待需求方确认/);
  assert.deepEqual(checkArtifacts(root).errors, []);
  assert.throws(() => createChange(root, 'WQT-002', 'different'), /already exists/);
  assert.equal(readFileSync(join(target, 'spec.md'), 'utf8'), spec);
});

test('rejects invalid IDs and path traversal', t => {
  const root = fixture(t);
  for (const [id, slug] of [['../../outside', 'topic'], ['WQT-003', '../outside'], ['WQT-003', 'Uppercase']]) {
    assert.throws(() => createChange(root, id, slug));
  }
});

test('reports missing artifacts, broken links and inconsistent package names', t => {
  const root = fixture(t);
  const target = createChange(root, 'WQT-004', 'broken');
  unlinkSync(join(target, 'plan.md'));
  writeFileSync(join(root, 'README.md'), '# Document\n[missing](absent.md)\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'wrong' }));
  const errors = checkArtifacts(root).errors.join('\n');
  assert.match(errors, /Missing artifact/);
  assert.match(errors, /broken link/);
  assert.match(errors, /package names/);
});

test('supports single-file changes and rejects duplicate IDs during checks', t => {
  const root = fixture(t);
  const dir = join(root, 'docs/changes/WQT-005-small');
  mkdirSync(dir);
  writeFileSync(join(dir, 'change.md'), '# WQT-005\n\n## 目标与范围\n\n## 验收标准\n\n## 步骤\n\n## 验证记录\n\n## 验收与交付\n');
  assert.deepEqual(checkArtifacts(root).errors, []);
  mkdirSync(join(root, 'docs/changes/WQT-005-duplicate'));
  assert.match(checkArtifacts(root).errors.join('\n'), /Duplicate change ID/);
});
