---
description: 한국어 문서를 KSTE 린터로 검사한다
argument-hint: FILE=<파일>
---

`$FILE` 파일에 KSTE 린터를 돌립니다. 인자가 없으면 이 대화에서 가장 최근에 쓴 한국어 `.md` 파일을 대상으로 합니다.

1. `npx kste check "$FILE"` 을 실행합니다.
2. 리포트를 줄이지 말고 그대로 보여 줍니다.
3. 파일은 고치지 않습니다. 사용자가 요청하면 error 로 지적된 줄만 고칩니다.
