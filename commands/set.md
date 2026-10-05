---
description: KSTE hook 켜기/끄기, 모드(80%/strict), T1 설정. Toggle the KSTE hook, mode and T1.
argument-hint: on | off | 80 | strict | t1 on | t1 off | t1 install | status
allowed-tools: Bash(node:*)
---

KSTE hook 상태를 바꿉니다. 아래 명령을 그대로 실행하고, 출력 한 줄을 사용자에게 보여 주세요. 다른 작업은 하지 마세요.

```
node "${CLAUDE_PLUGIN_ROOT}/hooks/kste-hook.mjs" set $ARGUMENTS
```

인자가 비어 있으면 `status`로 실행합니다. `status` 출력에는 T1 설치 여부, 경로, 모델 크기가 함께 나옵니다.

**`t1 install`만 예외입니다.** 위 명령 대신 아래를 Bash로 실행하세요. kiwi-nlp 패키지와 Kiwi 모델(약 110MB)을 `~/.kste/t1/`에 내려받습니다(몇 분 걸릴 수 있어 Bash timeout을 600000ms로 지정). 진행률은 stderr에 나옵니다. 끝나면 마지막 줄만 사용자에게 보여 주세요.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-t1.mjs"
```

사용자가 `t1 install`을 직접 요청했을 때만 실행합니다(이 명령 자체가 승인입니다). 상태 파일은 프로젝트의 `.kste/state.json`입니다.

- `on` / `off`: hook 켜기 / 끄기 (끄면 hook이 즉시 통과)
- `80`: 기본 모드. 정밀한 규칙만 오류로 막습니다.
- `strict`: 엄격 모드. 규칙 문서 §10에서 엄격 시 오류인 항목(K1.5, K1.6, K2.4, K2.7, K3.3, K3.4, K4.1, K6.3, 강한 길이 경고)을 오류로 올립니다.
- `t1 install`: T1 모델과 kiwi-nlp 설치(`~/.kste/t1/`, 플러그인을 업데이트해도 유지됩니다).
- `t1 on` / `t1 off`: hook에서도 형태소 분석(T1)을 씁니다. 로딩 5~8초, 메모리 약 1GB가 들어 기본은 off입니다.
