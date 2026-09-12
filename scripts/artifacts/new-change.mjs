import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createChange(root, id, slug) {
  if (!/^WQT-[0-9]{3,}$/.test(id || '')) throw new Error('ID must be WQT-001 or another numeric WQT ID.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '')) throw new Error('Topic must be lowercase words separated by hyphens.');
  const parent = resolve(root, 'docs/changes');
  mkdirSync(parent, { recursive: true });
  if (readdirSync(parent).some(name => name.startsWith(id + '-'))) throw new Error('Change ID already exists: ' + id);
  const target = resolve(parent, id + '-' + slug);
  if (existsSync(target)) throw new Error('Change already exists.');
  mkdirSync(target);
  const title = id + ' · ' + slug;
  const files = {
    'spec.md': '# ' + title + '\n\n状态：草案\n需求来源：待填写\nIssue / PR：待建立\n\n## 目标与范围\n\n待填写。\n\n## 非目标\n\n待填写。\n\n## 验收标准\n\n| ID | 标准 | 验证方式 |\n|---|---|---|\n| AC-01 | 待定义 | 待定义 |\n\n## 确认与验收\n\n待需求方确认具体版本；不得由执行者代签。\n',
    'plan.md': '# ' + title + ' · 计划\n\n## 步骤\n\n- [ ] 待拆分。\n\n## 回退\n\n待说明变更影响；不涉及迁移时注明。\n',
    'evidence.md': '# ' + title + ' · 证据\n\n## 验证记录\n\n| 验收 ID | 环境与版本 | 命令/操作 | 结果 |\n|---|---|---|---|\n| AC-01 | 待填写 | 未执行 | 未验证 |\n\n## 验收与交付\n\n待验收；未合并、未发布。\n'
  };
  for (const [name, body] of Object.entries(files)) writeFileSync(resolve(target, name), body, { flag: 'wx' });
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    console.log(createChange(root, process.argv[2], process.argv[3]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
