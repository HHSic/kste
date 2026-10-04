# Codex CLI 연동 조사 노트

조사일 2026-10-04. 공식 문서는 `developers.openai.com/codex/*` 에서 `learn.chatgpt.com/docs/*` 로 308 리다이렉트된다. 아래 URL은 리다이렉트 도착지다. 구버전 경로(예: `~/.codex/skills`)는 문서에서 확인되지 않았다.

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
| `integrations/codex/AGENTS.md` | KSTE 지시문(1,500자 이내). `kste:begin/end` 마커 포함. |
| `integrations/codex/skills/kste/` | `skills/kste` 복사본. 린터 안내 한 줄만 hook 대신 `npx kste check`로 바꿨다. 동기화는 `test/codex.test.js`가 검사한다. |
| `integrations/codex/mcp/kste-mcp.mjs` | 의존성 없는 stdio MCP 서버. 도구 `kste_check`, `kste_diff`, `kste_rules`. |
| `integrations/codex/hooks/kste-codex-hook.mjs` | PostToolUse(apply_patch) hook. 패치에서 `.md` 경로를 뽑아 기존 `hooks/kste-hook.mjs`의 `handle`을 재사용한다. |
| `integrations/codex/prompts/kste-check.md` | `/prompts:kste-check FILE=...` (deprecated 기능이라 선택 사항) |
| `integrations/codex/install.mjs` | 설치·제거 스크립트 |

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

## 불가·차이

- 플러그인 마켓플레이스 설치: Codex 쪽 플러그인 manifest는 이번에 조사·구현하지 않았다. 대신 `install.mjs`로 파일을 배치한다.
- `/kste on|off|80|strict` 상태 전환 명령: 만들지 않았다. Codex 슬래시 명령은 deprecated된 prompts뿐이고, 상태 전환은 `.kste/state.json`을 직접 고쳐야 한다(hook이 같은 상태 파일을 읽는다).
- `kste-mod.js`(Claude Code 답변 후처리 mod) 대응물: Codex에 해당 확장 지점을 확인하지 못해 만들지 않았다.
- hook이 모델에게 피드백을 돌려주는 방식(종료 코드 2 + stderr)이 Codex에서 PostToolUse에 동작하는지 문서로 확인했지만(종료 코드 2 = 차단 결정, stderr), 실제 Codex 실행으로는 검증하지 못했다.
- 기본 T1(형태소) 검사는 MCP·hook 모두 꺼져 있다. 켜려면 모델 설치(`npm install`, `node scripts/install-t1.mjs`) 후 MCP 인자 `t1`을 쓴다.
