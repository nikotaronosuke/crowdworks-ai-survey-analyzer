/**
 * クロス集計モジュール。
 * 行質問 × 列質問の同時該当人数を数える。
 * 選択肢のラベル化は aggregate.ts の respondentOptions を再利用し、
 * numeric のときだけこちらでビン（階級）ラベルに変換する。
 */

import type {
  CrossTabMode,
  CrossTabResult,
  Dataset,
  QuestionDef,
  ResponseRow,
} from '../types.ts';
import { cellValue, orderLabelEntries, respondentOptions } from './aggregate.ts';
import { isBlank, normalizeKey } from './text.ts';
import { makeBins, parseJapaneseNumber } from './numeric.ts';

/** makeBins が返すビン1つ分の型（numeric のラベル化に使う） */
type Bin = ReturnType<typeof makeBins>[number];

/** ラベルの集計エントリ。key は normalizeKey 済みの照合キー */
interface LabelEntry {
  key: string;
  label: string;
  count: number;
}

/** クロス集計の対象にできない質問種別か */
function isUnsupportedKind(q: QuestionDef): boolean {
  return q.kind === 'free' || q.kind === 'ignore';
}

/**
 * 数値がどのビンに入るかを判定してラベルを返す。
 * - 離散ビン（値そのものがビン: from===to）は完全一致で探す
 * - 範囲ビンは半開区間 [from, to)、最終ビンのみ閉区間 [from, to]
 * - 丸め誤差などで範囲外になった値は端のビンに寄せる
 */
function binLabelOf(value: number, bins: Bin[]): string | null {
  if (bins.length === 0) return null;

  if (bins.every((b) => b.from === b.to)) {
    const hit = bins.find((b) => b.from === value);
    return hit ? hit.label : null;
  }

  for (let i = 0; i < bins.length; i += 1) {
    const bin = bins[i];
    const isLast = i === bins.length - 1;
    if (value >= bin.from && (value < bin.to || (isLast && value <= bin.to))) {
      return bin.label;
    }
  }

  const first = bins[0];
  const last = bins[bins.length - 1];
  if (value < first.from) return first.label;
  if (value > last.to) return last.label;
  return null;
}

/** included 行から numeric 質問の数値を集めてビン境界を作る */
function buildBins(rows: ResponseRow[], q: QuestionDef): Bin[] {
  if (q.kind !== 'numeric') return [];
  const values: number[] = [];
  for (const row of rows) {
    const cell = cellValue(row, q);
    if (isBlank(cell)) continue;
    const value = parseJapaneseNumber(cell, q.unit);
    if (value !== null) values.push(value);
  }
  return makeBins(values, q.unit);
}

/**
 * 1回答者のクロス集計用ラベル一覧。
 * numeric はビンのラベル（値が取れなければ該当なし）、
 * それ以外は respondentOptions の結果をそのまま使う。
 */
function labelsOf(row: ResponseRow, q: QuestionDef, bins: Bin[]): string[] {
  if (q.kind === 'numeric') {
    const cell = cellValue(row, q);
    if (isBlank(cell)) return [];
    const value = parseJapaneseNumber(cell, q.unit);
    if (value === null) return [];
    const label = binLabelOf(value, bins);
    return label === null ? [] : [label];
  }
  return respondentOptions(row, q);
}

/** 対象回答者ごとのラベル一覧から、ラベル別の実人数を数える */
function countLabels(perRespondent: string[][]): LabelEntry[] {
  const map = new Map<string, LabelEntry>();
  for (const labels of perRespondent) {
    const seen = new Set<string>();
    for (const label of labels) {
      const key = normalizeKey(label);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = map.get(key);
      if (entry) entry.count += 1;
      else map.set(key, { key, label, count: 1 });
    }
  }
  return [...map.values()];
}

/** ラベル一覧を、表示順の index 一覧（重複除去済み）に変換する */
function indicesOf(labels: string[], index: Map<string, number>): number[] {
  const result = new Set<number>();
  for (const label of labels) {
    const i = index.get(normalizeKey(label));
    if (i !== undefined) result.add(i);
  }
  return [...result];
}

/**
 * 行質問 × 列質問のクロス集計。
 * - 対象は included かつ行・列の両方に有効回答がある回答者
 * - counts[r][c] は行ラベル r と列ラベル c の両方に該当した回答者数
 *   （複数回答は1人が複数セルに現れるため、行内合計と rowTotals は一致しないことがある）
 * - ラベルは実際に出現したもののみ。並び順は aggregateQuestion と同じ規則
 * - 質問が見つからない / free / ignore のときは例外を投げず空の結果を返す
 */
export function crossTabulate(
  ds: Dataset,
  rowKey: string,
  colKey: string,
  mode: CrossTabMode,
): CrossTabResult {
  const rowQ = ds.questions.find((q) => q.key === rowKey);
  const colQ = ds.questions.find((q) => q.key === colKey);

  const result: CrossTabResult = {
    rowKey,
    colKey,
    rowQuestion: rowQ?.label ?? '',
    colQuestion: colQ?.label ?? '',
    rowMultiple: rowQ?.kind === 'multiple',
    colMultiple: colQ?.kind === 'multiple',
    rowLabels: [],
    colLabels: [],
    counts: [],
    rowTotals: [],
    colTotals: [],
    grandTotal: 0,
    mode,
  };

  if (!rowQ || !colQ) return result;
  if (isUnsupportedKind(rowQ) || isUnsupportedKind(colQ)) return result;

  const included = ds.rows.filter((r) => r.included);
  const rowBins = buildBins(included, rowQ);
  const colBins = buildBins(included, colQ);

  // 行・列の両方に有効回答がある回答者だけを対象にする
  const targets: { rowLabels: string[]; colLabels: string[] }[] = [];
  for (const row of included) {
    const rowLabels = labelsOf(row, rowQ, rowBins);
    if (rowLabels.length === 0) continue;
    const colLabels = labelsOf(row, colQ, colBins);
    if (colLabels.length === 0) continue;
    targets.push({ rowLabels, colLabels });
  }

  result.grandTotal = targets.length;
  if (targets.length === 0) return result;

  // 出現数は「対象回答者内での実人数」で数え、0件のラベルは含めない
  const rowEntries = orderLabelEntries(
    countLabels(targets.map((t) => t.rowLabels)),
    rowQ.order,
    rowQ.presetOptions,
  );
  const colEntries = orderLabelEntries(
    countLabels(targets.map((t) => t.colLabels)),
    colQ.order,
    colQ.presetOptions,
  );

  const rowIndex = new Map(rowEntries.map((e, i) => [e.key, i] as const));
  const colIndex = new Map(colEntries.map((e, i) => [e.key, i] as const));

  const counts: number[][] = rowEntries.map(() => colEntries.map(() => 0));
  const rowTotals: number[] = rowEntries.map(() => 0);
  const colTotals: number[] = colEntries.map(() => 0);

  for (const target of targets) {
    const rs = indicesOf(target.rowLabels, rowIndex);
    const cs = indicesOf(target.colLabels, colIndex);
    for (const r of rs) rowTotals[r] += 1;
    for (const c of cs) colTotals[c] += 1;
    for (const r of rs) {
      for (const c of cs) counts[r][c] += 1;
    }
  }

  result.rowLabels = rowEntries.map((e) => e.label);
  result.colLabels = colEntries.map((e) => e.label);
  result.counts = counts;
  result.rowTotals = rowTotals;
  result.colTotals = colTotals;
  return result;
}

/**
 * 表示用のセル値を文字列にする。
 * count → "12" / row → "12 (30.0%)" / col → "12 (24.5%)" / total → "12 (12.8%)"
 * 分母が 0 のときは割合を出さず "12 (-)" とする。
 */
export function formatCell(ct: CrossTabResult, r: number, c: number): string {
  const count = ct.counts[r]?.[c] ?? 0;
  if (ct.mode === 'count') return String(count);

  let denominator: number;
  if (ct.mode === 'row') denominator = ct.rowTotals[r] ?? 0;
  else if (ct.mode === 'col') denominator = ct.colTotals[c] ?? 0;
  else denominator = ct.grandTotal;

  if (denominator <= 0) return `${count} (-)`;
  return `${count} (${((count / denominator) * 100).toFixed(1)}%)`;
}
