/**
 * src/core/crosstab.ts のテスト。
 *
 * クロス集計は「1人が複数のセルに現れる」ことが誤読の元になるため、
 * 手計算できる小さな例で counts / rowTotals / colTotals / grandTotal の
 * 関係（特に合計が一致しないケース）を固定する。
 */

import { describe, it, expect } from 'vitest';
import { crossTabulate, formatCell } from '../src/core/crosstab.ts';
import { makeDataset, makeQuestion } from './helpers.ts';
import type { Dataset } from '../src/types.ts';

/**
 * 単一回答 × 単一回答のデータセット。
 * 年齢(0列) × 評価(1列)。5・6行目は片側が未回答なので対象外になる。
 */
function singleBySingle(): Dataset {
  return makeDataset({
    headers: ['年齢', '評価'],
    questions: [
      makeQuestion({ key: 'age', columnIndex: 0, label: '年齢', order: 'natural' }),
      makeQuestion({ key: 'rating', columnIndex: 1, label: '評価', order: 'natural' }),
    ],
    rows: [
      ['20代', 'A'],
      ['20代', 'B'],
      ['30代', 'A'],
      ['30代', 'A'],
      ['20代', ''], // 列が未回答 → 対象外
      ['', 'B'], // 行が未回答 → 対象外
    ],
  });
}

/**
 * 複数回答 × 単一回答のデータセット。
 * 使用したAI(0列, 複数回答) × 年齢(1列, 単一回答)。
 */
function multipleBySingle(): Dataset {
  return makeDataset({
    headers: ['使用したAI', '年齢'],
    questions: [
      makeQuestion({
        key: 'ai-tools',
        columnIndex: 0,
        label: '使用したAI',
        kind: 'multiple',
        order: 'count',
      }),
      makeQuestion({ key: 'age', columnIndex: 1, label: '年齢', order: 'natural' }),
    ],
    rows: [
      ['ChatGPT、Claude', '20代'],
      ['ChatGPT', '20代'],
      ['ChatGPT、Claude', '30代'],
      ['Claude', '30代'],
      ['ChatGPT', '30代'],
      ['', '20代'], // 行が未回答 → 対象外
      ['Gemini', ''], // 列が未回答 → 対象外
    ],
  });
}

describe('crossTabulate — 単一回答 × 単一回答', () => {
  it('手計算どおりの counts / rowTotals / colTotals / grandTotal になる', () => {
    const ct = crossTabulate(singleBySingle(), 'age', 'rating', 'count');

    expect(ct.rowQuestion).toBe('年齢');
    expect(ct.colQuestion).toBe('評価');
    expect(ct.rowMultiple).toBe(false);
    expect(ct.colMultiple).toBe(false);
    expect(ct.mode).toBe('count');

    // 両方に有効回答があるのは4人だけ
    expect(ct.grandTotal).toBe(4);
    expect(ct.rowLabels).toEqual(['20代', '30代']);
    expect(ct.colLabels).toEqual(['A', 'B']);
    expect(ct.counts).toEqual([
      [1, 1], // 20代: A=1, B=1
      [2, 0], // 30代: A=2, B=0
    ]);
    expect(ct.rowTotals).toEqual([2, 2]);
    expect(ct.colTotals).toEqual([3, 1]);

    // 単一回答同士なら行合計・列合計はどちらも grandTotal と一致する
    const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
    expect(sum(ct.rowTotals)).toBe(ct.grandTotal);
    expect(sum(ct.colTotals)).toBe(ct.grandTotal);
  });

  it('件数0の選択肢はラベルに含めない', () => {
    const ds = makeDataset({
      headers: ['年齢', '評価'],
      questions: [
        makeQuestion({
          key: 'age',
          columnIndex: 0,
          label: '年齢',
          order: 'preset',
          presetOptions: ['10代', '20代', '30代'],
        }),
        makeQuestion({ key: 'rating', columnIndex: 1, label: '評価', order: 'natural' }),
      ],
      rows: [
        ['20代', 'A'],
        ['30代', 'A'],
      ],
    });
    const ct = crossTabulate(ds, 'age', 'rating', 'count');
    // preset に 10代 があっても、出現しないので含まれない
    expect(ct.rowLabels).toEqual(['20代', '30代']);
  });

  it('included=false の行は集計対象から外れる', () => {
    const base = singleBySingle();
    const ds: Dataset = {
      ...base,
      // 「30代 × A」の2件（index 2,3）を除外する
      rows: base.rows.map((r) => (r.id === 2 || r.id === 3 ? { ...r, included: false } : r)),
    };
    const ct = crossTabulate(ds, 'age', 'rating', 'count');

    expect(ct.grandTotal).toBe(2);
    expect(ct.rowLabels).toEqual(['20代']);
    expect(ct.counts).toEqual([[1, 1]]);
    expect(ct.rowTotals).toEqual([2]);
  });
});

describe('crossTabulate — 複数回答 × 単一回答', () => {
  it('1人が複数のセルに現れ、rowTotals の合計は grandTotal と一致しない', () => {
    const ct = crossTabulate(multipleBySingle(), 'ai-tools', 'age', 'count');

    expect(ct.rowMultiple).toBe(true);
    expect(ct.colMultiple).toBe(false);
    expect(ct.grandTotal).toBe(5);
    expect(ct.rowLabels).toEqual(['ChatGPT', 'Claude']); // 件数降順 4件 / 3件
    expect(ct.colLabels).toEqual(['20代', '30代']);
    expect(ct.counts).toEqual([
      [2, 2], // ChatGPT: 20代=2, 30代=2
      [1, 2], // Claude:  20代=1, 30代=2
    ]);
    expect(ct.rowTotals).toEqual([4, 3]);
    expect(ct.colTotals).toEqual([2, 3]);

    const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
    // 行が複数回答なので、行合計の和は実人数(5)を超える
    expect(sum(ct.rowTotals)).toBe(7);
    expect(sum(ct.rowTotals)).not.toBe(ct.grandTotal);
    // 列は単一回答なので、列合計の和は実人数と一致する
    expect(sum(ct.colTotals)).toBe(ct.grandTotal);

    // 1人目は ChatGPT と Claude の両方を選んでいるので「20代」の列に2回現れる。
    // そのため列の実人数(2)より、その列のセル合計(3)の方が大きくなる。
    expect(ct.counts[0][0] + ct.counts[1][0]).toBe(3);
    expect(ct.colTotals[0]).toBe(2);
  });

  it('preset 順の行ラベルは preset → 残りを件数降順で並べる', () => {
    const ds = makeDataset({
      headers: ['年齢', '評価'],
      questions: [
        makeQuestion({
          key: 'age',
          columnIndex: 0,
          label: '年齢',
          order: 'preset',
          presetOptions: ['10代', '20代', '30代'],
        }),
        makeQuestion({ key: 'rating', columnIndex: 1, label: '評価', order: 'count' }),
      ],
      rows: [
        ['20代', 'X'],
        ['10代', 'X'],
        ['不明', 'Y'],
        ['不明', 'Y'],
        ['不明', 'X'],
      ],
    });
    const ct = crossTabulate(ds, 'age', 'rating', 'count');

    expect(ct.rowLabels).toEqual(['10代', '20代', '不明']);
    expect(ct.colLabels).toEqual(['X', 'Y']); // X=3 / Y=2 の件数降順
    expect(ct.counts).toEqual([
      [1, 0],
      [1, 0],
      [1, 2],
    ]);
    expect(ct.rowTotals).toEqual([1, 1, 3]);
    expect(ct.colTotals).toEqual([3, 2]);
    expect(ct.grandTotal).toBe(5);
  });
});

describe('crossTabulate — 対象外の質問', () => {
  it('free / ignore の質問は空の結果を返す', () => {
    const ds = makeDataset({
      headers: ['年齢', '自由記述'],
      questions: [
        makeQuestion({ key: 'age', columnIndex: 0, label: '年齢', order: 'natural' }),
        makeQuestion({
          key: 'free-comment',
          columnIndex: 1,
          label: '自由記述',
          kind: 'free',
          chart: 'none',
        }),
      ],
      rows: [
        ['20代', 'コメントA'],
        ['30代', 'コメントB'],
      ],
    });
    const ct = crossTabulate(ds, 'age', 'free-comment', 'count');

    expect(ct.rowLabels).toEqual([]);
    expect(ct.colLabels).toEqual([]);
    expect(ct.counts).toEqual([]);
    expect(ct.grandTotal).toBe(0);
    // キー自体は結果に残す（UI がどの組み合わせだったか分かるように）
    expect(ct.rowKey).toBe('age');
    expect(ct.colKey).toBe('free-comment');
  });

  it('存在しないキーを渡しても例外を投げず空の結果を返す', () => {
    const ct = crossTabulate(singleBySingle(), 'age', 'not-exist', 'count');
    expect(ct.grandTotal).toBe(0);
    expect(ct.rowLabels).toEqual([]);
    expect(ct.colLabels).toEqual([]);
  });
});

describe('formatCell', () => {
  const ds = singleBySingle();

  it("mode='count' は件数のみ", () => {
    const ct = crossTabulate(ds, 'age', 'rating', 'count');
    expect(formatCell(ct, 1, 0)).toBe('2');
    expect(formatCell(ct, 1, 1)).toBe('0');
  });

  it("mode='row' の分母は rowTotals", () => {
    const ct = crossTabulate(ds, 'age', 'rating', 'row');
    // 30代の行合計は2、そのうち A が2 → 100.0%
    expect(formatCell(ct, 1, 0)).toBe('2 (100.0%)');
    expect(formatCell(ct, 0, 0)).toBe('1 (50.0%)');
  });

  it("mode='col' の分母は colTotals", () => {
    const ct = crossTabulate(ds, 'age', 'rating', 'col');
    // A の列合計は3、そのうち30代が2 → 66.7%
    expect(formatCell(ct, 1, 0)).toBe('2 (66.7%)');
    expect(formatCell(ct, 0, 1)).toBe('1 (100.0%)');
  });

  it("mode='total' の分母は grandTotal", () => {
    const ct = crossTabulate(ds, 'age', 'rating', 'total');
    expect(formatCell(ct, 1, 0)).toBe('2 (50.0%)');
    expect(formatCell(ct, 0, 0)).toBe('1 (25.0%)');
  });
});
