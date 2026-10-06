# Codex CLI 연동 조사 노트

조사일 2026-10-04. 공식 문서는 `developers.openai.com/codex/*` 에서 `learn.chatgpt.com/docs/*` 로 308 리다이렉트된다. 아래 URL은 리다이렉트 도착지다. 구버전 경로(예: `~/.codex/skills`)는 문서에서 확인되지 않았다.

## 2026-10-06: Codex 네이티브 플러그인 설치

`codex plugin marketplace add HHSic/kste`와 `codex plugin add kste@kste`로 설치하도록 `.agents/plugins/marketplace.json`과 `.codex-plugin/plugin.json`을 추가했습니다. 기존 Claude 등록 파일은 유지하고 Codex manifest에서 전용 스킬·MCP·hooks를 명시합니다. Codex 플러그인 메뉴는 `/plugins`이며 `/plugin install`은 Claude Code 명령입니다.

플러그인 설치 자체는 코드를 실행하지 않습니다. 신뢰한 첫 SessionStart hook이 Kiwi 엔진·모델을 준비하고 스킬 본문을 자동 적용합니다. 이미 준비됐다면 재사용하며 off 또는 t1 off 상태에서는 준비를 생략합니다. 준비 실패를 알리고 `/kste default` 또는 `/kste t1 on`으로 다시 시도할 수 있습니다. 채팅 답변 검사는 T0을 유지합니다. hooks는 설치만으로 신뢰되지 않으며 `/hooks` 검토·신뢰가 필요합니다.

MCP stdio 서버는 `cwd: "./"`와 상대 args로 설치된 플러그인 루트에서 실행합니다. 일반 compatibility MCP args의 `${CLAUDE_PLUGIN_ROOT}`는 이 Codex 버전에서 치환되지 않았습니다. 도구 인자 `cwd`에는 사용자 프로젝트 경로를 전달합니다. hook 명령은 공식 `PLUGIN_ROOT` 환경변수를 사용합니다. 수동 설치 hooks와 함께 쓰면 중복 검사하므로 수동 설치를 먼저 제거합니다.

Windows 데스크톱에서 `hook exited with code 1`, Node `v24.13.1`이 보고됐습니다. 원래 명령은 bare `node`에 의존했으며 시작 시 import 오류를 기록하지 못했습니다. `commandWindows`에 PowerShell 실행기를 등록하고 Node 경로 탐색, UTF-8 stdin 전달, 초기 import 오류 기록을 추가했습니다. macOS·Linux도 PATH 외의 사용자 설치 위치를 탐색합니다. `KSTE_NODE_PATH`가 우선하며 실제 실행 가능한 Node 20 이상만 선택합니다. Node 부재·실행 오류는 검사 성공으로 표시하지 않고 명시적으로 알립니다. 오류 로그는 `PLUGIN_DATA/hook-errors.log`에 기록하며 입력·문서 본문은 저장하지 않습니다. 사용자 환경의 정확한 원인은 종료 코드만으로 확정하지 않았습니다.

검증: 전체 Node 테스트 551개가 통과했습니다(T1 모델이 있는 환경). Codex CLI `0.159.0-alpha.3`의 임시 CODEX_HOME에서 로컬 marketplace 등록, `codex plugin add kste@kste`, 제거·재설치를 확인했습니다. 설치된 캐시 사본으로 로컬 가짜 Responses 엔드포인트를 호출하여 첫 요청의 Codex 스킬 본문 자동 적용, MCP `kste_check` 도구 등록, Stop 오류 답변 후 수정 답변 1회를 확인했습니다. PowerShell 7.6.6(Linux)에서 한국어 stdin·JSON stdout·Node 부재 안내를 확인했으며 Windows 데스크톱 실기 검증은 남아 있습니다. 일반 설치의 hook trust를 변경하지 않았으며 테스트에서만 검토한 hooks를 우회했습니다.

출처: [플러그인 패키징·마켓플레이스·hooks](https://developers.openai.com/plugins/build/plugins), 현재 CLI `codex plugin add --help` 및 `codex plugin marketplace add --help`.

## 2026-10-06: 채팅 답변과 상태 제어 확장

기본 설치에 SessionStart, UserPromptSubmit, Stop, PostToolUse hooks를 포함했습니다. `--no-hooks`로 설치·재설치하면 KSTE hook 블록을 제거하며 다른 hook은 유지합니다. 이전 `--with-hooks`도 지원합니다.

- 설치 명령 `npm run install-codex`(전역 설치 시 `kste install codex`)는 Kiwi 엔진·모델 준비 후 스킬·MCP·hooks를 등록합니다. 엔진 준비가 실패하면 Codex 설정을 변경하지 않습니다. `--no-t1`은 준비를 생략하며 `--dry-run`은 다운로드나 파일 변경 없이 계획만 보여 줍니다.
- SessionStart/UserPromptSubmit: 현재 on/off, default/strict, t1 설정과 한국어 답변 지침을 `hookSpecificOutput.additionalContext`로 전달합니다. SessionStart는 on 상태일 때 스킬 본문 전체도 전달하여 명시적 호출 없이 세션에 적용합니다. off에서 on/default로 바꾸는 명령도 본문을 전달합니다. 정확한 상태 명령만 별도로 처리하고, 문장 속 예시나 `$kste README.md`는 설정 변경으로 보지 않습니다.
- Stop: 공식 `last_assistant_message`를 T0으로 검사합니다. 오류가 있으면 `decision: "block"`, `reason`으로 수정 답변을 한 번 요청합니다. `stop_hook_active`이면 다시 재개하지 않습니다. 기존 답변을 바꾸는 후처리 API가 아니라 수정 답변을 추가하는 턴 재개입니다. transcript 파싱에는 의존하지 않습니다.
- MCP `kste_state`와 CLI `kste set`: on/off/default/strict/t1 on/off/status/last를 지원합니다. 80/80%는 default의 별칭이며 공유 상태 파일의 mode 값은 80으로 유지합니다. `t1 status`와 `status`는 Kiwi 엔진·모델의 실제 설치 여부도 보여 줍니다. Git 루트 `.kste/state.json`을 공유하고 Git 밖에서는 cwd를 씁니다. KSTE_STATE_DIR 우선입니다. Codex 상태 경로는 Claude 전용 환경변수를 사용하지 않습니다.
- `kste` 스킬에 상태 제어 절을 추가했습니다. 데스크톱의 활성 스킬은 슬래시 메뉴에 표시되므로 표시되는 환경에서는 `/kste off`로 호출합니다. CLI 등 메뉴에 없을 때는 `$kste off`, `/prompts:kste off`를 사용합니다. 임의의 네이티브 슬래시 명령을 별도 API로 등록하지는 않습니다.
- `off`는 자동 작문 지침과 파일·채팅 검사를 끕니다. 명시적 MCP 검사는 계속 동작합니다. MCP 검사는 프로젝트 strict/T1 설정을 읽으며 t1 인자를 주면 그 값이 우선합니다. 채팅 Stop 검사는 T0입니다.
- 기본값은 KSTE on, default 모드, T1 on입니다. default(80/80% 별칭 포함) 명령은 꺼 둔 KSTE와 T1을 함께 켭니다. 별도로 저장한 t1 off는 유지하며, default를 다시 실행하면 on으로 바뀝니다. 모드 전환은 엔진·모델 다운로드와 별개입니다.

출처: [hooks 공식 문서](https://learn.chatgpt.com/docs/hooks), [데스크톱 슬래시 명령과 스킬 메뉴](https://learn.chatgpt.com/docs/reference/slash-commands), [스킬 호출](https://learn.chatgpt.com/docs/build-skills), [deprecated 프롬프트](https://learn.chatgpt.com/docs/custom-prompts). 자동 검사는 hook trust가 필요하고, 스크립트가 실제 실행 환경에 있어야 합니다. 설치기는 신뢰 설정이나 `features.hooks = false`를 강제로 바꾸지 않습니다.

검증: 전체 Node 테스트 543개가 통과했습니다(T1 모델이 있는 환경). Codex CLI `0.159.0-alpha.3`를 임시 설정·프로젝트와 로컬 가짜 Responses 엔드포인트로 실행하여 일반 프롬프트의 첫 요청에 스킬 본문이 전달되는 동작, 저장된 off 상태에서 본문·자동 검사 생략(요청 1회), `/kste default`가 꺼 둔 KSTE·T1을 함께 켜는 동작, 기본 오류 답변→수정 답변(2회), `/kste off` 상태 저장과 검사 중단(1회), strict 경고 승격→수정 답변(2회), 수정 후 오류가 남아도 추가 재개 없음(2회)을 확인했습니다. 설치 설정은 `--strict-config`로 로딩했습니다. 실제 설치 명령도 임시 홈에서 기존 Kiwi 엔진·모델 재사용과 스킬·MCP·4종 hooks 등록을 확인했습니다. 검증 환경에서만 작성한 hooks의 trust를 우회했으며, 일반 설치는 `/hooks` 검토·신뢰를 사용합니다. 실제 모델이 수정 지시를 따르는 품질과 데스크톱 스킬 메뉴 표시는 별도 확인 대상입니다.

## 확장 지점별 확인 결과

| 항목 | 지원 | 확인한 내용 | 출처 |
|---|---|---|---|
| AGENTS.md | 지원 | 전역 `~/.codex/AGENTS.override.md` 먼저, 없으면 `~/.codex/AGENTS.md`. 프로젝트는 Git 루트에서 현재 디렉터리까지 내려오며 각 단계에서 `AGENTS.override.md`, `AGENTS.md`, 대체 파일명 순으로 찾는다. 루트에서 아래로 이어 붙이고 가까운 파일이 우선한다. 기본 한도 `project_doc_max_bytes` = 32 KiB. 빈 파일은 건너뛴다. `CODEX_HOME`으로 전역 위치를 바꾼다. 대체 파일명은 `project_doc_fallback_filenames`. | https://learn.chatgpt.com/docs/agent-configuration/agents-md |
| Agent Skills | 지원 | 저장소 `.agents/skills`(현재 디렉터리에서 저장소 루트까지), 사용자 `$HOME/.agents/skills`, 관리자 `/etc/codex/skills`, 내장. `SKILL.md` frontmatter는 `name`, `description`. agentskills.io 표준 기반. 호출은 `$`(CLI), `/skills` 또는 description 기반 암묵 호출. 끄기는 `config.toml`의 `[[skills.config]] path=... enabled=false`. | https://learn.chatgpt.com/docs/build-skills |
| hooks | 지원 | 기본 켜짐(`[features] hooks = false`로 끔). 위치: `~/.codex/hooks.json` 또는 `config.toml`의 `[hooks]`, 프로젝트 `.codex/hooks.json`·`.codex/config.toml`, 플러그인, 관리자 `requirements.toml`. 이벤트: PreToolUse, PostToolUse, PermissionRequest, PreCompact, PostCompact, UserPromptSubmit, SubagentStart, SubagentStop, Stop, SessionStart, SessionEnd, Interrupt. matcher는 정규식(도구 이름). stdin에 JSON, 종료 코드 0 성공, 2 차단(stderr). 비관리 hook은 실행 전 trust 검토가 필요하다. | https://learn.chatgpt.com/docs/hooks |
| MCP | 지원 | `~/.codex/config.toml` 또는 프로젝트 `.codex/config.toml`의 `[mcp_servers.<name>]`. stdio 필드: `command`(필수), `args`, `env`, `startup_timeout_sec`(기본 10), `tool_timeout_sec`(기본 60), `enabled_tools`. CLI: `codex mcp add <name> --env K=V -- <command>`. | https://learn.chatgpt.com/docs/extend/mcp?surface=cli |
| 커스텀 프롬프트 | 지원하나 deprecated | `~/.codex/prompts/*.md`, frontmatter `description`, `argument-hint`. `/prompts:<name>`으로 호출. 인자 `$1`..`$9`, `$ARGUMENTS`, 이름 있는 `$FILE`(호출 시 `FILE=값`). 저장소로 공유되지 않는다. 문서는 skills 사용을 권한다. | https://learn.chatgpt.com/docs/custom-prompts |
| apply_patch hook 페이로드 | 2차 출처 | 파일 수정 도구 이름은 `apply_patch`. PostToolUse의 `tool_input.command`에 패치 본문이 들어 있다(`*** Add File:`, `*** Update File:`, `*** Move to:` 헤더). matcher에 `apply_patch`를 쓴다. 공식 문서에서 직접 확인하지 못했고 서드파티 저장소의 이슈·PR 본문을 근거로 했다. 실제 Codex로 검증하지 않았다. | https://github.com/termaxa/termaxa/pull/104 , https://github.com/Chemaclass/agnostic-ai/issues/1450 |
| `notify` 설정 | 이번에 조사 안 함 | 턴 종료 알림용이며 hooks의 `Stop`으로 대체되므로 쓰지 않았다. | - |

`developers.openai.com/codex` 와 `github.com/openai/codex` 의 `docs/skills.md`는 위 문서로 안내만 한다.

## 만든 것과 매핑

| 파일 | 용도 |
|---|---|
| `.agents/plugins/marketplace.json` | Codex 마켓플레이스 카탈로그 |
| `.codex-plugin/plugin.json` | Codex 전용 스킬·MCP·hooks manifest |
| `integrations/codex/hooks/hooks.json` | 플러그인에 포함한 4종 hooks |
| `integrations/codex/hooks/kste-plugin-hook.mjs` | 신뢰한 세션에서 Kiwi 준비와 스킬 자동 적용 |
| `integrations/codex/hooks/kste-launch.sh`, `kste-launch.ps1` | 플랫폼별 Node 탐색과 hook 입력 전달 |
| `integrations/codex/hooks/kste-run-hook.mjs` | hook 실행과 초기 로딩 오류 기록 |
| `integrations/codex/AGENTS.md` | KSTE 지시문(1,500자 이내). `kste:begin/end` 마커 포함. |
| `integrations/codex/skills/kste/` | `skills/kste` 복사본. 린터 안내 한 줄만 hook 대신 `npx kste check`로 바꿨다. 동기화는 `test/codex.test.js`가 검사한다. |
| `integrations/codex/mcp/kste-mcp.mjs` | stdio MCP 서버. 도구 `kste_check`, `kste_diff`, `kste_rules`, `kste_state`. |
| `integrations/codex/hooks/kste-codex-hook.mjs` | PostToolUse(apply_patch) hook. 패치에서 `.md` 경로를 뽑아 기존 `hooks/kste-hook.mjs`의 `handle`을 재사용한다. |
| `integrations/codex/prompts/kste-check.md` | `/prompts:kste-check FILE=...` (deprecated 기능이라 선택 사항) |
| `integrations/codex/install.mjs` | 엔진·모델 준비와 설치·제거 스크립트(기본 hooks 포함) |
| `integrations/codex/state.mjs` | Codex 프로젝트 루트와 공유 상태 관리 |
| `integrations/codex/hooks/kste-chat-hook.mjs` | 설정 주입·상태 명령 처리·Stop 답변 검사 |
| `integrations/codex/prompts/kste.md` | `/prompts:kste` 상태 제어 대안 |

## config.toml 등록 예시

MCP 서버 (경로는 설치 위치에 맞게 바꾼다. `install.mjs`가 절대 경로로 써 준다):

```toml
[mcp_servers.kste]
command = "node"
args = ["/path/to/kste/integrations/codex/mcp/kste-mcp.mjs"]
startup_timeout_sec = 20
tool_timeout_sec = 60
```

hook (선택. 첫 실행 때 trust 검토 필요):

```toml
[[hooks.PostToolUse]]
matcher = "apply_patch"

[[hooks.PostToolUse.hooks]]
type = "command"
command = "node /path/to/kste/integrations/codex/hooks/kste-codex-hook.mjs"
timeout = 20
```

## 2026-10-04 조사 당시 미구현·차이

아래는 최초 조사 기록입니다. 상태 전환과 채팅 적용은 위 2026-10-06 확장으로 구현했습니다.

- 플러그인 마켓플레이스 설치: Codex 쪽 플러그인 manifest는 이번에 조사·구현하지 않았다. 대신 `install.mjs`로 파일을 배치한다.
- `/kste on|off|80|strict` 상태 전환 명령: 만들지 않았다. Codex 슬래시 명령은 deprecated된 prompts뿐이고, 상태 전환은 `.kste/state.json`을 직접 고쳐야 한다(hook이 같은 상태 파일을 읽는다).
- `kste-mod.js`(Claude Code 답변 후처리 mod) 대응물: Codex에 해당 확장 지점을 확인하지 못해 만들지 않았다.
- hook이 모델에게 피드백을 돌려주는 방식(종료 코드 2 + stderr)이 Codex에서 PostToolUse에 동작하는지 문서로 확인했지만(종료 코드 2 = 차단 결정, stderr), 실제 Codex 실행으로는 검증하지 못했다.
- 기본 T1(형태소) 검사는 MCP·hook 모두 꺼져 있다. 켜려면 모델 설치(`npm install`, `node scripts/install-t1.mjs`) 후 MCP 인자 `t1`을 쓴다.
