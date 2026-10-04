import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from '../hooks/kste-mod.js';
import { loadState, setCommand } from '../hooks/kste-hook.mjs';
import { directiveOf, DIRECTIVE_MAX_CHARS } from '../lib/engine/chat.js';
import { compileRules } from '../lib/rules/compile.js';
import { loadRules } from '../lib/rules/load.js';
import bundle from '../lib/rules/bundle.js';
import { buildBundle, renderBundle } from '../scripts/build-mod-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KO_BAD = '설정이 완료되어지면 파일을 확인할 것. 이 값은 변경됩니다.';
const KO_OK = '파일을 여세요. 값을 확인하세요.';

// 가짜 mod 환경: on 이 훅을 모으고, $ 는 파일·store·토스트를 흉내 낸다.
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kste-mod-'));
  const hooks = [];
  register((event, a, b) => hooks.push(b ? { event, matcher: a, fn: b } : { event, fn: a }));
  const store = new Map();
  const toasts = [];
  const $ = {
    env: { get: async (n) => (n === 'KSTE_STATE_DIR' ? dir : undefined) },
    session: { root: async () => dir },
    fs: {
      read: async (p) => readFileSync(p, 'utf8'),
      write: async (p, t) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, t); },
    },
    store: { get: async (k) => store.get(k), set: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); } },
    clock: { now: async () => 1000 },
    command: { register: async () => {} },
    ui: { toast: (t) => toasts.push(t), log: () => {}, invalidate: () => {} },
  };
  const run = async (event, e, matcher) => {
    const h = hooks.find((x) => x.event === event && (!matcher || x.matcher?.command === matcher || x.matcher?.component === matcher));
    assert.ok(h, `hook ${event} 없음`);
    return h.fn($, e, async (x) => (event === 'prompt.compose' ? { sections: [{ id: 'intro', text: 'x', scope: 'shared' }] } : x));
  };
  const prompt = (text) => run('prompt.submit', { text });
  const compose = async () => (await run('prompt.compose', {})).sections;
  const done = (answer, extra = {}) => run('turn.complete', { answer, reason: 'answer', isAborted: false, ...extra });
  const cmd = (args) => run('command.run', { command: 'kste', args }, 'kste');
  return { dir, hooks, store, toasts, prompt, compose, done, cmd, run };
}

const hasDirective = (sections) => sections.some((s) => s.id === 'kste:directive');

test('mod: 훅 등록 목록', () => {
  const { hooks } = setup();
  assert.deepEqual(hooks.map((h) => h.event).sort(), ['command.run', 'prompt.compose', 'prompt.submit', 'session.start', 'turn.complete', 'ui.render']);
});

test('mod: 한국어 프롬프트 뒤에는 compose 에 섹션이 붙는다', async () => {
  const t = setup();
  await t.prompt('한국어로 TCP 3-way handshake를 설명해 줘');
  const sections = await t.compose();
  const s = sections.find((x) => x.id === 'kste:directive');
  assert.ok(s);
  assert.equal(s.scope, 'session');
  assert.ok(s.text.includes('제1원칙'));
  assert.equal(sections[0].id, 'intro'); // 기존 섹션은 그대로
});

test('mod: 영어 프롬프트 뒤에는 섹션이 안 붙는다', async () => {
  const t = setup();
  await t.prompt('Explain the TCP three-way handshake');
  assert.equal(hasDirective(await t.compose()), false);
  await t.prompt('한국어로 설명해 줘');
  assert.equal(hasDirective(await t.compose()), true);
  await t.prompt('Now in English please');
  assert.equal(hasDirective(await t.compose()), false);
});

test('mod: 슬래시 명령은 프롬프트 언어 기록을 바꾸지 않는다', async () => {
  const t = setup();
  await t.prompt('한국어로 설명해 줘');
  await t.prompt('/kste status');
  assert.equal(hasDirective(await t.compose()), true);
});

test('mod: off 면 섹션이 안 붙고 on 으로 돌아온다', async () => {
  const t = setup();
  await t.prompt('한국어로 설명해 줘');
  await t.cmd('off');
  assert.equal(hasDirective(await t.compose()), false);
  await t.cmd('on');
  assert.equal(hasDirective(await t.compose()), true);
});

test('mod: strict 지시문은 세미콜론 금지를 오류로 명시한다', async () => {
  const t = setup();
  await t.prompt('한국어로 설명해 줘');
  const base = (await t.compose()).find((x) => x.id === 'kste:directive').text;
  assert.ok(!base.includes('세미콜론'));
  await t.cmd('strict');
  const strict = (await t.compose()).find((x) => x.id === 'kste:directive').text;
  assert.match(strict, /세미콜론\(;\)/);
  assert.match(strict, /오류/);
  assert.match(strict, /21어절/);
});

test('지시문은 1,200자 이내이고 핵심을 담는다', () => {
  for (const mode of ['80', 'strict']) {
    const d = directiveOf(mode);
    assert.ok(d.length <= DIRECTIVE_MAX_CHARS, `${mode}: ${d.length}자`);
    for (const key of ['제1원칙', '-세요', '조건은 앞', '2개 이하', '에 대하여', '을 통해', '정보 보존']) {
      assert.ok(d.includes(key), `${mode}: ${key} 없음`);
    }
  }
});

test('mod: error 있는 답변은 토스트, 깨끗한 답변은 조용', async () => {
  const t = setup();
  await t.done(KO_OK);
  assert.deepEqual(t.toasts, []);
  await t.done(KO_BAD);
  assert.equal(t.toasts.length, 1);
  assert.match(t.toasts[0], /^KSTE: error [1-9]\d* · warn \d+$/);
});

test('mod: 하위 에이전트·중단·영어·off 답변은 검사하지 않는다', async () => {
  const t = setup();
  await t.done(KO_BAD, { agentId: 'sub1' });
  await t.done(KO_BAD, { isAborted: true, reason: 'aborted' });
  await t.done('Run the command and check the output.');
  await t.cmd('off');
  await t.done(KO_BAD);
  assert.deepEqual(t.toasts, []);
});

test('mod: 답변은 재작성하지 않고 마지막 린트 1건만 store 에 둔다', async () => {
  const t = setup();
  const r1 = await t.done(KO_BAD);
  assert.deepEqual(r1, { answer: KO_BAD, reason: 'answer', isAborted: false }); // next 결과 그대로
  await t.done(KO_OK);
  const last = t.store.get('last');
  assert.equal(last.errors, 0);
  assert.equal(t.toasts.length, 1);
});

test('mod: /kste last 는 마지막 린트 리포트 전체를 낸다', async () => {
  const t = setup();
  assert.match((await t.cmd('last')).text, /검사한 답변이 없습니다/);
  await t.done(KO_BAD);
  const out = (await t.cmd('last')).text;
  assert.match(out, /^KSTE: error [1-9]\d* · warn \d+ \(80% 모드, T0\)/);
  assert.match(out, /K\d\.\d/);
});

test('mod: /kste off 가 .kste/state.json 을 갱신하고 hook 이 그것을 읽는다', async () => {
  const t = setup();
  const file = path.join(t.dir, 'state.json');
  writeFileSync(file, JSON.stringify({ enabled: true, mode: '80', t1: false, retries: { x: { count: 2, at: 1 } } }));
  const out = await t.cmd('off');
  assert.match(out.text, /KSTE hook: off · 모드 80% · T1 off/);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.enabled, false);
  assert.deepEqual(saved.retries, { x: { count: 2, at: 1 } }); // hook 전용 필드 보존
  assert.equal(t.store.get('state').enabled, false);
  process.env.KSTE_STATE_DIR = t.dir;
  try {
    assert.equal(loadState(t.dir).enabled, false);
  } finally {
    delete process.env.KSTE_STATE_DIR;
  }
});

test('mod: hook CLI(commands/kste.md 경로)로 바꾼 상태를 mod 가 따른다', async () => {
  const t = setup();
  await t.prompt('한국어로 설명해 줘');
  process.env.KSTE_STATE_DIR = t.dir;
  try {
    setCommand(['off'], t.dir);
  } finally {
    delete process.env.KSTE_STATE_DIR;
  }
  assert.equal(hasDirective(await t.compose()), false);
  await t.cmd('t1 on');
  assert.equal(JSON.parse(readFileSync(path.join(t.dir, 'state.json'), 'utf8')).t1, true);
});

test('mod: 알 수 없는 인자는 상태를 바꾸지 않고 사용법을 낸다', async () => {
  const t = setup();
  const out = await t.cmd('bogus');
  assert.match(out.text, /알 수 없는 인자: bogus/);
  assert.equal(t.store.get('state'), undefined);
});

test('mod: 스피너 접미사는 켜져 있을 때만', async () => {
  const t = setup();
  const spin = () => t.run('ui.render', { component: 'Spinner', props: {} }, 'Spinner');
  await t.cmd('on');
  assert.equal((await spin()).props.suffix, ' · KSTE[80%]');
  await t.cmd('strict');
  assert.equal((await spin()).props.suffix, ' · KSTE[strict]');
  await t.cmd('off');
  assert.equal((await spin()).props?.suffix, undefined);
});

test('mod 의존 파일은 Node 모듈을 import 하지 않는다 (mod 환경은 상대 경로만 허용)', () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      assert.ok(m[1].startsWith('.'), `${path.relative(root, file)}: 비상대 import ${m[1]}`);
      visit(path.resolve(path.dirname(file), m[1]));
    }
  };
  visit(path.join(root, 'hooks', 'kste-mod.js'));
  assert.ok(seen.size >= 8);
});

test('규칙 번들(lib/rules/bundle.js)은 rules/*.yaml 과 같다', () => {
  assert.equal(readFileSync(path.join(root, 'lib/rules/bundle.js'), 'utf8'), renderBundle(buildBundle()),
    'rules/*.yaml 이 바뀌었습니다. npm run build-mod-rules 를 실행하세요.');
  const a = compileRules(bundle);
  const b = loadRules();
  const sig = (rs) => rs.rules.map((r) => [r.id, r.regex.source, r.regex.flags, r.severity, r.suggest, r.showByDefault]);
  assert.deepEqual(sig(a), sig(b));
  assert.deepEqual(a.metrics, b.metrics);
});

test('hooks.json 은 기존 PostToolUse hook 과 mod 를 함께 등록한다', () => {
  const j = JSON.parse(readFileSync(path.join(root, 'hooks/hooks.json'), 'utf8'));
  assert.deepEqual(j.modules, ['./kste-mod.js']);
  assert.match(j.hooks.PostToolUse[0].hooks[0].command, /kste-hook\.mjs/);
  assert.ok(readdirSync(path.join(root, 'hooks')).includes('kste-mod.js'));
});
