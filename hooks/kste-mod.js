// KSTE Claude Code mod: 채팅 답변에도 KSTE를 적용한다.
//  - prompt.compose: 한국어 프롬프트 뒤에 KSTE 지시문을 시스템 프롬프트 섹션으로 넣는다.
//  - turn.complete: 답변을 T0 린터로 검사해 error가 있을 때만 토스트로 알린다. 답변을 재작성하지 않는다.
//  - /kste on|off|80|strict|t1|status|last: commands/set.md 와 같은 상태 파일(.kste/state.json)을 쓴다.
// mod 환경은 Node 모듈을 못 쓴다(상대 경로 import 와 "claude-code"만 허용). 파일은 $.fs, 환경변수는 $.env 로 읽는다.
import { koreanRatio, applyStateArgs, statusLine, t1StatusLine, MIN_KO_RATIO } from '../lib/engine/mode.js';
import { directiveOf, lintAnswer, reportOf, toastOf } from '../lib/engine/chat.js';

const DEFAULT_STATE = { enabled: true, mode: '80', t1: false };

const pick = (s) => ({
  enabled: s?.enabled !== false,
  mode: s?.mode === 'strict' ? 'strict' : '80',
  t1: s?.t1 === true,
});

let current = { ...DEFAULT_STATE };
let isKoreanPrompt = false;

// hook(kste-hook.mjs)과 같은 위치: KSTE_STATE_DIR > CLAUDE_PROJECT_DIR > 프로젝트 루트
async function statePath($) {
  const override = await $.env.get('KSTE_STATE_DIR');
  const project = await $.env.get('CLAUDE_PROJECT_DIR');
  const dir = override || `${project || (await $.session.root())}/.kste`;
  const trimmed = dir.replace(/[\\/]+$/, '');
  return `${trimmed}/state.json`;
}

async function readFile($) {
  try {
    return JSON.parse(await $.fs.read(await statePath($)));
  } catch {
    return null;
  }
}

// 상태 파일이 기준이다(hook·commands/set.md 가 거기에 쓴다). 없으면 store, 그것도 없으면 기본값.
async function refresh($) {
  const file = await readFile($);
  if (file) current = pick(file);
  else {
    const saved = await $.store.get('state');
    current = saved && typeof saved === 'object' ? pick(saved) : { ...DEFAULT_STATE };
  }
  return current;
}

// store 에 쓰고, 상태 파일에도 쓴다. 파일의 retries 같은 hook 전용 필드는 그대로 둔다.
async function save($, state) {
  current = pick(state);
  await $.store.set('state', current);
  const existing = (await readFile($)) ?? {};
  await $.fs.write(await statePath($), JSON.stringify({ ...existing, ...current }, null, 2) + '\n');
}

// 셸 API: $.process.run(argv, { timeoutMs })가 있다(CLI 전용, 셸 없이 argv 로 실행, 최대 10분). 없거나 실패하면 null.
async function runInstallScript($, args, timeoutMs) {
  try {
    const script = `${$.plugin.root}/scripts/install-t1.mjs`;
    const r = await $.process.run(['node', script, ...args], { timeoutMs });
    return { script, ...r };
  } catch {
    return null;
  }
}

async function t1Status($) {
  const r = await runInstallScript($, ['--check'], 15000);
  if (!r) return '';
  try {
    return '\n' + t1StatusLine(JSON.parse(r.stdout));
  } catch {
    return '';
  }
}

async function t1Install($) {
  let pluginRoot = '<플러그인경로>';
  try { pluginRoot = $.plugin.root ?? pluginRoot; } catch { /* mod 밖에서는 안내 경로를 쓴다. */ }
  const hint = `다음 명령을 실행하세요: node "${pluginRoot}/scripts/install-t1.mjs"`;
  $.ui.toast('T1 설치 시작: 모델 약 110MB, 몇 분 걸릴 수 있다');
  const r = await runInstallScript($, [], 600000);
  if (!r) return `T1 설치를 mod 에서 실행하지 못했다. ${hint}`;
  const tail = (r.stderr || '').trim().split(/\r?\n/).slice(-6).join('\n');
  return r.exitCode === 0 ? `T1 설치 완료.\n${tail}` : `T1 설치 실패(종료 코드 ${r.exitCode}).\n${tail}\n${hint}`;
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'kste',
        description: 'KSTE 켜기/끄기, 모드(80%/strict), T1 설정, 마지막 답변 검사 결과',
        argumentHint: 'on | off | 80 | strict | t1 on | t1 off | t1 install | status | last',
      });
      await refresh($);
    } catch (err) {
      $.ui.log(`KSTE mod 초기화 알림: ${err?.message ?? err}`);
    }
    return next(e);
  });

  on('prompt.submit', async ($, e, next) => {
    // 슬래시 명령은 사용자의 언어를 말해 주지 않는다
    if (!e.text.trim().startsWith('/')) isKoreanPrompt = koreanRatio(e.text) >= MIN_KO_RATIO;
    await refresh($);
    return next(e);
  });

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e);
    const state = await refresh($);
    if (!state.enabled || !isKoreanPrompt) return composed;
    return {
      ...composed,
      sections: [...composed.sections, { id: 'kste:directive', scope: 'session', text: directiveOf(state.mode) }],
    };
  });

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && !e.isAborted && e.reason === 'answer' && e.answer.trim()) {
      const state = await refresh($);
      if (state.enabled) {
        const result = lintAnswer(e.answer, state.mode, await $.clock.now());
        if (result) {
          await $.store.set('last', result);
          if (result.errors > 0) $.ui.toast(toastOf(result));
        }
      }
    }
    return next(e);
  });

  on('command.run', { command: 'kste' }, async ($, e) => {
    const args = (e.args || '').trim().split(/\s+/).filter(Boolean);
    if ((args[0] || '').toLowerCase() === 'last') {
      return { text: reportOf((await $.store.get('last')) ?? null) };
    }
    const r = applyStateArgs(await refresh($), args);
    if (!r.ok) return { text: r.error };
    if (r.action === 't1-install') return { text: await t1Install($) };
    if (r.changed) {
      await save($, r.state);
      $.ui.invalidate('ui.render');
    }
    const status = !args.length || (args[0] || '').toLowerCase() === 'status';
    return { text: statusLine(r.state, await statePath($)) + (status ? await t1Status($) : '') };
  });

  // 스피너 접미사: 켜져 있을 때만
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!current.enabled) return next(e);
    const suffix = ` · KSTE[${current.mode === 'strict' ? 'strict' : '80%'}]`;
    return next({ ...e, props: { ...e.props, suffix: (e.props?.suffix ?? '') + suffix } });
  });
}
