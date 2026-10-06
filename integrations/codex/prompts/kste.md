---
description: KSTE 켜기·끄기, default·strict 모드, Kiwi(T1), 상태, 마지막 답변 검사 결과
argument-hint: on | off | default | strict | t1 on | t1 off | t1 status | status | last
---

KSTE 상태 명령을 실행합니다. 인자는 다음과 같습니다:

$ARGUMENTS

MCP `kste_state`를 호출하세요. 인자를 공백으로 나눈 문자열 배열을 `args`에 넣고, 현재 프로젝트 작업 디렉터리를 `cwd`에 넣습니다. 인자가 없으면 `args: []`로 상태를 조회합니다. default는 KSTE와 Kiwi(T1)를 함께 켭니다. 셸 명령에 사용자 인자를 그대로 넣지 마세요. 도구의 결과만 간단히 알려 주세요. 그 외 문서 수정은 하지 않습니다.
