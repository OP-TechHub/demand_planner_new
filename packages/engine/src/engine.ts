// Top-level orchestrator: one call runs the whole pipeline. Pure and
// deterministic — the app adapts DB rows into EngineInput, calls runEngine,
// and persists the result.
import type { EngineInput } from './types';
import { rankPrograms, type RankedProgram } from './rank';
import { ownMonthAllocation, type OwnMonthResult } from './allocate';
import { rollingCalc, type RollingResult } from './rolling';
import { aggregate, type AggregateResult } from './aggregate';

export interface EngineResult {
  ranked: RankedProgram[];
  own: OwnMonthResult;
  rolling: RollingResult;
  aggregate: AggregateResult;
}

export function runEngine(input: EngineInput): EngineResult {
  const ranked = rankPrograms(input);
  const own = ownMonthAllocation(input, ranked);
  const rolling = rollingCalc(input, ranked, own);
  const agg = aggregate(input, ranked, own, rolling);
  return { ranked, own, rolling, aggregate: agg };
}
