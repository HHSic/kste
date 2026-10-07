# KSTE (Korean Simplified Technical Korean)

KSTE is a Korean controlled-language rule set for technical writing, modeled on ASD-STE100. It ships as plugins for Codex, Claude Code, and Cursor, sharing one linter, Kiwi morphology engine, and project settings. The first principle is "leave nothing for the reader to infer." The rules come from measurements of well-written Korean manuals. They also come from 709 sentence pairs corrected by National Institute of Korean Language editors. The detection numbers are modest and are reported below as measured.

---

## KSTE란 무엇입니까

KSTE는 ASD-STE100의 한국어판 작문 규칙입니다. 한국어 기술문서(매뉴얼, 개발자 문서, 기술 보고서)를 쓰는 사람과 모델을 위한 규칙 47개를 담았습니다. 이 저장소는 규칙 문서와 함께 Codex·Claude Code·Cursor용 작문 스킬과 린터 플러그인을 제공합니다. 플러그인은 한국어 `.md` 파일을 쓰거나 고칠 때 규칙 위반을 찾아 모델에게 돌려줍니다.

## 제1원칙

**독자가 추론할 것을 남기지 않습니다.**

짧게 쓰는 것이 목적이 아닙니다. 독자 머릿속에서 일어날 해석 작업을 글쓴이가 미리 합니다. 해석 작업은 세 가지입니다.

1. 생략된 조사와 서술어를 채웁니다.
2. 어려운 말을 쉬운 말로 풉니다.
3. 여러 뜻으로 읽히는 표현을 하나로 정합니다.

## 설치

같은 저장소를 세 도구에서 사용합니다. Node.js 20 이상이 필요하며 Claude Code·Cursor에서는 `node`가 PATH에 있어야 합니다. 기본은 **on / default / T1 on**입니다. 새 세션 hook이 스킬을 자동 적용하고 Kiwi 엔진·모델이 없으면 준비합니다. 저장된 off 또는 t1 off는 유지합니다. 도구마다 hook 허용·신뢰 설정을 적용한 뒤 새 세션을 시작합니다.

현재 범용 구현은 [PR #1](https://github.com/HHSic/kste/pull/1)의 `codex/kste-codex-plugin` 브랜치에 있습니다. main 병합 전에는 다음처럼 체크아웃한 뒤 로컬 플러그인으로 설치합니다.

```bash
git clone --branch codex/kste-codex-plugin https://github.com/HHSic/kste.git
cd kste
# 필요한 도구를 선택합니다.
claude plugin marketplace add .
claude plugin install kste@kste
codex plugin marketplace add .
codex plugin add kste@kste
npm run install-cursor
```

Cursor는 다시 시작하거나 `Developer: Reload Window`를 실행한 뒤 Customize에서 kste를 확인합니다. 이미 마켓플레이스 kste를 설치했다면 그 설치가 local 복사본보다 우선하므로 한 방식으로 사용합니다. 조직에서 Local Plugin Imports를 허용해야 로컬 설치가 발견됩니다.

### Claude Code 플러그인

Claude Code에서 마켓플레이스를 추가하고 플러그인을 설치합니다.

```
/plugin marketplace add HHSic/kste
/plugin install kste@kste
```

터미널에서는 다음 명령을 씁니다.

```
claude plugin marketplace add HHSic/kste
claude plugin install kste@kste
```

Node.js 20 이상이 필요합니다. T0의 YAML 의존성을 포함하므로 별도의 `npm install`은 필요 없습니다. 세션 hook은 mod API가 없는 버전에서도 작문 스킬을 자동 적용합니다.

### Kiwi 형태소 엔진(T1)

T1은 Kiwi 형태소 분석으로 조사 누락, 피동, 띄어쓰기 같은 문법 규칙 16개를 더 검사합니다. 기본 설정에서는 신뢰·허용한 첫 세션 hook이 준비합니다. 수동 준비도 가능합니다.

```
/kste t1 install
```

기본 다운로드는 약 110MB이며 이미 설치된 엔진·모델을 재사용합니다. t1 off이면 다운로드하지 않습니다. 준비 실패를 알리고 채팅 T0 검사는 계속합니다.

- 받는 것: `kiwi-nlp` 패키지와 Kiwi 모델, 합쳐서 약 110MB입니다. 진행률은 stderr에 나옵니다.
- 저장 위치: `~/.kste/t1/`입니다(Windows는 `%USERPROFILE%\.kste\t1\`). 플러그인 폴더는 업데이트 때 통째로 바뀌므로 버전과 무관한 사용자 폴더에 둡니다. 업데이트해도 다시 받지 않습니다. `KSTE_T1_DIR` 환경변수로 위치를 바꿀 수 있습니다.
- 탐색 순서: `KSTE_T1_DIR`, `~/.kste/t1/`, 플러그인 로컬 `models/kiwi/` 순입니다.
- 설치 여부 확인: `/kste status` 또는 `node scripts/install-t1.mjs --check`(JSON)입니다.
- 터미널에서 직접: `node <플러그인경로>/scripts/install-t1.mjs`입니다. `npm`이 없어도 npm 레지스트리에서 직접 받습니다. 로컬 `kiwipiepy_model`이 있으면 모델을 복사하고, 없으면 PyPI에서 내려받습니다.
- T1이 없으면 린터가 T0만 돌리고 리포트에 "T1 inactive"라고 표시합니다. `--t1 on`을 강제하면 안내 메시지와 함께 종료 코드 2로 끝납니다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `/kste:check [파일]` | 문서를 검사하고 리포트를 보여 줍니다. 파일은 고치지 않습니다. |
| `/kste:rewrite [파일]` | 문서를 KSTE로 다시 씁니다. 원문을 `.orig`로 남기고, 숫자·부정어·고유명사가 사라지지 않았는지 확인합니다. |
| `/kste on\|off\|default\|strict\|t1 install\|t1 on\|t1 off\|status` | hook 켜기와 끄기, 모드, T1 설치·설정을 바꿉니다. mod가 없는 Claude Code에서는 `/kste:set …`을 씁니다. |
| `/kste last` | 마지막 한국어 답변의 T0 검사 리포트를 보여 줍니다. 도구별 호출 형태는 아래 표를 참조하세요. |

`kste` 스킬도 함께 들어 있습니다. 한국어 기술문서를 새로 쓸 때 Claude가 이 스킬로 템플릿과 규칙을 따릅니다.

명령줄에서도 쓸 수 있습니다.

```
node bin/kste.js check 문서.md [--genre procedural|descriptive|auto] [--all] [--json] [--fail-on error|warn] [--t1 auto|on|off]
node bin/kste.js diff 원문.md 수정문.md
node bin/kste.js rules
```

## hook 동작

Claude가 한국어 `.md` 파일을 `Write`, `Edit`, `MultiEdit`로 쓰면 hook이 설정에 따라 T0 또는 T0+T1 린터를 돌립니다.

- error가 있으면 위반 목록을 모델에게 돌려주고 고치게 합니다. 수정 기회는 파일당 3회입니다. 3회가 지나도 남으면 사용자에게 알리고 넘어갑니다.
- warn만 있으면 사용자에게 한 줄로 알립니다. 모델은 멈추지 않습니다.
- 한국어 비율이 20% 미만이거나 300 KiB를 넘는 파일은 검사하지 않습니다.
- 상태는 프로젝트의 `.kste/` 폴더에 저장합니다.

### 모드

| 모드 | 동작 |
|---|---|
| default (기존 80%) | 정밀한 규칙만 error로 올립니다. 나머지는 warn과 info로 둡니다. |
| strict | 정밀도가 높은 warn 규칙을 error로 올립니다. |

모든 경고를 error로 올리면 오탐이 늘고, 모델이 오탐을 피하려고 정보를 깎습니다. 정보 보존 실험에서 엄격한 지시는 사실을 46.8%나 잃게 했습니다. 그래서 기본값은 default 모드(기존 80% 규칙)입니다. default 명령은 KSTE와 T1을 함께 켭니다.

## 채팅 답변 적용

파일을 저장할 때만이 아니라 채팅 답변에도 KSTE를 적용합니다. Claude Code의 mod(`hooks/kste-mod.js`)가 다음 순서로 동작합니다.

1. 프롬프트를 보낼 때 한글 비율(코드와 URL 제외, 한글 대 한글+라틴 글자)이 20% 이상이면 한국어 프롬프트로 기록합니다. 영어 프롬프트에는 아무것도 넣지 않습니다.
2. 한국어 프롬프트이고 KSTE가 켜져 있으면, 시스템 프롬프트에 KSTE 지시문 섹션(`kste:directive`)을 넣습니다. 지시문은 `skills/kste/SKILL.md`를 1,200자 안쪽으로 줄인 것입니다. strict 모드에서는 길이 한도와 세미콜론 금지를 오류로 적습니다.
3. 답변이 끝나면 한국어 답변만 T0 린터로 검사합니다. error가 있을 때만 `KSTE: error N · warn M` 한 줄을 토스트로 보여 줍니다. error가 없으면 아무것도 보여 주지 않습니다. 자세한 내용은 `/kste last`로 봅니다.
4. 답변이 나오는 동안 스피너에 ` · KSTE[default]`를 붙입니다. 켜져 있을 때만 붙습니다.

답변을 다시 쓰지는 않습니다. 다시 쓰면 토큰이 두 배로 들기 때문입니다. 검사에는 T1을 쓰지 않습니다(로딩이 느립니다). 모델이 지시문을 따르는지는 검사 토스트로 확인합니다.

`/kste on|off|80|strict|t1`은 hook과 같은 상태 파일(`.kste/state.json`)을 씁니다. 어느 쪽에서 바꿔도 양쪽에 적용됩니다. mod는 상태를 Claude Code의 store에도 저장합니다.

**최소 버전.** mod 기능은 Claude Code 2.1.286에서 확인했습니다(함수 hook API, `hooks/hooks.json`의 `modules`). 이 API는 초기 공개 단계라 버전에 따라 바뀔 수 있습니다. 그보다 오래된 버전(2.1.175에서 확인)은 `modules`를 무시하므로 플러그인이 깨지지 않습니다. 이때도 세션 hook으로 작문 스킬을 자동 적용하고 파일 저장 hook·MCP·`/kste:set`을 사용할 수 있습니다. 답변 토스트·스피너·검사 리포트는 mod API가 있어야 동작합니다. 규칙 YAML을 고치면 mod가 읽는 `lib/rules/bundle.js`를 `npm run build-mod-rules`로 다시 만듭니다(테스트가 두 파일이 같은지 확인합니다).

## Codex에서 쓰기

### 플러그인 설치

Codex의 터미널 명령으로 현재 개발 브랜치 마켓플레이스를 등록하고 플러그인을 설치합니다.

```bash
codex plugin marketplace add HHSic/kste --ref codex/kste-codex-plugin
codex plugin add kste@kste
```

로컬 수정본을 설치하려면 KSTE 저장소 폴더에서 `codex plugin marketplace add .`를 실행한 뒤 `codex plugin add kste@kste`를 실행합니다. `codex plugin` 명령이 없는 버전은 Codex를 업데이트하거나 아래 수동 설치를 사용합니다. Codex 안의 플러그인 메뉴는 `/plugins`입니다. Claude Code의 `/plugin install` 명령과 다릅니다.

설치 후 새 세션을 시작합니다. Hook 검토·신뢰는 Codex CLI를 실행한 뒤 `/hooks`에서 합니다. 데스크톱에 `/hooks`가 있다고 가정하지 않습니다. 신뢰한 첫 세션에서 Kiwi 엔진·모델이 없으면 자동으로 준비합니다. 이후 새 세션마다 kste 스킬을 자동 적용합니다. 저장된 off 또는 t1 off 설정은 유지합니다. 엔진 준비가 실패하면 실패를 알리고 채팅 T0 검사는 계속합니다. `/kste default`로 준비를 다시 시도할 수 있습니다.

Windows hook은 PowerShell 실행기를 사용합니다. Node.js 20 이상을 PATH와 표준 설치 위치에서 찾고, 한국어 stdin을 UTF-8로 전달합니다. macOS·Linux는 PATH 외에 Homebrew·nvm·fnm·Volta 설치 위치도 탐색합니다. 사용자 지정 실행 파일은 `KSTE_NODE_PATH`로 지정합니다. Node.js를 찾지 못하면 KSTE가 실행되지 않았다는 안내를 표시합니다. 초기 모듈 로딩 오류는 플러그인 데이터 폴더의 `hook-errors.log`에 기록하며 안내에 로그 경로를 표시합니다. hook 정의를 변경하면 CLI의 `/hooks`에서 다시 검토·신뢰합니다.

플러그인에는 Codex 전용 스킬·MCP·4종 hooks를 포함합니다. MCP 호출의 `cwd`에는 현재 프로젝트 경로를 줍니다. 플러그인 방식과 수동 설치는 하나를 선택합니다. 수동 hooks를 이미 설치했다면 `npm run install-codex -- --uninstall`로 제거한 뒤 플러그인을 설치하여 같은 답변을 두 번 검사하지 않도록 합니다.

### 수동 설치

`integrations/codex/`의 설치 스크립트가 Codex 확장 지점(AGENTS.md, Agent Skills, MCP, hooks)에 파일을 배치하고 Kiwi 엔진·모델을 준비합니다. **설치 후 새 세션마다 kste 스킬을 자동 적용하며, 한국어 답변도 자동 검사합니다.** 기본 설정은 on, default 모드, T1 on입니다. `/kste default`는 KSTE와 Kiwi(T1)를 함께 켭니다. default는 기존 80% 규칙이며 `80` 명령도 같은 동작의 별칭으로 지원합니다. Node.js 20 이상이 필요합니다. 조사 근거와 지원 범위는 [docs/codex-integration-notes.md](docs/codex-integration-notes.md)에 있습니다.

다음 명령으로 설치합니다. 기존 Kiwi 엔진·모델은 다시 받지 않습니다. 설치 전에 `config.toml`과 `AGENTS.md`는 백업됩니다.

```
git clone https://github.com/HHSic/kste
cd kste
npm install
npm run install-codex
```

설치 후 Codex를 다시 시작하고 CLI의 `/hooks`에서 KSTE hooks를 검토·신뢰합니다. 데스크톱의 명령 메뉴에는 `/hooks`가 없을 수 있습니다. 이후 SessionStart hook이 스킬 본문을 전달하므로 새 세션에서 `/kste`를 따로 호출할 필요가 없습니다. 신뢰 전에는 자동 적용 hook이 실행되지 않습니다. MCP와 hook은 설치 폴더의 절대 경로를 참조하므로 폴더를 유지합니다. Codex 데스크톱에서는 같은 실행 환경에 스크립트와 Node.js가 있어야 합니다. 이 설치가 다른 컴퓨터나 클라우드 환경까지 자동으로 배포하지는 않습니다.

설치 계획 확인과 선택 옵션은 다음과 같습니다. `node integrations/codex/install.mjs`도 같은 설치 명령이며, 로컬 소스를 `npm i -g .`로 설치했다면 `kste install codex`를 쓸 수 있습니다.

```bash
npm run install-codex -- --dry-run
npm run install-codex -- --no-hooks # 자동 검사 없이 설치(기존 KSTE hooks도 제거)
npm run install-codex -- --no-t1    # Kiwi 엔진·모델 준비 생략
npm run install-codex -- --uninstall
```

`--with-hooks`는 이전 설치 명령과의 호환을 위해 계속 지원합니다. `--no-t1`로 설치한 경우 형태소 검사를 쓰려면 나중에 엔진·모델을 준비하거나 `/kste t1 off`로 설정을 끕니다.

데스크톱 입력창에서 `/`를 입력하고 활성화된 `kste` 스킬을 선택한 뒤 `on`, `off`, `default`, `strict`, `status`, `last` 같은 인자를 붙여 보냅니다. 플러그인 스킬의 등록 이름은 `kste:kste`이므로 `/kste:kste on` 또는 `$kste:kste on` 형태로 호출될 수 있습니다. 수동 설치는 `/kste on` 또는 `$kste on`을 씁니다. `/kste on` 전체를 별도 네이티브 명령으로 등록하거나 on/off 인자를 메뉴에서 자동완성하는 API는 확인하지 못했습니다. 스킬의 `agents/openai.yaml`에 표시 이름 `kste`·설명과 기본 호출을 지정했습니다. 상태 명령은 hook이 없어도 스킬이 MCP `kste_state`로 처리할 수 있습니다. CLI용 대체 슬래시 호출은 `/prompts:kste off`입니다(prompts는 deprecated). 상태 명령은 문서를 고치지 않고 설정 결과만 알립니다.

설정은 프로젝트 Git 루트의 `.kste/state.json`에 저장됩니다. Git 저장소 밖에서는 현재 작업 디렉터리를 기준으로 하며 `KSTE_STATE_DIR`로 바꿀 수 있습니다. 스킬, MCP, 파일 hook, 채팅 hook이 같은 설정을 읽습니다. `off`는 KSTE 자동 작문 지침과 파일·답변 검사를 끕니다. 사용자가 명시적으로 요청한 MCP 검사는 off에서도 실행됩니다.

답변 검사에는 Codex의 `Stop.last_assistant_message` 필드를 씁니다. T0 오류가 있으면 Codex에 수정 답변을 **한 번** 요청합니다. 원래 답변을 덮어쓰는 API가 아니라 턴을 재개해 수정 답변을 추가하는 방식입니다. 수정 후에도 오류가 남으면 알리고 재개를 반복하지 않습니다. `/kste last`로 마지막 한국어 답변 검사 결과를 봅니다. Stop에서 답변이 없거나 답변이 300 KiB를 넘으면 자동 검사를 건너뜁니다. T1 설정은 파일·MCP 검사에 적용되고, 채팅 답변 검사는 빠른 T0을 사용합니다.

기본 설치 명령이 T1 엔진·모델도 준비합니다. `--no-t1`로 생략했다면 다음 명령으로 준비할 수 있습니다. 새 프로젝트는 T1 on으로 시작하며, 기존 프로젝트에서 꺼 두었다면 `/kste default`로 함께 켭니다. 설정을 켜는 명령은 엔진·모델을 다운로드하지 않습니다.

```bash
node scripts/install-t1.mjs
node scripts/install-t1.mjs --check
```

형태소 분석 엔진은 Kiwi(`kiwi-nlp` + Kiwi 모델)입니다. Codex에서 `/kste default` 또는 `/kste t1 on`으로 켜고, `/kste t1 off`로 끕니다. 명시적으로 끈 설정은 유지하며 default를 다시 실행하면 T1을 켭니다. `/kste t1 status`는 설정 on/off와 엔진·모델의 실제 설치 여부를 함께 보여 줍니다. 메뉴에 없으면 `$kste t1 on`처럼 호출합니다. `npm i -g .` 또는 `npm i -g kste`를 했다면 터미널에서도 `kste set off`, `kste set default`, `kste set strict`, `kste set t1 on`, `kste set t1 status`, `kste set status`로 같은 설정을 제어하고 `kste check 문서.md`로 직접 검사할 수 있습니다.

### Windows에서 `hook exited with code 1`만 보일 때

통계 화면의 종료 코드만으로는 실행 명령·실패 지점을 알 수 없습니다. 1.3.1은 Windows PowerShell의 legacy 인자 전달에서 Node 검사 코드의 따옴표가 제거되는 문제를 수정했습니다. UTF-8 입력을 Node 프로세스에 직접 쓰고 stdout/stderr를 분리해 읽어, 파일 검사 피드백의 종료 코드 2를 PowerShell 오류로 바꾸지 않습니다.

실행기 시작 단계와 예기치 않은 Node 종료는 `KSTE did not run` 안내와 단계별 로그를 남깁니다. 로그는 `PLUGIN_DATA/hook-errors.log`를 사용하며, 실행기에서 해당 환경변수가 없으면 `%LOCALAPPDATA%\KSTE\hook-errors.log`를 사용합니다. 입력·답변 본문·문서 검사 지적은 실행기 로그에 저장하지 않습니다.

수정 브랜치로 등록한 마켓플레이스에서 `codex plugin marketplace upgrade kste` 후 `codex plugin list`로 1.3.1을 확인하고 Codex를 완전히 종료한 뒤 새 채팅을 시작합니다. main을 추적하면 아직 이 수정본이 없습니다. 기존 Git 등록 소스의 ref를 바꾸려면 다음 순서로 마켓플레이스 등록만 교체합니다. 플러그인 활성화 설정·프로젝트 상태·Kiwi 모델은 유지합니다.

```cmd
codex plugin marketplace remove kste
codex plugin marketplace add HHSic/kste --ref codex/kste-codex-plugin
codex plugin marketplace upgrade kste
codex plugin list
```

1.3.1에서도 종료 코드만 보이면 다음 읽기 전용 진단을 CMD에서 실행합니다. PowerShell 버전·설치 캐시 경로·추적 ref를 표시하고, 합성 status 프롬프트로 실행기를 직접 호출합니다. 대화 본문을 읽거나 설정을 바꾸지 않으며 Kiwi 다운로드도 실행하지 않습니다.

```cmd
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.codex\plugins\cache\kste\kste\1.3.1\scripts\diagnose-codex.ps1"
```

`CODEX_HOME`을 별도로 지정했다면 위 스크립트 파일 경로도 해당 홈에 맞춥니다. 진단이 선택한 캐시가 앱에서 실제 사용 중인 버전인지는 앱 재시작과 `codex plugin list` 결과를 함께 확인합니다. 이 변경은 PowerShell 7의 legacy 인자 전달 모드로 검증했으며 Windows PowerShell 5.1 실기 확인은 남아 있습니다.

## Cursor에서 쓰기

`.cursor-plugin/plugin.json`과 `.cursor-plugin/marketplace.json`을 제공합니다. Customize의 **From GitHub Repository**로 저장소의 마켓플레이스를 가져와 kste를 설치할 수 있습니다. 범용 구현이 main에 병합되기 전에는 위 로컬 설치를 사용합니다. 공식 마켓플레이스에 게시하는 작업은 별도입니다.

로컬 설치는 `npm run install-cursor` 또는 `kste install cursor`이며 `~/.cursor/plugins/local/kste`에 소스와 의존성을 복사합니다. `--dry-run`, `--home <경로>`, `--uninstall`을 지원합니다. Windows는 사용자 홈의 `.cursor\plugins\local\kste`를 사용합니다. 설치는 원본 저장소를 가리키는 symlink를 만들지 않습니다.

새 세션 hook과 Always 규칙이 스킬을 적용합니다. `/` 메뉴의 kste를 선택한 뒤 `on`, `off`, `default`, `strict`, `status`, `last` 또는 `t1 on/off/status`를 붙입니다. 상태 명령은 스킬이 MCP `kste_state`로 실행합니다. Cursor의 `beforeSubmitPrompt`는 추가 컨텍스트 출력을 지원하지 않으므로 이 hook에서 설정 결과를 주입하지 않습니다.

`afterFileEdit`가 한국어 Markdown을, `afterAgentResponse`가 한국어 답변을 검사합니다. 이 이벤트는 모델 피드백 출력 필드가 없으므로 오류를 세션·턴별로 모아 `stop.followup_message`로 수정 요청을 한 번 보냅니다. clean/off/중단·오류 턴에서는 재개하지 않습니다. 원래 답변을 덮어쓰는 방식은 아닙니다. Cursor `sessionStart`는 비동기이므로 첫 응답 시점에 T1 준비가 끝나지 않을 수 있습니다. 엔진 상태는 `t1 status`로 확인합니다. 파일 경고만 있으면 자동 수정하지 않으며 자세한 리포트는 MCP 검사로 확인합니다.

## 공통 설정과 업데이트

같은 Git 작업 트리에서 세 도구의 설정은 Git 루트 `.kste/state.json`을 공유합니다. 한 도구에서 off로 바꾸면 다른 도구도 다음 턴·검사에서 off를 읽습니다. Git 저장소 밖에서는 프로젝트 작업 디렉터리를 사용하며 `KSTE_STATE_DIR`로 지정할 수 있습니다. Claude mod는 호스트가 전달하는 프로젝트 루트를 기준으로 하므로 같은 Git 루트를 열어 사용합니다. 서로 다른 체크아웃이나 원격 컴퓨터는 상태 파일을 자동 동기화하지 않습니다.

| 기능 | Codex | Claude Code | Cursor |
|---|---|---|---|
| 스킬·규칙·Kiwi | 공통 엔진 | 공통 엔진 | 공통 엔진 |
| 세션 자동 적용 | SessionStart hook | SessionStart hook, mod 지시문 | sessionStart hook + Always 규칙 |
| 상태 제어 | `/kste:kste default`, 수동 설치 `$kste default` | `/kste default`, 구버전 `/kste:set default` | `/kste default` 스킬 + MCP |
| 파일 자동 검사 | PostToolUse `apply_patch` | PostToolUse `Write/Edit/MultiEdit` | afterFileEdit → stop 피드백 |
| 답변 검사 | Stop, 수정 요청 1회 | mod, 오류 토스트·last | afterAgentResponse → stop, 수정 요청 1회 |
| 명시적 검사 | MCP 4종 | MCP 4종·기존 check/rewrite 명령 | MCP 4종 |
| 사용 중 표시 | 스킬 메뉴·hook 안내 | mod 스피너 `KSTE` | Customize의 스킬·Always 규칙 |

세 도구의 UI·명령 목록은 다릅니다. `/kste on` 전체를 하나의 네이티브 메뉴 명령으로 등록하거나 인자별 자동완성까지 보장하지는 않습니다.

설치 방식을 유지하며 업데이트할 수 있습니다.

```bash
# Git 마켓플레이스로 설치한 Codex: 카탈로그와 설치된 캐시 갱신
codex plugin marketplace upgrade kste
# Claude Code: 마켓플레이스 갱신 후 플러그인 갱신
claude plugin marketplace update kste
claude plugin update kste@kste
# Cursor 로컬 설치: 원본 저장소 갱신 후 복사본 교체(기존 복사본 백업)
git pull --ff-only
npm run install-cursor
```

Cursor GitHub/팀 마켓플레이스는 Refresh 또는 Enable Auto Refresh로 추적 브랜치를 갱신합니다. 업데이트 후 새 세션을 시작하고 필요하면 앱을 재시작합니다. Kiwi 엔진·모델과 프로젝트 상태는 플러그인 캐시 밖에 있으므로 유지됩니다. 로컬 경로로 등록한 Codex·Claude 마켓플레이스는 먼저 해당 저장소에서 `git pull --ff-only`를 실행합니다.

지원 규격·확인 범위는 [범용 통합 노트](docs/universal-integration-notes.md)에 기록했습니다.

## 실무 기준

린터는 실무 기준을 따릅니다. 잘 쓴 기술문서(사용자 매뉴얼, 기술 보고서, 개발자 문서, 약 91.8만 자)가 실제로 쓰는 표현은 건드리지 않습니다. 국립국어원이 권하지만 실무가 따르지 않는 항목은 info로만 둡니다.

error와 warn으로 잡는 것은 틀린 것입니다. 이중피동, 서술어 없는 문장, 조사 누락, 확정형 번역투, 중복 표현이 여기에 속합니다. 길이, 피동 비율, 연결어미 수는 좋은 글과 나쁜 글을 가르지 못해서 경고나 정보로 둡니다.

규칙은 모두 47개입니다. error 7개, warn 22개, info 18개입니다. 전체 규칙은 [`docs/KSTE-규칙.md`](docs/KSTE-규칙.md)에, 설계 근거는 [`docs/KSTE-설계안.md`](docs/KSTE-설계안.md)에 있습니다.

## 평가 수치

국립국어원 자료 5종에서 "수정 전, 수정 후" 문장·구 709쌍을 뽑아 린터를 돌렸습니다.

- 탐지율은 수정 전 문장에서 finding이 1개 이상 나온 쌍의 비율입니다.
- 오탐률은 수정 후 문장에서 finding이 1개 이상 나온 쌍의 비율입니다.

| 조건 | 탐지율 | 오탐률 |
|---|---|---|
| T0만, 기본 표시 | 26.1% | 14.1% |
| T0+T1, 기본 표시 | 29.9% | 16.5% |
| T0+T1, warn 이상만 | 26.7% | 14.1% |
| T0+T1, `--all` (숨김 규칙 포함) | 55.1% | 30.0% |
| 사전 규칙만, 기본 표시 | 16.4% | 3.2% |

읽는 법입니다.

- 전문가가 고친 쌍의 70% 이상을 린터가 놓칩니다. 어휘 교체와 문법 완결이 수정의 대부분인데, 사전에 없는 어휘와 문맥 판단은 기계가 잡지 못합니다.
- 기본 표시에서 수정 후 문장의 16.5%에도 finding이 나옵니다. 전문가가 고친 문장이 모두 통과하지는 않습니다.
- T1을 켜도 기본 표시 탐지율은 3.8%p 오릅니다. T1의 효과는 `--all`에서 크지만 오탐도 함께 늘어납니다.
- 사전 규칙만 쓰면 오탐이 3.2%로 낮습니다. 대신 대부분의 쌍을 놓칩니다.
- 이 수치는 문장·구 단위 평가입니다. 문서 전체를 쓰는 실사용 결과가 아닙니다.

## 제한

- T1은 메모리를 많이 씁니다. 모델 로딩 직후 약 850MB, 피크 약 1GB입니다. 로딩에 5~8초가 걸립니다.
- 파일 hook은 기본 T1 on이면 형태소 엔진을 사용합니다. 쓰기마다 로딩 시간이 들며 `/kste t1 off`로 빠른 T0만 사용할 수 있습니다. 채팅 답변 검사는 T0입니다.
- end-to-end 검증을 하지 않았습니다. 린터 단위 평가는 했지만, "이 플러그인을 쓰면 모델이 쓴 문서가 실제로 좋아진다"는 것은 아직 확인하지 못했습니다.
- 린터가 못 잡는 규칙이 있습니다. 용어 변이형 통일, 지시어 대상, 주어 복원, 단락 주제 같은 것은 사람이 확인합니다. 리포트 끝에 이 목록이 항상 나옵니다.
- 규칙 사전의 일부 `source` 필드가 연구 자료 경로를 가리킵니다. 연구 자료(코퍼스, 측정 스크립트, 평가 결과)는 별도 비공개 저장소에 있고, 이 저장소에는 없습니다.

## 기여

사전 항목 제안은 풀 리퀘스트로 받습니다. 규칙 파일은 `rules/` 폴더에 있습니다.

1. 항목마다 `source` 필드가 필수입니다. 국립국어원 자료나 공개 문헌의 출처를 쪽 번호까지 적습니다. 출처가 없는 항목은 받지 않습니다.
2. 실무에서 쓰이는 표현을 error로 올리지 않습니다. 근거 없이 등급을 높이는 제안은 받지 않습니다.
3. 변경하면 `npm test`를 통과해야 합니다. `docs/KSTE-규칙.md`를 고치면 `skills/kste/references/rules.md`에도 같은 내용을 복사합니다. 두 파일이 같은지 테스트가 확인합니다.

버그와 오탐은 이슈로 알려 주십시오. 오탐은 문장 원문과 나온 규칙 ID를 함께 적습니다.

## 라이선스

- 코드는 MIT 라이선스입니다. 저작자는 HHSic(2026)입니다. [`LICENSE`](LICENSE)를 봅니다.
- `docs/`의 문서와 `rules/`의 규칙은 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ko)입니다. 출처를 밝히면 자유롭게 쓸 수 있습니다.
- 사전 항목의 출처는 국립국어원 공공저작물(공공누리)이며, 각 항목의 `source` 필드에 표기했습니다.
- T1이 쓰는 kiwi-nlp는 Apache-2.0입니다. 자세한 내용은 [`THIRD_PARTY.md`](THIRD_PARTY.md)에 있습니다.
