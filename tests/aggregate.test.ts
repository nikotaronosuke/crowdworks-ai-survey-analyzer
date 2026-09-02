/**
 * src/core/aggregate.ts のテスト。
 *
 * 「割合の分母は有効回答数であって集計対象件数ではない」「複数回答は人数ベース」
 * という、集計結果の読み方を左右する部分を重点的に固定する。
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateAll,
  aggregateQuestion,
  cellValue,
  respondentOptions,
} from '../src/core/aggregate.ts';
import {
  countsOf,
  itemOf,
  labelsOf,
  makeDataset,
  makeQuestion,
  percentageSum,
} from './helpers.ts';

/** 性別（単一選択）1列だけのデータセットを作る */
function genderDataset(cells: string[], excluded: number[] = []) {
  const gender = makeQuestion({
    key: 'gender',
    columnIndex: 0,
    header: '性別',
    label: '性別',
    kind: 'single',
    order: 'count',
  });
  return {
    gender,
    ds: makeDataset({
      headers: ['性別'],
      questions: [gender],
      rows: cells.map((cell, i) => ({
        values: [cell],
        included: !excluded.includes(i),
      })),
    }),
  };
}

/** 使用AI（複数回答）1列だけのデータセットを作る */
function toolsDataset(cells: string[]) {
  const tools = makeQuestion({
    key: 'ai-tools',
    columnIndex: 0,
    header: '使用したAI',
    label: '使用したAI',
    kind: 'multiple',
    order: 'count',
  });
  return {
    tools,
    ds: makeDataset({
      headers: ['使用したAI'],
      questions: [tools],
      rows: cells.map((cell) => [cell]),
    }),
  };
}

describe('cellValue', () => {
  it('通常の質問は列の値をそのまま返す', () => {
    const q = makeQuestion({ key: 'gender', columnIndex: 1 });
    const ds = makeDataset({
      headers: ['年齢', '性別'],
      questions: [q],
      rows: [['30代', '女性']],
    });
    expect(cellValue(ds.rows[0], q)).toBe('女性');
  });

  it('派生質問（年＋月）は "YYYY-MM" を合成する', () => {
    const q = makeQuestion({
      key: 'start-year-month',
      columnIndex: -1,
      header: '年月',
      label: '仕事を受注・開始した年月',
      order: 'natural',
      derived: { type: 'year-month', yearColumn: 0, monthColumn: 1 },
    });
    const ds = makeDataset({
      headers: ['年', '月'],
      questions: [q],
      rows: [
        ['2024年', '3月'],
        ['24', '12'],
        ['2024', '13'], // 月が範囲外
        ['', '3'], // 年が無い
      ],
    });
    expect(cellValue(ds.rows[0], q)).toBe('2024-03');
    expect(cellValue(ds.rows[1], q)).toBe('2024-12'); // 2桁年は 2000 を足す
    expect(cellValue(ds.rows[2], q)).toBe('');
    expect(cellValue(ds.rows[3], q)).toBe('');
  });
});

describe('respondentOptions', () => {
  it('単一選択は最大1要素、未回答は空配列', () => {
    const { gender, ds } = genderDataset(['女性', '', '-']);
    expect(respondentOptions(ds.rows[0], gender)).toEqual(['女性']);
    expect(respondentOptions(ds.rows[1], gender)).toEqual([]);
    expect(respondentOptions(ds.rows[2], gender)).toEqual([]); // "-" は空欄扱い
  });

  it('複数選択は区切り文字で分割し、同一セル内の重複は除く', () => {
    const { tools, ds } = toolsDataset(['ChatGPT、Claude', 'ChatGPT、ChatGPT']);
    expect(respondentOptions(ds.rows[0], tools)).toEqual(['ChatGPT', 'Claude']);
    expect(respondentOptions(ds.rows[1], tools)).toEqual(['ChatGPT']);
  });

  it('ignore は常に空配列', () => {
    const q = makeQuestion({ key: 'ts', columnIndex: 0, kind: 'ignore' });
    const ds = makeDataset({ headers: ['ts'], questions: [q], rows: [['2024/01/01']] });
    expect(respondentOptions(ds.rows[0], q)).toEqual([]);
  });
});

describe('aggregateQuestion — 単一選択の割合', () => {
  it('有効回答8件のうち5件が「女性」なら 62.5%', () => {
    const { gender, ds } = genderDataset([
      '女性',
      '女性',
      '女性',
      '女性',
      '女性',
      '男性',
      '男性',
      '男性',
    ]);
    const agg = aggregateQuestion(ds, gender);

    expect(agg.validResponses).toBe(8);
    expect(agg.blankResponses).toBe(0);
    expect(agg.totalSelections).toBe(8);
    expect(agg.multiple).toBe(false);
    expect(itemOf(agg, '女性')?.count).toBe(5);
    expect(itemOf(agg, '女性')?.percentage).toBe(62.5);
    expect(itemOf(agg, '男性')?.percentage).toBe(37.5);
  });

  it('未回答があると validResponses が減り、割合の分母も validResponses になる', () => {
    // 集計対象は10件、そのうち2件が未回答 → 有効回答は8件
    const { gender, ds } = genderDataset([
      '女性',
      '女性',
      '女性',
      '女性',
      '女性',
      '男性',
      '男性',
      '男性',
      '', // 未回答
      '-', // 未回答扱い
    ]);
    const agg = aggregateQuestion(ds, gender);

    expect(ds.rows.length).toBe(10);
    expect(agg.validResponses).toBe(8);
    expect(agg.blankResponses).toBe(2);
    // 分母が集計対象件数(10)なら 50、有効回答数(8)なら 62.5
    expect(itemOf(agg, '女性')?.percentage).toBe(62.5);
    expect(itemOf(agg, '女性')?.percentage).not.toBe(50);
  });

  it('割合は小数第2位で四捨五入して保持する', () => {
    const { gender, ds } = genderDataset(['女性', '男性', '男性']);
    const agg = aggregateQuestion(ds, gender);
    expect(itemOf(agg, '女性')?.percentage).toBe(33.33);
    expect(itemOf(agg, '男性')?.percentage).toBe(66.67);
  });

  it('有効回答が0件なら割合は0（0除算しない）', () => {
    const { gender, ds } = genderDataset(['', '-', 'N/A']);
    const agg = aggregateQuestion(ds, gender);
    expect(agg.validResponses).toBe(0);
    expect(agg.blankResponses).toBe(3);
    expect(agg.items).toEqual([]);
  });
});

describe('aggregateQuestion — 複数回答', () => {
  it('1人が2つ選ぶと totalSelections は +2、validResponses は +1', () => {
    const base = toolsDataset(['ChatGPT', 'Claude']);
    const baseAgg = aggregateQuestion(base.ds, base.tools);

    const added = toolsDataset(['ChatGPT', 'Claude', 'ChatGPT、Gemini']);
    const addedAgg = aggregateQuestion(added.ds, added.tools);

    expect(baseAgg.validResponses).toBe(2);
    expect(baseAgg.totalSelections).toBe(2);
    expect(addedAgg.validResponses).toBe(baseAgg.validResponses + 1);
    expect(addedAgg.totalSelections).toBe(baseAgg.totalSelections + 2);
  });

  it('割合の合計は100を超えうる（分母は延べ選択数ではなく回答者数）', () => {
    const { tools, ds } = toolsDataset(['ChatGPT、Claude', 'ChatGPT', 'Claude、Gemini']);
    const agg = aggregateQuestion(ds, tools);

    expect(agg.multiple).toBe(true);
    expect(agg.validResponses).toBe(3);
    expect(agg.totalSelections).toBe(5);
    expect(countsOf(agg)).toEqual({ ChatGPT: 2, Claude: 2, Gemini: 1 });
    expect(itemOf(agg, 'ChatGPT')?.percentage).toBe(66.67);
    expect(itemOf(agg, 'Gemini')?.percentage).toBe(33.33);
    expect(percentageSum(agg)).toBeGreaterThan(100);
  });

  it('同一セル内の重複選択は1回だけ数える', () => {
    const { tools, ds } = toolsDataset(['ChatGPT、ChatGPT、Claude', 'ChatGPT']);
    const agg = aggregateQuestion(ds, tools);

    expect(agg.validResponses).toBe(2);
    // 1人目は ChatGPT を2回書いているが 1 選択として数える
    expect(agg.totalSelections).toBe(3);
    expect(countsOf(agg)).toEqual({ ChatGPT: 2, Claude: 1 });
    expect(itemOf(agg, 'ChatGPT')?.percentage).toBe(100);
  });

  it('括弧の中の区切り文字では分割しない', () => {
    const { tools, ds } = toolsDataset(['その他（AAA、BBB）、ChatGPT']);
    const agg = aggregateQuestion(ds, tools);
    // 全角括弧は NFKC で半角に寄る
    expect(labelsOf(agg).sort()).toEqual(['ChatGPT', 'その他(AAA、BBB)'].sort());
    expect(agg.totalSelections).toBe(2);
  });
});

describe('aggregateQuestion — 除外行', () => {
  it('included=false の行は集計から完全に除外される', () => {
    // 10件中 index 8,9 の「女性」2件を除外 → 女性は5件のまま
    const { gender, ds } = genderDataset(
      [
        '女性',
        '女性',
        '女性',
        '女性',
        '女性',
        '男性',
        '男性',
        '男性',
        '女性',
        '女性',
      ],
      [8, 9],
    );
    const agg = aggregateQuestion(ds, gender);

    expect(ds.rows.length).toBe(10);
    expect(agg.validResponses).toBe(8);
    expect(agg.blankResponses).toBe(0);
    expect(itemOf(agg, '女性')?.count).toBe(5);
    expect(itemOf(agg, '女性')?.percentage).toBe(62.5);
  });

  it('除外行は未回答（blankResponses）にも数えない', () => {
    const { gender, ds } = genderDataset(['女性', '男性', ''], [2]);
    const agg = aggregateQuestion(ds, gender);
    expect(agg.validResponses).toBe(2);
    expect(agg.blankResponses).toBe(0);
  });
});

describe('aggregateQuestion — 並び順', () => {
  /** 並び順の検証用データ（10件） */
  const cells = [
    '10代',
    '10代',
    '30代',
    '不明',
    '不明',
    '不明',
    '不明',
    'その他',
    'その他',
    'その他',
  ];

  it("order='preset' は preset 順が先、preset に無い選択肢は末尾に件数降順", () => {
    const q = makeQuestion({
      key: 'age',
      columnIndex: 0,
      header: '年齢',
      order: 'preset',
      presetOptions: ['10代', '20代', '30代'],
    });
    const ds = makeDataset({
      headers: ['年齢'],
      questions: [q],
      rows: cells.map((c) => [c]),
    });
    const agg = aggregateQuestion(ds, q);

    // 20代は出現しないので並びに含まれない。
    // 不明(4) / その他(3) は preset に無いので末尾へ件数降順で回る。
    expect(labelsOf(agg)).toEqual(['10代', '30代', '不明', 'その他']);
    expect(countsOf(agg)).toEqual({ '10代': 2, '30代': 1, 不明: 4, その他: 3 });
  });

  it("order='count' は件数降順", () => {
    const q = makeQuestion({ key: 'age', columnIndex: 0, order: 'count' });
    const ds = makeDataset({
      headers: ['年齢'],
      questions: [q],
      rows: cells.map((c) => [c]),
    });
    expect(labelsOf(aggregateQuestion(ds, q))).toEqual(['不明', 'その他', '10代', '30代']);
  });

  it("order='count' の同数はラベルの自然順で並ぶ", () => {
    const q = makeQuestion({ key: 'age', columnIndex: 0, order: 'count' });
    const ds = makeDataset({
      headers: ['年齢'],
      questions: [q],
      rows: [['20代'], ['20代'], ['10代'], ['10代']],
    });
    expect(labelsOf(aggregateQuestion(ds, q))).toEqual(['10代', '20代']);
  });

  it("order='natural' はラベルの自然順（数値部分を数値として比較）", () => {
    const q = makeQuestion({ key: 'ym', columnIndex: 0, order: 'natural' });
    const ds = makeDataset({
      headers: ['年月'],
      questions: [q],
      rows: [['2024-12'], ['2023-11'], ['2024-03'], ['2024-03']],
    });
    expect(labelsOf(aggregateQuestion(ds, q))).toEqual(['2023-11', '2024-03', '2024-12']);
  });
});

describe('aggregateQuestion — numeric / free', () => {
  it('numeric はビンを items に、要約統計を numeric に入れる', () => {
    const q = makeQuestion({
      key: 'reward',
      columnIndex: 0,
      header: '報酬',
      kind: 'numeric',
      unit: '円',
      order: 'natural',
    });
    const ds = makeDataset({
      headers: ['報酬'],
      questions: [q],
      rows: [['1,000円'], ['2000円'], ['3000円'], ['わからない'], ['']],
    });
    const agg = aggregateQuestion(ds, q);

    // 非空なら「回答した人」なので、数値化できなかった1件も有効回答に含む
    expect(agg.validResponses).toBe(4);
    expect(agg.blankResponses).toBe(1);
    expect(agg.numeric?.n).toBe(3);
    expect(agg.numeric?.unparsed).toBe(1);
    expect(agg.numeric?.min).toBe(1000);
    expect(agg.numeric?.max).toBe(3000);
    expect(agg.numeric?.mean).toBe(2000);
    expect(agg.numeric?.median).toBe(2000);
    expect(agg.numeric?.sum).toBe(6000);
    expect(agg.numeric?.unit).toBe('円');

    // 異なり値が10種類以下なので値そのものがビンになる
    expect(labelsOf(agg)).toEqual(['1,000円', '2,000円', '3,000円']);
    expect(agg.items.every((item) => item.count === 1)).toBe(true);
    // 分母は validResponses(4)
    expect(agg.items[0].percentage).toBe(25);
  });

  it('free は items を空にし、抜粋を最大20件・各200字で持つ', () => {
    const q = makeQuestion({
      key: 'free-comment',
      columnIndex: 0,
      header: '自由記述',
      kind: 'free',
      chart: 'none',
    });
    const long = 'あ'.repeat(250);
    const rows = [[long], ...Array.from({ length: 24 }, (_, i) => [`コメント${i}`]), ['']];
    const ds = makeDataset({ headers: ['自由記述'], questions: [q], rows });
    const agg = aggregateQuestion(ds, q);

    expect(agg.validResponses).toBe(25);
    expect(agg.blankResponses).toBe(1);
    expect(agg.items).toEqual([]);
    expect(agg.freeTextSamples?.length).toBe(20);
    expect(agg.freeTextSamples?.[0].length).toBe(200);
  });
});

describe('aggregateAll', () => {
  it('全体件数と generator を返し、ignore の質問は含めない', () => {
    const gender = makeQuestion({
      key: 'gender',
      columnIndex: 0,
      header: '性別',
      label: '性別',
      order: 'count',
    });
    const stamp = makeQuestion({
      key: 'timestamp',
      columnIndex: 1,
      header: 'タイムスタンプ',
      kind: 'ignore',
      chart: 'none',
    });
    const ds = makeDataset({
      headers: ['性別', 'タイムスタンプ'],
      questions: [gender, stamp],
      rows: [
        ['女性', '2024/01/01'],
        ['男性', '2024/01/02'],
        { values: ['女性', '2024/01/03'], included: false },
      ],
      sourceName: 'テストデータ.csv',
    });
    const result = aggregateAll(ds);

    expect(result.generator).toBe('crowdworks-ai-survey-analyzer v1.0.0');
    expect(result.sourceName).toBe('テストデータ.csv');
    expect(result.totalResponses).toBe(3);
    expect(result.includedResponses).toBe(2);
    expect(result.excludedResponses).toBe(1);
    expect(result.questions.map((q) => q.key)).toEqual(['gender']);
    expect(result.questions[0].validResponses).toBe(2);
    // ローカルタイムゾーンオフセット付きの ISO 8601
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});
