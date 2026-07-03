const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeDiff } = require('../out-test/diffEngine.cjs');

test('classifies modified, added, and context rows with correct numbering', () => {
  const left = 'a\nb\nc\n';
  const right = 'a\nB\nc\nd\n';
  const { rows, added, removed } = computeDiff(left, right);

  assert.equal(added, 2);
  assert.equal(removed, 1);
  assert.deepEqual(
    rows.map((r) => r.t),
    ['ctx', 'mod', 'ctx', 'add']
  );
  assert.equal(rows[1].ln, 2);
  assert.equal(rows[1].rn, 2);
  assert.equal(rows[3].rn, 4);
  assert.equal(rows[3].r, 'd');
});

test('pure deletions produce del rows', () => {
  const { rows, added, removed } = computeDiff('a\nb\nc\n', 'a\nc\n');
  assert.equal(added, 0);
  assert.equal(removed, 1);
  assert.deepEqual(
    rows.map((r) => r.t),
    ['ctx', 'del', 'ctx']
  );
  assert.equal(rows[1].l, 'b');
});

test('word-level ranges cover only the changed characters', () => {
  const { rows } = computeDiff('const y = 2;\n', 'const y = 20;\n');
  assert.equal(rows[0].t, 'mod');
  assert.deepEqual(rows[0].lh, [[10, 11]]);
  assert.deepEqual(rows[0].rh, [[10, 12]]);
});

test('completely different lines get no word ranges (whole-line change)', () => {
  const { rows } = computeDiff('alpha beta gamma\n', 'one two three four\n');
  assert.equal(rows[0].t, 'mod');
  assert.deepEqual(rows[0].lh, []);
  assert.deepEqual(rows[0].rh, []);
});

test('ignoreWhitespace treats indent-only changes as context', () => {
  const left = 'function f() {\nreturn 1;\n}\n';
  const right = 'function f() {\n    return 1;\n}\n';

  const strict = computeDiff(left, right);
  assert.ok(strict.added > 0, 'strict mode should report a change');

  const relaxed = computeDiff(left, right, { ignoreWhitespace: true });
  assert.equal(relaxed.added, 0);
  assert.equal(relaxed.removed, 0);
  assert.deepEqual(
    relaxed.rows.map((r) => r.t),
    ['ctx', 'ctx', 'ctx']
  );
  // the whitespace-differing ctx row keeps each side's real text
  assert.equal(relaxed.rows[1].l, 'return 1;');
  assert.equal(relaxed.rows[1].r, '    return 1;');
});

test('detects moved blocks and tags both sides with the same group', () => {
  const block = 'function helper() {\n  return compute(1, 2);\n}\n';
  const anchor = 'line1\nline2\nline3\nline4\n';
  const left = `${block}${anchor}`;
  const right = `${anchor}${block}`;
  const { rows } = computeDiff(left, right);

  const movedDel = rows.filter((r) => r.t === 'del' && r.mv !== undefined);
  const movedAdd = rows.filter((r) => r.t === 'add' && r.mv !== undefined);
  assert.equal(movedDel.length, 3);
  assert.equal(movedAdd.length, 3);
  assert.equal(movedDel[0].mv, movedAdd[0].mv);
  assert.equal(movedDel[0].l, 'function helper() {');
  assert.equal(movedAdd[0].r, 'function helper() {');
});

test('does not tag trivial single lines as moves', () => {
  const { rows } = computeDiff('}\nx\n', 'x\n}\n');
  for (const row of rows) {
    assert.equal(row.mv, undefined);
  }
});

test('normalizes CRLF line endings', () => {
  const { rows, added, removed } = computeDiff('a\r\nb\r\n', 'a\nb\n');
  assert.equal(added, 0);
  assert.equal(removed, 0);
  assert.deepEqual(
    rows.map((r) => r.t),
    ['ctx', 'ctx']
  );
});

test('handles empty left side (all additions)', () => {
  const { rows, added, removed } = computeDiff('', 'a\nb\n');
  assert.equal(added, 2);
  assert.equal(removed, 0);
  assert.deepEqual(
    rows.map((r) => r.t),
    ['add', 'add']
  );
});

test('handles identical files', () => {
  const { rows, added, removed } = computeDiff('a\nb\n', 'a\nb\n');
  assert.equal(added, 0);
  assert.equal(removed, 0);
  assert.equal(rows.every((r) => r.t === 'ctx'), true);
});
