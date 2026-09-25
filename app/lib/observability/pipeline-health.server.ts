import { blindSources } from "./pipeline-health";
import {
  clearSourceBlind,
  markSourceBlind,
  readSourceLastGood,
  readSourceTicks,
} from "../data/source.server";

export interface PipelineHealthResult {
  blind: number;
  wallMs: number;
}

export async function runPipelineHealth(): Promise<PipelineHealthResult> {
  const started = Date.now();
  const [ticks, lastGood] = await Promise.all([readSourceTicks(), readSourceLastGood()]);
  const blind = blindSources(ticks, lastGood);
  await Promise.all(blind.map((entry) => markSourceBlind(entry.sourceId)));
  await clearSourceBlind(blind.map((entry) => entry.sourceId));
  return { blind: blind.length, wallMs: Date.now() - started };
}
