/**
 * 出力対象の選択（QuestionDef.selected）と、
 * CrowdWorks の識別情報・管理列（QuestionDef.identity）のテスト。
 *
 * 確認したいのは「何がどこに効くか」の切り分け。
 *   selected … 基本集計・グラフ・summary.csv・analysis.json・survey-summary.md に効く
 *              responses.csv / survey-free-text.md / cross-tab.csv には効かない
 *   identity … 集計・グラフ・AI向け出力に一切載らず、
 *              回答一覧と responses.csv にだけ表示ONで出る
 *
 * 回答単位の included（集計対象／除外）とは別概念であることも併せて固定する。
 */

import { describe, expect, it } from 'vitest';

import { aggregateAll } from '../src/core/aggregate.ts';
import { crossTabulate } from '../src/core/crosstab.ts';
import {
  defaultIdentityVisibility,
  hiddenIdentityColumns,
  identityQuestions,
  visibleColumnIndexes,
} from '../src/core/identity.ts';
import { parseText } from '../src/core/parse.ts';
import { buildDataset } from '../src/core/schema.ts';
import { toResponsesCsv, toSummaryCsv } from '../src/export/csv.ts';
import { toAnalysisJson } from '../src/export/json.ts';
import { toFreeTextMarkdown, toMarkdown } from '../src/export/markdown.ts';
import type { AnalysisResult, Dataset, QuestionDef } from '../src/types.ts';
import { makeDataset, makeQuestion } from './helpers.ts';

/** 単一選択2問 + 複数回答1問 + 自由記述1問のデータセット */
function selectionDataset(): Dataset {
  return makeDataset({
    headers: ['性別', '年齢', '使用したAI', '自由記述'],
    questions: [
      makeQuestion({ key: 'gender', columnIndex: 0, label: '性別', order: 'count' }),
      makeQuestion({ key: 'age', columnIndex: 1, label: '年齢', order: 'natural' }),
      makeQuestion({
        key: 'ai-tools',
        columnIndex: 2,
        label: '使用したAI',
        kind: 'multiple',
        chart: 'hbar',
        order: 'count',
      }),
      makeQuestion({
        key: 'free-comment',
        columnIndex: 3,
        label: '自由記述',
        kind: 'free',
        chart: 'none',
        delimiters: [],
      }),
    ],
    rows: [
      ['女性', '20代', 'ChatGPT、Claude', '助かった'],
      ['男性', '30代', 'ChatGPT', '納期が短かった'],
      ['女性', '30代', 'Claude', ''],
      ['男性', '20代', 'ChatGPT', 'また使いたい'],
    ],
  });
}

/** key を指定して selected を切り替えた新しい Dataset を返す */
function withSelection(ds: Dataset, changes: Record<string, boolean>): Dataset {
  const questions: QuestionDef[] = ds.questions.map((q) =>
    q.key in changes ? { ...q, selected: changes[q.key]! } : q,
  );
  return { ...ds, questions };
}

/** 集計結果に含まれる質問ラベル */
function questionLabels(a: AnalysisResult): string[] {
  return a.questions.map((q) => q.question);
}

describe('出力対象の選択: 初期状態', () => {
  it('buildQuestions は全質問を selected=true で作る', () => {
    const csv = [
      'Q1. 年齢を教えてください,Q2. 性別を教えてください,Q12. 使用したAI・AIツール,自由記述',
      '20代,女性,ChatGPT,よかった',
      '30代,男性,Claude,ふつう',
    ].join('\n');
    const ds = buildDataset(parseText(csv, 'test.csv'));

    expect(ds.questions.length).toBeGreaterThan(0);
    for (const q of ds.questions) {
      expect(q.selected).toBe(true);
    }
  });

  it('初期状態では全質問が集計結果に出る', () => {
    const analysis = aggregateAll(selectionDataset());

    expect(questionLabels(analysis)).toEqual(['性別', '年齢', '使用したAI', '自由記述']);
  });

  it('派生質問（年月）も selected=true で作られ、外せる', () => {
    const csv = [
      'Q5. 仕事を受注した年,Q6. 仕事を受注した月',
      '2024,3',
      '2025,7',
    ].join('\n');
    const ds = buildDataset(parseText(csv, 'test.csv'));

    const derived = ds.questions.find((q) => q.key === 'start-year-month');
    expect(derived).toBeDefined();
    expect(derived!.selected).toBe(true);
    expect(questionLabels(aggregateAll(ds))).toContain('仕事を受注・開始した年月');

    const off = withSelection(ds, { 'start-year-month': false });
    expect(questionLabels(aggregateAll(off))).not.toContain('仕事を受注・開始した年月');
  });
});

describe('出力対象の選択: 1問外したときの影響範囲', () => {
  const ds = selectionDataset();
  const off = withSelection(ds, { gender: false });

  it('基本集計（AnalysisResult.questions）から消える', () => {
    expect(questionLabels(aggregateAll(ds))).toContain('性別');
    expect(questionLabels(aggregateAll(off))).not.toContain('性別');
  });

  it('基本集計の表示対象（selected な質問）と集計結果が一致する', () => {
    // 基本集計セクションは ds.questions を回して表を並べるので、
    // 絞り込み条件が AnalysisResult と食い違うと「表はあるのに中身が無い」状態になる。
    // 画面の絞り込み条件をここで固定しておく。
    const displayed = (d: Dataset) =>
      d.questions.filter((q) => q.kind !== 'ignore' && q.selected).map((q) => q.label);

    expect(displayed(off)).toEqual(questionLabels(aggregateAll(off)));
    expect(displayed(off)).not.toContain('性別');
    expect(displayed(ds)).toEqual(questionLabels(aggregateAll(ds)));
  });

  it('グラフの対象から消える（chart!=="none" の集計が減る）', () => {
    const chartable = (d: Dataset) =>
      aggregateAll(d)
        .questions.filter((q) => q.kind !== 'free')
        .map((q) => q.question);

    expect(chartable(ds)).toContain('性別');
    expect(chartable(off)).not.toContain('性別');
    // 外していない質問のグラフは残る
    expect(chartable(off)).toContain('年齢');
    expect(chartable(off)).toContain('使用したAI');
  });

  it('summary.csv から消える', () => {
    expect(toSummaryCsv(aggregateAll(ds))).toContain('性別,女性');
    const csv = toSummaryCsv(aggregateAll(off));
    expect(csv).not.toContain('性別,女性');
    expect(csv).toContain('年齢,');
  });

  it('analysis.json の questions から消える', () => {
    const parsed = JSON.parse(toAnalysisJson(aggregateAll(off))) as AnalysisResult;

    expect(parsed.questions.map((q) => q.key)).not.toContain('gender');
    expect(parsed.questions.map((q) => q.key)).toContain('age');
    // 回答件数そのものは減らない（設問を外しただけで回答は消えない）
    expect(parsed.totalResponses).toBe(4);
    expect(parsed.includedResponses).toBe(4);
  });

  it('survey-summary.md から消える', () => {
    expect(toMarkdown(aggregateAll(ds))).toContain('## 性別');
    const md = toMarkdown(aggregateAll(off));
    expect(md).not.toContain('## 性別');
    expect(md).toContain('## 年齢');
  });

  it('一括PNGの対象から消える（PNG化されるのは集計に残った質問だけ）', () => {
    // 一括PNGは「画面に出ているグラフ」を保存する。
    // 画面のグラフは AnalysisResult から作られるので、集計に無い質問は対象外になる。
    const pngTargets = (d: Dataset) =>
      aggregateAll(d)
        .questions.filter((q) => q.items.length > 0)
        .map((q) => q.key);

    expect(pngTargets(ds)).toContain('gender');
    expect(pngTargets(off)).not.toContain('gender');
    expect(pngTargets(off)).toContain('ai-tools');
  });

  it('responses.csv にはその列が残る', () => {
    const lines = toResponsesCsv(off).split('\r\n');

    expect(lines[0]).toBe('No,性別,年齢,使用したAI,自由記述,included');
    // 読点はCSVの特殊文字ではないのでクォートされない
    expect(lines[1]).toBe('1,女性,20代,ChatGPT、Claude,助かった,true');
    // 行数も減らない
    expect(lines.filter((l) => l.length > 0)).toHaveLength(5);
  });

  it('survey-free-text.md には影響しない', () => {
    const before = toFreeTextMarkdown(ds);
    const after = toFreeTextMarkdown(off);

    expect(after).toBe(before);
    expect(after).toContain('助かった');
    expect(after).toContain('納期が短かった');
  });

  it('自由記述を出力対象から外しても survey-free-text.md は変わらない', () => {
    const freeOff = withSelection(ds, { 'free-comment': false });

    // survey-summary.md からは消える
    expect(toMarkdown(aggregateAll(freeOff))).not.toContain('## 自由記述');
    // survey-free-text.md は監査・定性分析用なので影響を受けない
    expect(toFreeTextMarkdown(freeOff)).toBe(toFreeTextMarkdown(ds));
  });

  it('cross-tab.csv には影響しない', () => {
    const before = crossTabulate(ds, 'gender', 'ai-tools', 'count');
    const after = crossTabulate(off, 'gender', 'ai-tools', 'count');

    expect(after.rowLabels).toEqual(before.rowLabels);
    expect(after.colLabels).toEqual(before.colLabels);
    expect(after.counts).toEqual(before.counts);
    expect(after.grandTotal).toBe(before.grandTotal);
  });
});

describe('出力対象の選択: すべて選択 / すべて解除', () => {
  const ds = selectionDataset();
  const allKeys = ds.questions.map((q) => q.key);

  it('すべて解除すると集計結果が空になる', () => {
    const none = withSelection(ds, Object.fromEntries(allKeys.map((k) => [k, false])));
    const analysis = aggregateAll(none);

    expect(analysis.questions).toEqual([]);
    expect(toMarkdown(analysis)).not.toContain('## 性別');
    expect(toSummaryCsv(analysis).split('\r\n')).toHaveLength(1); // ヘッダーのみ
    // 回答件数は保持される
    expect(analysis.totalResponses).toBe(4);
    expect(analysis.includedResponses).toBe(4);
  });

  it('すべて解除しても responses.csv / survey-free-text.md / cross-tab.csv は保たれる', () => {
    const none = withSelection(ds, Object.fromEntries(allKeys.map((k) => [k, false])));

    expect(toResponsesCsv(none)).toBe(toResponsesCsv(ds));
    expect(toFreeTextMarkdown(none)).toBe(toFreeTextMarkdown(ds));
    expect(crossTabulate(none, 'gender', 'ai-tools', 'count').counts).toEqual(
      crossTabulate(ds, 'gender', 'ai-tools', 'count').counts,
    );
  });

  it('すべて解除したあとすべて選択すると元に戻る', () => {
    const none = withSelection(ds, Object.fromEntries(allKeys.map((k) => [k, false])));
    const all = withSelection(none, Object.fromEntries(allKeys.map((k) => [k, true])));

    expect(questionLabels(aggregateAll(all))).toEqual(questionLabels(aggregateAll(ds)));
    expect(toSummaryCsv(aggregateAll(all))).toBe(toSummaryCsv(aggregateAll(ds)));
  });
});

describe('出力対象の選択と 集計対象/除外 は別概念', () => {
  const ds = selectionDataset();

  it('回答を除外しても設問は消えず、母数だけが減る', () => {
    const excluded: Dataset = {
      ...ds,
      rows: ds.rows.map((r) => (r.id === 0 ? { ...r, included: false } : r)),
    };
    const analysis = aggregateAll(excluded);

    expect(questionLabels(analysis)).toEqual(['性別', '年齢', '使用したAI', '自由記述']);
    expect(analysis.includedResponses).toBe(3);
    expect(analysis.questions.find((q) => q.key === 'gender')!.validResponses).toBe(3);
  });

  it('設問を外しても回答件数は減らない', () => {
    const off = withSelection(ds, { gender: false });
    const analysis = aggregateAll(off);

    expect(analysis.totalResponses).toBe(4);
    expect(analysis.includedResponses).toBe(4);
    expect(analysis.excludedResponses).toBe(0);
  });

  it('両方を同時に使える（回答1件除外 + 設問1つ非表示）', () => {
    const both: Dataset = {
      ...withSelection(ds, { gender: false }),
      rows: ds.rows.map((r) => (r.id === 0 ? { ...r, included: false } : r)),
    };
    const analysis = aggregateAll(both);

    expect(questionLabels(analysis)).not.toContain('性別');
    expect(analysis.includedResponses).toBe(3);
    expect(analysis.questions.find((q) => q.key === 'age')!.validResponses).toBe(3);
  });
});

// ── 識別情報・管理列 ───────────────────────────────────────────

/** 管理列4つ + 設問2つの CSV から Dataset を作る */
function identityDataset(): Dataset {
  const csv = [
    '作業ID,作業者名,作業者ページURL,承認日時,Q2. 性別を教えてください,Q1. 年齢を教えてください',
    'W-001,テスト太郎,https://example.invalid/u/1,2026-01-05 10:00,女性,20代',
    'W-002,テスト花子,https://example.invalid/u/2,2026-01-06 11:00,男性,30代',
    'W-003,テスト次郎,https://example.invalid/u/3,2026-01-07 12:00,女性,40代',
  ].join('\n');
  return buildDataset(parseText(csv, 'crowdworks.csv'));
}

describe('識別情報・管理列', () => {
  const ds = identityDataset();

  it('4つの管理列が識別情報として認識される', () => {
    const found = ds.questions.filter((q) => q.identity).map((q) => q.identity);

    expect(found).toEqual(
      expect.arrayContaining(['worker-id', 'worker-name', 'worker-url', 'approved-at']),
    );
    expect(identityQuestions(ds).map((q) => q.identity)).toEqual([
      'worker-name',
      'worker-url',
      'worker-id',
      'approved-at',
    ]);
  });

  it('管理列は必ず kind=ignore で、集計・グラフに載らない', () => {
    for (const q of ds.questions.filter((x) => x.identity)) {
      expect(q.kind).toBe('ignore');
    }
    const labels = questionLabels(aggregateAll(ds));
    expect(labels).not.toContain('作業者名');
    expect(labels).not.toContain('作業者ページURL');
    expect(labels).not.toContain('作業ID');
    expect(labels).not.toContain('承認日時');
    // 通常の設問は集計される
    expect(labels).toContain('性別');
    expect(labels).toContain('年齢');
  });

  it('summary.csv / analysis.json / survey-summary.md / survey-free-text.md に個人情報が出ない', () => {
    const analysis = aggregateAll(ds);
    const outputs = [
      toSummaryCsv(analysis),
      toAnalysisJson(analysis),
      toMarkdown(analysis),
      toFreeTextMarkdown(ds),
    ];

    for (const text of outputs) {
      expect(text).not.toContain('テスト太郎');
      expect(text).not.toContain('example.invalid');
      expect(text).not.toContain('W-001');
      expect(text).not.toContain('作業者名');
    }
  });

  it('cross-tab.csv の軸にも使えない（kind=ignore なので空結果）', () => {
    const ct = crossTabulate(ds, 'worker-name', 'gender', 'count');

    expect(ct.rowLabels).toEqual([]);
    expect(ct.grandTotal).toBe(0);
  });

  it('既定では個人を特定しうる3列が非表示、承認日時は表示', () => {
    const visibility = defaultIdentityVisibility();

    expect(visibility['worker-name']).toBe(false);
    expect(visibility['worker-url']).toBe(false);
    expect(visibility['worker-id']).toBe(false);
    expect(visibility['approved-at']).toBe(true);
  });

  it('既定では responses.csv から個人情報の列が落ちる', () => {
    const hidden = hiddenIdentityColumns(ds, defaultIdentityVisibility());
    const lines = toResponsesCsv(ds, hidden).split('\r\n');

    expect(lines[0]).toBe(
      'No,承認日時,Q2. 性別を教えてください,Q1. 年齢を教えてください,included',
    );
    expect(lines[1]).toBe('1,2026-01-05 10:00,女性,20代,true');
    // 回答は全件残る
    expect(lines.filter((l) => l.length > 0)).toHaveLength(4);
  });

  it('表示をONにすると responses.csv に列が戻る', () => {
    const visibility = { ...defaultIdentityVisibility(), 'worker-name': true, 'worker-id': true };
    const lines = toResponsesCsv(ds, hiddenIdentityColumns(ds, visibility)).split('\r\n');

    expect(lines[0]).toBe(
      'No,作業ID,作業者名,承認日時,Q2. 性別を教えてください,Q1. 年齢を教えてください,included',
    );
    expect(lines[1]).toBe('1,W-001,テスト太郎,2026-01-05 10:00,女性,20代,true');
    // URL はOFFのままなので出ない
    expect(lines[0]).not.toContain('作業者ページURL');
    expect(lines[1]).not.toContain('example.invalid');
  });

  it('列を落としても No と included は保たれる（集計対象の切り替えに支障がない）', () => {
    const excluded: Dataset = {
      ...ds,
      rows: ds.rows.map((r) => (r.id === 1 ? { ...r, included: false } : r)),
    };
    const lines = toResponsesCsv(excluded, hiddenIdentityColumns(ds, defaultIdentityVisibility()))
      .split('\r\n')
      .filter((l) => l.length > 0);

    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['1', '2', '3']);
    expect(lines.slice(1).map((l) => l.split(',').at(-1))).toEqual(['true', 'false', 'true']);
    // 除外は集計にだけ効く
    expect(aggregateAll(excluded).includedResponses).toBe(2);
  });

  it('回答一覧に出す列も表示状態に従う', () => {
    const hiddenAll = visibleColumnIndexes(ds, defaultIdentityVisibility());
    const shown = { ...defaultIdentityVisibility(), 'worker-name': true, 'worker-url': true, 'worker-id': true };
    const visibleAll = visibleColumnIndexes(ds, shown);

    // 既定は 6列中3列（承認日時 + 設問2つ）
    expect(hiddenAll).toHaveLength(3);
    expect(hiddenAll.map((i) => ds.headers[i])).toEqual([
      '承認日時',
      'Q2. 性別を教えてください',
      'Q1. 年齢を教えてください',
    ]);
    // 全部ONなら6列すべて
    expect(visibleAll).toHaveLength(6);
  });

  it('管理列が無いデータでは識別情報が空になる', () => {
    const plain = selectionDataset();

    expect(identityQuestions(plain)).toEqual([]);
    expect(hiddenIdentityColumns(plain, defaultIdentityVisibility()).size).toBe(0);
    expect(visibleColumnIndexes(plain, defaultIdentityVisibility())).toEqual([0, 1, 2, 3]);
  });
});
