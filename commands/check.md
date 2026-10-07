---
description: 한국어 문서를 KSTE 린터(T0+T1)로 검사하고 리포트를 보여 줍니다. Lint a Korean document with KSTE.
argument-hint: "[파일]"
---

KSTE 린터로 `$ARGUMENTS` 파일을 검사합니다. 인자가 없으면 이 대화에서 가장 최근에 쓰거나 고친 한국어 `.md` 파일을 대상으로 하고, 대상을 정할 수 없으면 사용자에게 파일 경로를 물어보세요.

1. MCP `kste_check`에 `path`(파일 경로)와 `cwd`(현재 프로젝트 경로)를 전달합니다. `t1`은 생략해 프로젝트 설정을 따르고 strict 설정도 적용합니다. 자동 검사 off에서도 이 명시적 검사 요청은 수행합니다. 첫 세션 hook이 기본 T1 엔진·모델을 준비하며, 설치 실패를 성공으로 보고하지 않습니다.

   MCP가 없는 환경에서는 `node "${CLAUDE_PLUGIN_ROOT}/hooks/kste-hook.mjs" set status`로 T1 설정을 조회한 뒤 아래 명령의 `<on|off>`에 조회한 값을 넣습니다. T1 on이고 엔진이 없으면 `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-t1.mjs"`로 준비합니다. t1 off 설정은 유지합니다.

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/kste.js" check "<파일>" --t1 <on|off>
   ```

2. 리포트를 줄이거나 바꾸지 말고 그대로 보여 줍니다. 마지막의 "린터 범위 밖 (사람 확인)" 블록도 포함합니다.
3. 숨김 항목까지 보려면 사용자가 요청할 때만 `--all`을 붙입니다.
4. 파일을 고치지 않습니다. 고치려면 `/kste:rewrite`를 쓰도록 한 줄로 안내합니다.
