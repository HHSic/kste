// Tier 0 검사: 정규식·표면형만 쓴다 (형태소 분석 없음). 본체는 tier0-core.js, 여기서는 YAML 규칙 로더를 연결한다.
import { loadRules } from '../rules/load.js';
import { setRulesetProvider } from './tier0-core.js';

setRulesetProvider(() => loadRules());

export * from './tier0-core.js';
