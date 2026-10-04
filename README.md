# KSTE (Korean Simplified Technical Korean)

KSTE is a Korean controlled-language rule set for technical writing, modeled on ASD-STE100. It ships as a Claude Code plugin whose linter checks Korean Markdown and feeds violations back to the model. The first principle is "leave nothing for the reader to infer." The rules come from measurements of well-written Korean manuals. They also come from 709 sentence pairs corrected by National Institute of Korean Language editors. The detection numbers are modest and are reported below as measured.

---

## KSTE란 무엇입니까

KSTE는 ASD-STE100의 한국어판 작문 규칙입니다. 한국어 기술문서(매뉴얼, 개발자 문서, 기술 보고서)를 쓰는 사람과 모델을 위한 규칙 47개를 담았습니다. 이 저장소는 규칙 문서와 함께 Claude Code 린터 플러그인을 제공합니다. 플러그인은 한국어 `.md` 파일을 쓰거나 고칠 때 규칙 위반을 찾아 모델에게 돌려줍니다.

## 제1원칙

**독자가 추론할 것을 남기지 않습니다.**

짧게 쓰는 것이 목적이 아닙니다. 독자 머릿속에서 일어날 해석 작업을 글쓴이가 미리 합니다. 해석 작업은 세 가지입니다.

1. 생략된 조사와 서술어를 채웁니다.
2. 어려운 말을 쉬운 말로 풉니다.
3. 여러 뜻으로 읽히는 표현을 하나로 정합니다.

## 설치

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

Node.js 20 이상이 필요합니다. 설치만 하면 T0(정규식과 사전 검사)가 바로 돌아갑니다. 별도의 `npm install`은 필요 없습니다.

### T1 모델 설치 (선택)

T1은 Kiwi 형태소 분석으로 조사 누락, 피동, 띄어쓰기 같은 문법 규칙 16개를 더 검사합니다. 쓰려면 플러그인 디렉터리에서 다음 명령을 실행합니다.

```
npm install
node scripts/install-model.mjs
```

모델 파일 약 100MB를 `models/kiwi/`에 둡니다. 로컬 `kiwipiepy_model`이 있으면 복사하고, 없으면 PyPI에서 내려받습니다. 모델이 없으면 린터가 T0만 돌리고 리포트에 "T1 inactive"라고 표시합니다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `/kste-check [파일]` | 문서를 검사하고 리포트를 보여 줍니다. 파일은 고치지 않습니다. |
| `/kste-rewrite [파일]` | 문서를 KSTE로 다시 씁니다. 원문을 `.orig`로 남기고, 숫자·부정어·고유명사가 사라지지 않았는지 확인합니다. |
| `/kste on\|off\|80\|strict\|t1 on\|t1 off\|status` | hook 켜기와 끄기, 모드, T1 설정을 바꿉니다. |

`kste` 스킬도 함께 들어 있습니다. 한국어 기술문서를 새로 쓸 때 Claude가 이 스킬로 템플릿과 규칙을 따릅니다.

명령줄에서도 쓸 수 있습니다.

```
node bin/kste.js check 문서.md [--genre procedural|descriptive|auto] [--all] [--json] [--fail-on error|warn] [--t1 auto|on|off]
node bin/kste.js diff 원문.md 수정문.md
node bin/kste.js rules
```

## hook 동작

Claude가 한국어 `.md` 파일을 `Write`, `Edit`, `MultiEdit`로 쓰면 hook이 T0 린터를 돌립니다.

- error가 있으면 위반 목록을 모델에게 돌려주고 고치게 합니다. 수정 기회는 파일당 3회입니다. 3회가 지나도 남으면 사용자에게 알리고 넘어갑니다.
- warn만 있으면 사용자에게 한 줄로 알립니다. 모델은 멈추지 않습니다.
- 한국어 비율이 30% 미만이거나 300KB를 넘는 파일은 검사하지 않습니다.
- 상태는 프로젝트의 `.kste/` 폴더에 저장합니다.

### 모드

| 모드 | 동작 |
|---|---|
| 80% (기본) | 정밀한 규칙만 error로 올립니다. 나머지는 warn과 info로 둡니다. |
| strict | 정밀도가 높은 warn 규칙을 error로 올립니다. |

모든 경고를 error로 올리면 오탐이 늘고, 모델이 오탐을 피하려고 정보를 깎습니다. 정보 보존 실험에서 엄격한 지시는 사실을 46.8%나 잃게 했습니다. 그래서 기본값은 80% 모드입니다.

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
- hook은 T0만 돌립니다. 로딩이 느려서 매 쓰기마다 T1을 돌리기 어렵습니다. `/kste t1 on`으로 켤 수 있지만 쓰기마다 5초 이상 걸립니다.
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
