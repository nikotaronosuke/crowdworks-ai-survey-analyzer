/**
 * analysis.json 出力。
 * AnalysisResult をそのまま人が読める形の JSON にする（加工しない）。
 */

import type { AnalysisResult } from '../types.ts';

/**
 * 集計結果を整形済み JSON 文字列にする。
 * 差分が読みやすいようインデント 2 で固定する。
 */
export function toAnalysisJson(a: AnalysisResult): string {
  return JSON.stringify(a, null, 2);
}
