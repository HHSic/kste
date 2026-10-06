# KSTE 작업 인수 프롬프트 (클라우드 세션용)

아래 내용을 새 세션 첫 메시지로 그대로 붙여 넣는다.

---

## 프로젝트

KSTE(Korean Simplified Technical Korean): ASD-STE100(항공 정비 매뉴얼용 통제 영어)의 한국어판 작문 규칙과, 그 규칙을 기계 검사하는 Claude Code 플러그인·린터. Karpathy의 "LLM에 ASD-STE100으로 설명하게 하라" 팁(2026-10-02)에서 출발했다.

공개 저장소: https://github.com/HHSic/kste (현재 v1.2.2). 이 저장소에서 작업한다. 연구 자료(코퍼스 34편, 국어원 PDF, 쌍 데이터 1,520개, 분석 스크립트)는 로컬 비공개 저장소에 있어 클라우드에서는 접근 불가. 수치는 `docs/KSTE-설계안.md` §1.6·§1.7과 `docs/KSTE-규칙.md`에 전부 적혀 있으니 그걸 근거로 쓴다.

## 핵심 결정 (바꾸지 말 것)

1. **제1원칙: 독자가 추론할 것을 남기지 않는다.** 짧게 쓰는 것이 목적이 아니다. 실측에서 국어원 전문가 수정 709쌍 중 길이·태 변경은 10%, 어휘 교체 60%, 조사·서술어 복원 46%였다. 길이 제한은 경고, 문법 완결성(서술어 없는 문장, 개조식 종결, 이중피동)이 오류.
2. **실무 기준.** 잘 쓴 기술문서(LG 매뉴얼, 토스 가이드, 행안부 보안 가이드)가 쓰는 표현은 건드리지 않는다. `에 대하여`, `을 통해`, `업데이트`, `홈페이지`는 국어원이 권하지만 info로만 둔다. 공공문서 기준(B안)은 채택하지 않았다.
3. **사전 항목은 전부 `status: proposed`.** 모델은 제안만 하고 확정은 사람. 모든 항목에 `source` 필수(스키마가 강제).
4. **린터가 못 보는 것은 숨기지 않는다.** 리포트 끝에 "린터 범위 밖(사람 확인)" 블록과 "T1 미검사 규칙" 목록을 항상 낸다. ASD 측 경고("AI 글은 STE처럼 보여도 규칙을 어긴다")에 대한 답이다.
5. 서브에이전트는 `model: "sonnet"`.
6. 답변은 한국어. 코드·커밋·문서는 평문. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## 구조

- `lib/engine/` Tier 0(정규식·표면형): 전처리, 문장 분리, 어절 셈법(K7.x), 사전 매칭, 정보 보존(K8.x), 리포트. `tier0-core.js`는 Node 모듈 없이 동작(mod용), `lib/rules/bundle.js`는 YAML을 구운 것(`npm run build-mod-rules`로 재생성, 테스트가 일치 확인).
- `lib/t1/` Tier 1(Kiwi WASM 형태소 분석): 상주 워커, morph 패턴 DSL, T1 규칙 16개. 모델 110MB는 `~/.kste/t1/`에 `scripts/install-t1.mjs`로 설치(pip kiwipiepy_model 복사 → 없으면 PyPI sdist 다운로드, tar 해제 자체 구현). 로딩 5~8초, 메모리 약 1GB.
- `rules/*.yaml` + `schema/`: banned 96, refined 98(+기각 693), verbs 17, patterns 8, metrics.
- `hooks/kste-hook.mjs` PostToolUse: 한국어 `.md` 저장 시 T0 린터, error면 종료 코드 2로 모델에 피드백, 3회 상한. hook은 T0만(T1 로딩 때문).
- `hooks/kste-mod.js` mod(Claude Code 함수 hook API, `hooks.json`의 `modules`): 한국어 프롬프트일 때 시스템 프롬프트에 지시문 주입, 답변 완료 시 T0 검사해 error 있을 때만 토스트, `/kste on|off|80|strict|t1 install|status|last`. **mod 환경은 Node 모듈·npm 패키지 import 불가**(`claude plugin validate`가 막음), `$.process.run`으로 셸 실행은 가능.
- `commands/check.md`, `rewrite.md`, `set.md` → `/kste:check`, `/kste:rewrite`, `/kste:set`. `skills/kste/SKILL.md`는 `user-invocable: false`(모델 자동 호출만).
- `integrations/codex/`: Codex CLI용 AGENTS.md, 스킬, PostToolUse hook, 의존성 없는 MCP 서버(`kste_check`·`kste_diff`·`kste_rules`), `install.mjs`(`--dry-run`·`--with-hooks`·`--uninstall`).
- 테스트 531개(`npm test`, node:test). T1 모델 없으면 25개 skip. `claude plugin validate .` 통과 필수.

## 평가 수치 (국어원 전문가 수정 709쌍)

| 구성 | 탐지율 | 오탐률 |
|---|---|---|
| 사전 규칙만 | 16.4% | 3.2% |
| T0 전체 | 26.1% | 14.1% |
| T0+T1 기본 표시 | 29.9% | 16.5% |
| T0+T1 warn 이상 | 26.7% | 14.1% |

전문가 수정의 70%는 아직 못 잡는다. 못 잡는 큰 덩어리는 어휘 교체(사전에 없는 것)와 띄어쓰기.

## 검증된 것 / 안 된 것

검증됨: `claude plugin install kste@kste` GitHub 설치, hook 단독 실행(종료 코드 2·리포트), 설치본에서 T1 검사(이중피동·서술어 없음·명사 연쇄 탐지), `/kste t1 install` 실제 설치(Windows, pip 복사 경로), 수정 루프를 사람이 모델 역할로 1회 수행.

**미검증**:
- 실제 모델이 hook 피드백을 받아 지적 줄만 고치는 end-to-end(`claude -p`가 401 인증 만료로 막혔음).
- mod의 시스템 프롬프트 주입과 토스트가 실제 세션에서 뜨는지.
- `install-t1.mjs`의 PyPI sdist 다운로드 경로(pip가 없는 환경 — 클라우드가 바로 이 경우).
- Codex에서 hook·MCP가 실제로 동작하는지. `install.mjs`는 `--dry-run`만 돌렸다.

## 다음 할 일 (우선순위)

1. **end-to-end 검증.** 새 세션에서 한국어 `.md`를 쓰게 해서 hook 피드백 → 지적 줄만 수정 → 통과가 자동으로 도는지. mod 토스트·스피너 접미사 확인. 안 되면 `hooks.json`·`kste-mod.js`부터.
2. **클라우드에서 `node scripts/install-t1.mjs`** 실행해 PyPI sdist 경로 검증. 실패하면 고친다.
3. **Codex 실제 검증.** `node integrations/codex/install.mjs --with-hooks` 후 Codex에서 한국어 문서 작성, hook 피드백·MCP 도구 호출 확인.
4. **잡음 조정.** K2.1 개조식 종결이 error인데 잘 쓴 문서에서 1만 자당 2.3건(표 셀·PDF 줄바꿈). K7.4 띄어쓰기(Kiwi `space()`가 정상 복합어도 띄우라 함)와 K3.1 연결어미 수는 이미 기본 숨김. K8.3 명사 보존 임계 0.60.
5. **사전 확장.** 전문가 수정의 60%가 어휘 교체인데 refined 98개뿐. 사용자 승인 흐름(`proposed` → `approved`)을 명령으로 만들 것. 국어원 다듬은 말 18,320건은 라이선스 표기가 불명확해 전체 수입 금지, 기술문서에 통용되는 것만 출처 달아 선별.
6. 플러그인 디렉터리를 `plugin/` 하위로 분리 검토(설치 시 저장소 전체 복사됨). `rules/*.yaml`의 `source` 필드가 연구 저장소 경로를 가리키는 것은 출처 표기라 그대로 둔다.

## 하지 말 것

- 길이 임계를 오류로 올리지 말 것(실측 근거 없음).
- 사전에 출처 없는 항목을 넣지 말 것. 모델 취향을 표준으로 만들지 말 것.
- 답변 재작성(토큰 두 배) 기능을 기본으로 켜지 말 것.
- 연구 자료(코퍼스·국어원 추출 텍스트·LG 매뉴얼)를 공개 저장소에 넣지 말 것. 저작권.
- 플러그인 버전 올릴 때 `.claude-plugin/plugin.json`과 `package.json` 둘 다. 버전을 안 올리면 `claude plugin update`가 갱신하지 않는다.

---
