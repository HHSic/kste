---
description: 한국어 문서를 KSTE 린터(T0+T1)로 검사하고 리포트를 보여 줍니다. Lint a Korean document with KSTE.
argument-hint: "[파일]"
allowed-tools: Bash(node:*), Read
---

KSTE 린터로 `$ARGUMENTS` 파일을 검사합니다. 인자가 없으면 이 대화에서 가장 최근에 쓰거나 고친 한국어 `.md` 파일을 대상으로 하고, 대상을 정할 수 없으면 사용자에게 파일 경로를 물어보세요.

1. 아래 명령을 실행합니다. T1(형태소 분석) 모델이 있으면 자동으로 켜집니다(첫 실행에 5~8초). 모델이 없으면 T0만 돌고 리포트에 "T1 inactive"가 나옵니다.

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/kste.js" check "<파일>" --t1 auto
   ```

2. 리포트를 줄이거나 바꾸지 말고 그대로 보여 줍니다. 마지막의 "린터 범위 밖 (사람 확인)" 블록도 포함합니다.
3. 숨김 항목까지 보려면 사용자가 요청할 때만 `--all`을 붙입니다.
4. 파일을 고치지 않습니다. 고치려면 `/kste-rewrite`를 쓰도록 한 줄로 안내합니다.
