const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, 'prototype');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'catalog.js'), 'utf8'), context);
const modules = context.window.learningCatalog;
const items = modules.flatMap(m => m.groups.flatMap(g => g.items));

test('all twelve source records remain in module 00 with stable identities', () => {
  const original = modules[0].groups.flatMap(g => g.items).map(x => x.id).sort();
  assert.deepEqual(Array.from(original), Array.from({ length: 12 }, (_, i) => `SW-L${String(i + 1).padStart(2, '0')}`));
  assert.equal(modules.length, 6);
  assert.equal(new Set(items.map(x => x.id)).size, items.length);
});

test('curriculum targets guardians and keeps source references resolvable', () => {
  const originals = new Set(modules[0].groups.flatMap(g => g.items).map(x => x.id));
  for (const m of modules) {
    assert.ok(m.familyRole && m.definition && m.objective);
    for (const g of m.groups) for (const x of g.items) {
      assert.ok(x.objective && x.practice, x.id);
      assert.ok(x.sourceIds.every(id => originals.has(id)), x.id);
      assert.ok(['article', 'ppt', 'video'].includes(x.format), x.id);
      assert.ok(!/\.pdf|\bA4\b|v3\.0/i.test(x.title), x.title);
    }
  }
});

test('planning and local downloads never imply open reading', () => {
  for (const x of items) assert.equal(x.access, 'closed', x.id);
  for (const x of modules.slice(1).flatMap(m => m.groups.flatMap(g => g.items))) {
    assert.equal(x.status, 'planned', x.id);
  }
  for (const name of ['catalog.js', 'materials-manifest.js', 'lesson.js', 'lesson.html']) {
    assert.ok(!/feishu\.cn|watcher-learning-private|file_token|saved_path/.test(fs.readFileSync(path.join(root, name), 'utf8')), name);
  }
});
