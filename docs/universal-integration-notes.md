# Codex·Claude Code·Cursor 범용 통합

2026-10-08, KSTE 1.3.0 개발 브랜치 기준.

## 구성

하나의 저장소에 공통 엔진과 도구별 연결 설정을 둡니다. 설치 명령이나 UI를 통일하는 대신 각 도구가 지원하는 형식으로 같은 기능을 연결합니다.

| 공통 구현 | 역할 |
|---|---|
| `lib/engine`, `lib/t1`, `rules` | T0 규칙, Kiwi 형태소 분석, 정보 보존 검사 |
| `integrations/shared/state.mjs` | on/off/default/strict, T1, 마지막 답변 리포트, Git 루트 상태 파일 |
| `integrations/shared/kste-mcp.mjs` | check/diff/rules/state MCP 4종 |
| `integrations/shared/chat-hook.mjs` | 세션 작문 지침과 T0 답변 검사 |
| `integrations/shared/session-hook.mjs` | 세션 스킬 적용과 Kiwi 준비 |
| `lib/engine/mode.js` | Node 내장 모듈 없이 Claude mod에서도 쓸 수 있는 상태 전환 함수 |

기존 Codex 상태·채팅·MCP 경로는 공통 구현을 호출하는 호환 진입점으로 유지합니다. Claude mod는 Node import를 허용하지 않으므로 호스트의 fs/store API로 동일 상태 스키마를 사용합니다. 같은 Git 루트를 프로젝트로 열어야 mod와 다른 도구가 같은 파일을 읽습니다.

## 도구별 연결

- Codex: `.agents/plugins/marketplace.json`, `.codex-plugin/plugin.json`. hook의 `PLUGIN_ROOT`와 Windows PowerShell 실행기를 사용합니다. MCP는 기존 상대 경로/cwd 방식을 유지합니다. Stop의 `last_assistant_message`를 검사하고 1회 재개합니다.
- Claude Code: `.claude-plugin`, `.mcp.json`, `hooks/hooks.json`. SessionStart/UserPromptSubmit은 공통 세션 구현을 호출합니다. 기존 PostToolUse 파일 검사와 mod의 토스트·스피너를 유지합니다. mod의 마지막 리포트도 공통 상태 파일에 저장합니다. 명시적 check/rewrite 명령은 MCP를 우선 사용해 프로젝트 설정을 따릅니다.
- Cursor: `.cursor-plugin/plugin.json`, `.cursor-plugin/marketplace.json`. Cursor 전용 규칙·hooks 경로와 공통 MCP를 명시합니다. MCP와 hook 실행 경로에는 `${CURSOR_PLUGIN_ROOT}`를 씁니다. Cursor 스킬은 Codex용 작문 사본을 재사용하며 네임스페이스 설명은 Codex에만 적용합니다.

Cursor `beforeSubmitPrompt` 출력은 `continue`·차단 시 `user_message`이며 `additional_context`가 아닙니다. 따라서 상태 명령은 스킬·MCP가 처리합니다. 세션 시작은 `additional_context`를 제공하지만 비동기여서 모델 준비 완료가 첫 응답보다 늦을 수 있습니다. Always 규칙도 현재 상태 조회와 스킬 읽기를 지시합니다.

Cursor의 afterFileEdit/afterAgentResponse는 검사 피드백 출력 필드가 없습니다. 검사 오류를 `.kste/cursor/` 아래 세션 ID의 SHA-256 이름에 저장하고 stop에서 읽습니다. 응답 본문·transcript는 저장하지 않으며 리포트만 저장합니다. generation_id가 다르면 이전 턴 결과를 사용하지 않습니다. 입력 재제출·stop·sessionEnd에서 임시 결과를 제거합니다. stop의 loop_count 및 설정 loop_limit=1로 후속 수정은 한 번으로 제한합니다. 완료되지 않은 턴과 off 상태는 재개하지 않습니다. 경고만 있는 파일은 수정 요청하지 않습니다.

## 설치와 업데이트

세 도구의 플러그인 등록 파일을 같은 저장소에 포함합니다. Cursor의 `install-cursor`는 공식 local plugin 디렉터리에 실제 파일을 복사합니다. 사용자 설정 파일이나 다른 플러그인은 수정하지 않습니다. 업데이트는 새 디렉터리에 복사한 뒤 기존 kste 복사본을 백업하고 교체하며, 교체 실패 시 복원합니다. 원본 저장소 밖의 symlink를 만들지 않습니다. 조직의 Allow Local Plugin Imports 설정이 꺼져 있으면 이 설치가 로드되지 않을 수 있습니다.

Kiwi는 사용자 `~/.kste/t1`을 공유하며 상태는 프로젝트 Git 루트에 있으므로 플러그인을 업데이트해도 유지합니다. 사용자 홈 또는 프로젝트 파일을 서로 다른 컴퓨터 사이에서 자동 동기화하지 않습니다. Git 마켓플레이스·로컬 복사본·수동 설치는 도구별로 한 방식만 사용합니다.

## 근거와 검증 범위

Cursor 공식 문서:

- [Plugins](https://cursor.com/docs/plugins): GitHub 마켓플레이스, 로컬 플러그인, Refresh·Enable Auto Refresh.
- [Plugins reference](https://cursor.com/docs/reference/plugins): Cursor manifest, 명시적 컴포넌트 경로, MCP 변수 치환, marketplace 형식.
- [Hooks](https://cursor.com/docs/hooks): 이벤트 페이로드·출력, workspace_roots, sessionStart 비동기, loop_count·loop_limit.
- [Skills](https://cursor.com/docs/skills): SKILL.md 발견과 `/` 호출. 직접 호출은 한 메시지에 붙으므로 세션 기본 적용에는 hook·Always 규칙도 사용합니다.

공통 상태의 Git 하위 폴더 공유, 명시적 off 보존, 엔진 준비 성공·실패, Cursor JSON stdin/stdout, 답변·파일 오류 수정 요청, 세션·턴 격리, 설치·재설치·제거와 설치된 복사본에서 MCP 검사를 테스트합니다. 기존 Codex·Claude 테스트도 실행합니다. Claude mod는 모의 API 테스트이며 실제 Cursor UI와 Windows 데스크톱 런타임은 이 환경에서 실행하지 않았습니다. Cursor와 Claude command hooks는 PATH의 Node.js 20 이상이 필요합니다. Codex 플랫폼 실행기 검증 범위는 기존 [Codex 조사 노트](codex-integration-notes.md)를 참조합니다.
