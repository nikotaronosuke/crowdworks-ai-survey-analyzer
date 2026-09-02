/**
 * 集計モジュール。
 * Dataset（読み込み済みデータ）と QuestionDef（質問定義）から
 * 質問ごとの度数集計 Aggregation / 全体の AnalysisResult を作る。
 * 外部通信・永続化は一切行わない（完全ローカル）。
 */

import type {
  AnalysisResult,
  Aggregation,
  Dataset,
  OptionCount,
  OptionOrder,
  QuestionDef,
  ResponseRow,
} from '../types.ts';
import { isBlank, naturalCompare, normalizeKey, normalizeText } from './text.ts';
import { canonicalizeOption, splitAnswers } from './splitter.ts';
import { makeBins, parseJapaneseNumber, summarizeNumeric } from './numeric.ts';
import { workDaysCell, workMinutesCell } from './worktime.ts';

/** 出力元アプリ名とバージョン（analysis.json の generator に入る） */
const GENERATOR = 'crowdworks-ai-survey-analyzer v1.0.0';

/** 自由記述の抜粋件数の上限 */
const FREE_SAMPLE_LIMIT = 20;

/** 自由記述の抜粋1件あたりの最大文字数 */
const FREE_SAMPLE_MAX_CHARS = 200;

/**
 * 1回答者・1質問のセル値を取り出す。
 * 派生質問（年列＋月列から "YYYY-MM" を合成するもの）にも対応する。
 * 合成できない場合は空文字を返す（＝未回答扱い）。
 */
export function cellValue(row: ResponseRow, q: QuestionDef): string {
  const derived = q.derived;
  if (derived && derived.type === 'year-month') {
    const rawYear = row.values[derived.yearColumn] ?? '';
    const rawMonth = row.values[derived.monthColumn] ?? '';
    const year = parseJapaneseNumber(rawYear);
    const month = parseJapaneseNumber(rawMonth);
    // 年・月のどちらかが取れなければ合成しない
    if (year === null || month === null) return '';
    // "24" のような2桁表記は 2000 年代とみなす
    const y = year < 100 ? year + 2000 : year;
    // 月が 1〜12 の整数でなければ無効
    if (!Number.isInteger(month) || month < 1 || month > 12) return '';
    return `${y}-${String(month).padStart(2, '0')}`;
  }
  // 作業時間の自由記述から作った派生値。原文は元の列にそのまま残る。
  if (derived && derived.type === 'work-days') {
    return workDaysCell(row.values[derived.sourceColumn] ?? '');
  }
  if (derived && derived.type === 'work-minutes') {
    return workMinutesCell(row.values[derived.sourceColumn] ?? '');
  }
  return row.values[q.columnIndex] ?? '';
}

/**
 * 1回答者がその質問で選んだ選択肢の配列を返す（同一回答者内の重複は除去済み）。
 * - multiple: 区切り文字で分割し、エイリアスを適用してから重複除去
 * - single: 表記ゆれをエイリアスで正規ラベルに寄せた1要素
 * - numeric / free: 度数集計には使わないが「回答した人数」を数えるため
 *   非空なら1要素（正規化した本文）を返す
 * - ignore: 常に空配列
 * 未回答（空欄扱い）のときは空配列。
 */
export function respondentOptions(row: ResponseRow, q: QuestionDef): string[] {
  const cell = cellValue(row, q);

  if (q.kind === 'ignore') return [];

  if (q.kind === 'multiple') {
    const parts = splitAnswers(cell, q.delimiters);
    const seen = new Set<string>();
    const options: string[] = [];
    for (const part of parts) {
      const label = canonicalizeOption(part, q.optionAliases);
      if (label === '') continue;
      const key = normalizeKey(label);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(label);
    }
    return options;
  }

  if (isBlank(cell)) return [];

  if (q.kind === 'single') return [canonicalizeOption(cell, q.optionAliases)];

  // numeric / free は本文そのものを1要素として返す
  return [normalizeText(cell)];
}

/**
 * ラベル付き集計エントリを q.order の規則で並べ替えて返す（元配列は変更しない）。
 * - 'preset' : presetOptions の順に、実際に出現したものだけを先頭へ。
 *              残りは件数降順（同数はラベルの自然順）で後ろに付ける
 * - 'count'  : 件数降順（同数はラベルの自然順）
 * - 'natural': ラベルの自然順
 * aggregate と crosstab で並び規則を共有するために export している。
 */
export function orderLabelEntries<T extends { label: string; count: number }>(
  entries: T[],
  order: OptionOrder,
  presetOptions?: string[],
): T[] {
  const byCount = (a: T, b: T): number =>
    b.count - a.count || naturalCompare(a.label, b.label);

  if (order === 'natural') {
    return [...entries].sort((a, b) => naturalCompare(a.label, b.label));
  }
  if (order === 'count') {
    return [...entries].sort(byCount);
  }

  // preset: 定義順 → 残りを件数降順
  const byKey = new Map<string, T>();
  for (const entry of entries) {
    const key = normalizeKey(entry.label);
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  const head: T[] = [];
  const usedKeys = new Set<string>();
  for (const preset of presetOptions ?? []) {
    const key = normalizeKey(preset);
    if (usedKeys.has(key)) continue;
    const hit = byKey.get(key);
    if (!hit) continue;
    usedKeys.add(key);
    head.push(hit);
  }
  const rest = entries
    .filter((entry) => !usedKeys.has(normalizeKey(entry.label)))
    .sort(byCount);
  return [...head, ...rest];
}

/**
 * 有効回答数に対する割合（0-100）を小数第2位で四捨五入して返す。
 * 有効回答数が 0 のときは 0。
 */
function toPercentage(count: number, validResponses: number): number {
  if (validResponses === 0) return 0;
  return Math.round((count / validResponses) * 10000) / 100;
}

/**
 * numeric 質問の数値配列と、パースできなかった件数を集める。
 * 空欄は対象外（未回答であって「パース失敗」ではない）。
 */
function collectNumericValues(
  rows: ResponseRow[],
  q: QuestionDef,
): { values: number[]; unparsed: number } {
  const values: number[] = [];
  let unparsed = 0;
  for (const row of rows) {
    const cell = cellValue(row, q);
    if (isBlank(cell)) continue;
    const value = parseJapaneseNumber(cell, q.unit);
    if (value === null) unparsed += 1;
    else values.push(value);
  }
  return { values, unparsed };
}

/**
 * 1つの質問を集計する。集計対象は ds.rows のうち included===true の行のみ。
 * kind==='ignore' の質問が渡された場合も例外を投げず、空の集計を返す。
 */
export function aggregateQuestion(ds: Dataset, q: QuestionDef): Aggregation {
  const included = ds.rows.filter((r) => r.included);

  const result: Aggregation = {
    key: q.key,
    question: q.label,
    kind: q.kind,
    multiple: q.kind === 'multiple',
    validResponses: 0,
    blankResponses: included.length,
    totalSelections: 0,
    items: [],
  };

  // 集計対象外の質問は空集計をそのまま返す
  if (q.kind === 'ignore') return result;

  // 回答者ごとの選択肢を数える（valid / 延べ選択数はどの kind でも共通）
  const counter = new Map<string, { label: string; count: number }>();
  let validResponses = 0;
  let totalSelections = 0;
  for (const row of included) {
    const options = respondentOptions(row, q);
    if (options.length === 0) continue;
    validResponses += 1;
    totalSelections += options.length;
    for (const option of options) {
      const key = normalizeKey(option);
      const entry = counter.get(key);
      if (entry) entry.count += 1;
      else counter.set(key, { label: option, count: 1 });
    }
  }

  result.validResponses = validResponses;
  result.blankResponses = included.length - validResponses;
  result.totalSelections = totalSelections;

  if (q.kind === 'numeric') {
    // 数値はビン（階級）に分けて度数を出す。ビンの順序はそのまま保つ
    const { values, unparsed } = collectNumericValues(included, q);
    result.items = makeBins(values, q.unit).map((bin) => ({
      label: bin.label,
      count: bin.count,
      percentage: toPercentage(bin.count, validResponses),
    }));
    result.numeric = summarizeNumeric(values, q.unit, unparsed);
    return result;
  }

  if (q.kind === 'free') {
    // 自由記述は度数集計せず、抜粋のみを持つ
    const samples: string[] = [];
    for (const row of included) {
      if (samples.length >= FREE_SAMPLE_LIMIT) break;
      const cell = cellValue(row, q);
      if (isBlank(cell)) continue;
      samples.push(normalizeText(cell).slice(0, FREE_SAMPLE_MAX_CHARS));
    }
    result.items = [];
    result.freeTextSamples = samples;
    return result;
  }

  const items: OptionCount[] = [...counter.values()].map((entry) => ({
    label: entry.label,
    count: entry.count,
    percentage: toPercentage(entry.count, validResponses),
  }));
  result.items = orderLabelEntries(items, q.order, q.presetOptions);
  return result;
}

/**
 * ローカルタイムゾーンのオフセット付き ISO 8601 文字列を作る。
 * 例: 2026-09-02T14:30:00+09:00
 */
function toLocalIsoString(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  // getTimezoneOffset は「UTC - ローカル」の分なので符号を反転する
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${ymd}T${hms}${offset}`;
}

/**
 * kind==='ignore' 以外の全質問を集計して AnalysisResult を返す。
 * generatedAt はローカルタイムゾーンオフセット付きの ISO 8601。
 */
export function aggregateAll(ds: Dataset): AnalysisResult {
  const includedResponses = ds.rows.reduce((n, r) => (r.included ? n + 1 : n), 0);
  return {
    generatedAt: toLocalIsoString(new Date()),
    generator: GENERATOR,
    sourceName: ds.sourceName,
    totalResponses: ds.rows.length,
    includedResponses,
    excludedResponses: ds.rows.length - includedResponses,
    // 集計対象は「対象外にしていない」かつ「出力対象に選ばれている」設問だけ。
    // ここで絞ることで、基本集計・グラフ・summary.csv・analysis.json・
    // survey-summary.md のすべてが同じ選択に追随する。
    // responses.csv / survey-free-text.md / cross-tab.csv は
    // AnalysisResult を経由しないので影響を受けない。
    questions: ds.questions
      .filter((q) => q.kind !== 'ignore' && q.selected)
      .map((q) => aggregateQuestion(ds, q)),
  };
}
