/**
 * テスト用ヘルパー。
 *
 * 「手で組み立てた小さな Dataset」でロジックだけを検証するためのユーティリティ。
 * CSV パースや列名マッピング（parse.ts / schema.ts）には意図的に依存させず、
 * 検証したい条件（未回答・除外行・複数回答・並び順）を直接表現できるようにしている。
 * DOM / ネットワーク / ストレージには一切触れない。
 */

import type {
  Aggregation,
  Dataset,
  OptionCount,
  QuestionDef,
  ResponseRow,
} from '../src/types.ts';
import { SAFE_DELIMITERS } from '../src/core/splitter.ts';

/** makeQuestion に渡す指定。key 以外は妥当な既定値で埋められる */
export type QuestionSpec = Partial<QuestionDef> & { key: string };

/**
 * QuestionDef を既定値付きで作る。
 * 既定は「0 列目・単一選択・件数降順・プロファイル由来（inferred=false）」。
 */
export function makeQuestion(spec: QuestionSpec): QuestionDef {
  const header = spec.header ?? spec.key;
  return {
    key: spec.key,
    columnIndex: spec.columnIndex ?? 0,
    header,
    label: spec.label ?? header,
    kind: spec.kind ?? 'single',
    chart: spec.chart ?? 'bar',
    delimiters: spec.delimiters ?? SAFE_DELIMITERS,
    order: spec.order ?? 'count',
    presetOptions: spec.presetOptions,
    optionAliases: spec.optionAliases,
    unit: spec.unit,
    // 既定は「出力対象」。出力対象から外した状態を作りたいときだけ false を渡す
    selected: spec.selected ?? true,
    identity: spec.identity,
    inferred: spec.inferred ?? false,
    profileKey: spec.profileKey,
    derived: spec.derived,
  };
}

/**
 * makeDataset に渡す 1 行分の指定。
 * 文字列配列だけを渡した場合は集計対象（included=true）とみなす。
 */
export type RowSpec = string[] | { values: string[]; included: boolean };

/** makeDataset に渡すデータセット指定 */
export interface DatasetSpec {
  headers: string[];
  questions: QuestionDef[];
  rows: RowSpec[];
  sourceName?: string;
  delimiter?: string;
  warnings?: string[];
}

/**
 * Dataset を組み立てる。
 * id は 0 始まりの通し番号を自動で振り、各行は headers と同じ長さに詰める
 * （実装が短い行を受け取ったときの挙動に依存しないようにするため）。
 */
export function makeDataset(spec: DatasetSpec): Dataset {
  const rows: ResponseRow[] = spec.rows.map((row, id) => {
    const isPlain = Array.isArray(row);
    const source = isPlain ? row : row.values;
    const values = spec.headers.map((_, i) => source[i] ?? '');
    return { id, values, included: isPlain ? true : row.included };
  });

  return {
    headers: [...spec.headers],
    rows,
    questions: spec.questions,
    delimiter: spec.delimiter ?? ',',
    warnings: spec.warnings ?? [],
    sourceName: spec.sourceName ?? 'test.csv',
  };
}

/** 集計結果から指定ラベルの項目を取り出す（無ければ undefined） */
export function itemOf(a: Aggregation, label: string): OptionCount | undefined {
  return a.items.find((item) => item.label === label);
}

/** items を「ラベル → 件数」の対応表にする（件数の比較用） */
export function countsOf(a: Aggregation): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of a.items) map[item.label] = item.count;
  return map;
}

/** items のラベルを表示順のまま並べた配列（並び順の検証用） */
export function labelsOf(a: Aggregation): string[] {
  return a.items.map((item) => item.label);
}

/** 割合の合計（複数回答で 100 を超えることの確認用） */
export function percentageSum(a: Aggregation): number {
  return a.items.reduce((sum, item) => sum + item.percentage, 0);
}
