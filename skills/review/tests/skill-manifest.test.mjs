import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skill = () => readFile(join(root, 'SKILL.md'), 'utf8');

function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md must open with a frontmatter block');
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2];
  }
  return fields;
}

test('frontmatter declares a name matching the skill directory', async () => {
  const fm = frontmatter(await skill());
  assert.equal(fm.name, basename(root), 'name must match the directory Claude loads it from');
});

test('frontmatter carries a description that says when to fire', async () => {
  const { description } = frontmatter(await skill());
  assert.ok(description && description.length > 120,
    'a thin description is why a skill never triggers');
  assert.match(description, /Use when/i);
});

test('no tabs in frontmatter, which breaks YAML parsing', async () => {
  const src = await skill();
  const block = src.match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.ok(!block.includes('\t'), 'tabs are not valid YAML indentation');
});

test('every file path SKILL.md tells Claude to run actually exists', async () => {
  const src = await skill();
  const paths = [...new Set(src.match(/(?:bin|lib|scripts|engine|templates)\/[A-Za-z0-9._-]+/g) ?? [])];
  assert.ok(paths.length >= 4, 'expected SKILL.md to reference the runnable entry points');
  for (const p of paths) {
    await assert.doesNotReject(access(join(root, p)),
      `SKILL.md points at ${p}, which does not exist - a rename broke the skill silently`);
  }
});

test('every import in SKILL.md resolves to a real export', async () => {
  const src = await skill();

  // Exact, not heuristic: read the import statements the skill tells Claude to write.
  // An earlier version of this test filtered candidate names by whether they were
  // already exported, which made it pass for exactly the renames it existed to catch.
  const imports = [...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)];
  assert.ok(imports.length >= 2, 'expected SKILL.md to show how to import the library');

  for (const [, names, mod] of imports) {
    const modPath = join(root, mod);
    await assert.doesNotReject(access(modPath), `SKILL.md imports from ${mod}, which does not exist`);
    const code = await readFile(modPath, 'utf8');
    const exported = new Set([...code.matchAll(/export function ([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    for (const raw of names.split(',')) {
      const name = raw.trim();
      if (!name) continue;
      assert.ok(exported.has(name), `SKILL.md imports ${name} from ${mod}, which does not export it`);
    }
  }
});

test('the collect discipline rules are present, since they are the skill', async () => {
  const src = await skill();
  for (const rule of [/must-fix[^\n]*before[^\n]*nit/i, /verbatim/i, /pushed-back/i, /orphan/i]) {
    assert.match(src, rule, `a collect rule went missing: ${rule}`);
  }
});

test('nothing in the skill references a path outside itself', async () => {
  const files = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(mjs|js|md|html|json)$/.test(e.name)) files.push(p);
    }
  };
  await walk(root);
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    assert.ok(!/\/Users\/[a-z]+\//i.test(src),
      `${f.replace(root, '.')} hardcodes an absolute home path`);
    assert.ok(!/\/private\/tmp\/claude/.test(src),
      `${f.replace(root, '.')} references a scratchpad path`);
  }
});
