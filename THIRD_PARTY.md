# 제3자 구성 요소

## kiwi-nlp (Apache-2.0)

T1(형태소 분석)은 [kiwi-nlp](https://www.npmjs.com/package/kiwi-nlp) 0.24.x를 선택 의존성으로 씁니다. kiwi-nlp는 Apache License 2.0입니다. 이 저장소에는 kiwi-nlp 코드를 넣지 않았습니다. `npm install`이 내려받습니다.

Kiwi 모델 파일(`models/kiwi/`)도 저장소에 없습니다. `node scripts/install-model.mjs`가 PyPI의 `kiwipiepy-model` 배포본에서 가져옵니다. 모델은 해당 배포본의 라이선스를 따릅니다.

## yaml (ISC)

`node_modules/yaml/`에 [yaml](https://github.com/eemeli/yaml) 2.9.1을 그대로 넣었습니다. 플러그인을 설치할 때 `npm install` 없이 hook과 린터가 돌게 하려는 조치입니다. 라이선스 전문은 `node_modules/yaml/LICENSE`에 있습니다.

## 국립국어원 자료

`rules/` 사전 항목의 출처는 국립국어원 공공저작물(공공누리)입니다. 항목마다 `source` 필드에 출처를 적었습니다.
