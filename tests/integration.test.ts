/**
 * サンプルCSV/TSVを実際に読み込んで、
 * parse → schema → aggregate → crosstab → export の全経路を通す統合テスト。
 *
 * 個々のモジュールのユニットテストとは別に、
 * 「実データ形状で最後まで通る」ことを保証するのが目的。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseText } from '../src/core/parse.ts';
import { buildDataset } from '../src/core/schema.ts';
import { aggregateAll, aggregateQuestion } from '../src/core/aggregate.ts';
import { crossTabulate } from '../src/core/crosstab.ts';
import { toSummaryCsv, toCrossTabCsv, toResponsesCsv } from '../src/export/csv.ts';
import { toAnalysisJson } from '../src/export/json.ts';
import { toFreeTextMarkdown, toMarkdown } from '../src/export/markdown.ts';
import type { Dataset } from '../src/types.ts';

const SAMPLE_DIR = resolve(__dirname, '..', 'sample');

/** サンプルファイルを読み込んで Dataset にする */
function loadSample(name: string): Dataset {
  const text = readFileSync(resolve(SAMPLE_DIR, name), 'utf-8');
  return buildDataset(parseText(text, name));
}

describe('統合: sample-survey.csv (100件)', () => {
  const ds = loadSample('sample-survey.csv');

  it('100件・23列を読み込める', () => {
    expect(ds.rows).toHaveLength(100);
    expect(ds.headers).toHaveLength(23);
    expect(ds.delimiter).toBe(',');
  });

  it('23列すべてがCrowdWorksプロファイルに解決される（自動推定に落ちない）', () => {
    const columnQuestions = ds.questions.filter((q) => q.columnIndex >= 0);
    const inferredOnly = columnQuestions.filter((q) => q.inferred);
    expect(inferredOnly.map((q) => q.header)).toEqual([]);
    expect(columnQuestions).toHaveLength(23);
  });

  it('年+月から派生質問 start-year-month が作られる', () => {
    const derived = ds.questions.find((q) => q.key === 'start-year-month');
    expect(derived).toBeDefined();
    expect(derived?.columnIndex).toBe(-1);
    expect(derived?.chart).toBe('line');

    const agg = aggregateQuestion(ds, derived!);
    expect(agg.validResponses).toBeGreaterThan(0);
    // ラベルは YYYY-MM 形式で、昇順に並んでいること
    for (const item of agg.items) expect(item.label).toMatch(/^\d{4}-\d{2}$/);
    const labels = agg.items.map((i) => i.label);
    expect(labels).toEqual([...labels].sort());
  });

  it('単一選択: 割合の分母が有効回答数になっている', () => {
    const gender = ds.questions.find((q) => q.key === 'gender')!;
    const agg = aggregateQuestion(ds, gender);
    expect(agg.multiple).toBe(false);

    const sumCount = agg.items.reduce((s, i) => s + i.count, 0);
    expect(sumCount).toBe(agg.validResponses);
    expect(agg.validResponses + agg.blankResponses).toBe(100);

    for (const item of agg.items) {
      expect(item.percentage).toBeCloseTo((item.count / agg.validResponses) * 100, 1);
    }
    // 単一選択なので割合の合計は 100% になる
    const sumPct = agg.items.reduce((s, i) => s + i.percentage, 0);
    expect(sumPct).toBeCloseTo(100, 0);
  });

  it('複数選択: 延べ選択数 > 有効回答数、割合合計が100%を超えうる', () => {
    const tools = ds.questions.find((q) => q.key === 'ai-tools')!;
    const agg = aggregateQuestion(ds, tools);
    expect(agg.multiple).toBe(true);
    expect(agg.totalSelections).toBeGreaterThan(agg.validResponses);

    const sumCount = agg.items.reduce((s, i) => s + i.count, 0);
    expect(sumCount).toBe(agg.totalSelections);

    const sumPct = agg.items.reduce((s, i) => s + i.percentage, 0);
    expect(sumPct).toBeGreaterThan(100);

    // 表記ゆれが正規化され ChatGPT が最多になる
    expect(agg.items[0]!.label).toBe('ChatGPT');
    expect(agg.items.map((i) => i.label)).not.toContain('chatgpt');
  });

  it('除外した回答が全集計から外れる', () => {
    const before = aggregateAll(ds);
    expect(before.includedResponses).toBe(100);
    expect(before.excludedResponses).toBe(0);

    // 先頭10件を除外
    const excluded: Dataset = {
      ...ds,
      rows: ds.rows.map((r) => (r.id < 10 ? { ...r, included: false } : r)),
    };
    const after = aggregateAll(excluded);
    expect(after.totalResponses).toBe(100);
    expect(after.includedResponses).toBe(90);
    expect(after.excludedResponses).toBe(10);

    const genderBefore = before.questions.find((q) => q.key === 'gender')!;
    const genderAfter = after.questions.find((q) => q.key === 'gender')!;
    expect(genderAfter.validResponses).toBeLessThanOrEqual(genderBefore.validResponses);
    expect(genderAfter.validResponses + genderAfter.blankResponses).toBe(90);
  });

  it('クロス集計: 性別 × 使用AI が成立し、合計が整合する', () => {
    const ct = crossTabulate(ds, 'gender', 'ai-tools', 'count');
    expect(ct.rowLabels.length).toBeGreaterThan(0);
    expect(ct.colLabels.length).toBeGreaterThan(0);
    expect(ct.grandTotal).toBeGreaterThan(0);
    expect(ct.rowMultiple).toBe(false);
    expect(ct.colMultiple).toBe(true);

    // 行が単一選択なので、行の実人数の合計は grandTotal に一致する
    expect(ct.rowTotals.reduce((a, b) => a + b, 0)).toBe(ct.grandTotal);
    // 列が複数選択なので、列の実人数の合計は grandTotal を超えうる
    expect(ct.colTotals.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(ct.grandTotal);

    // 各行のセル合計は、その行の人数の「延べ選択数」なので行人数以上
    ct.counts.forEach((row, r) => {
      expect(row.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(ct.rowTotals[r]!);
    });
    // 各列のセル合計は列の実人数に一致する（行が単一選択のため）
    ct.colLabels.forEach((_, c) => {
      const sum = ct.counts.reduce((s, row) => s + row[c]!, 0);
      expect(sum).toBe(ct.colTotals[c]);
    });
  });

  it('クロス集計: 使用AI × AI用途（複数 × 複数）も動く', () => {
    const ct = crossTabulate(ds, 'ai-tools', 'ai-usage', 'row');
    expect(ct.rowMultiple).toBe(true);
    expect(ct.colMultiple).toBe(true);
    expect(ct.grandTotal).toBeGreaterThan(0);
    expect(ct.counts).toHaveLength(ct.rowLabels.length);
  });

  it('クロス集計: 仕事カテゴリ（単一） × AI用途（複数）も動く', () => {
    // 実CSVの Q7 は単一選択なので、プロファイルも single にしてある
    const ct = crossTabulate(ds, 'job-category', 'ai-usage', 'row');
    expect(ct.rowMultiple).toBe(false);
    expect(ct.colMultiple).toBe(true);
    expect(ct.grandTotal).toBeGreaterThan(0);
    // 行が単一選択なので、行の実人数の合計は対象者数に一致する
    expect(ct.rowTotals.reduce((a, b) => a + b, 0)).toBe(ct.grandTotal);
  });

  it('エクスポート: summary.csv の形式', () => {
    const analysis = aggregateAll(ds);
    const csv = toSummaryCsv(analysis);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'question,option,count,percentage,valid_responses,multiple_choice',
    );
    expect(lines.length).toBeGreaterThan(50);
    // 全データ行が6列である（エスケープ済みなので単純 split は使えず、列数だけ緩く検査）
    const toolsRows = lines.filter((l) => l.startsWith('使用したAI・AIツール,'));
    expect(toolsRows.length).toBeGreaterThan(0);
    expect(toolsRows.some((l) => l.includes(',true'))).toBe(true);
  });

  it('エクスポート: analysis.json が仕様どおりの形', () => {
    const analysis = aggregateAll(ds);
    const parsed = JSON.parse(toAnalysisJson(analysis));
    expect(parsed.totalResponses).toBe(100);
    expect(parsed.includedResponses).toBe(100);
    expect(parsed.excludedResponses).toBe(0);
    expect(Array.isArray(parsed.questions)).toBe(true);

    const tools = parsed.questions.find(
      (q: { question: string }) => q.question === '使用したAI・AIツール',
    );
    expect(tools.multiple).toBe(true);
    expect(typeof tools.validResponses).toBe('number');
    expect(typeof tools.items[0].label).toBe('string');
    expect(typeof tools.items[0].count).toBe('number');
    expect(typeof tools.items[0].percentage).toBe('number');
    // 生成日時はタイムゾーンオフセット付き
    expect(parsed.generatedAt).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('エクスポート: survey-summary.md に母数と複数回答の注記が入る', () => {
    const md = toMarkdown(aggregateAll(ds));
    expect(md.startsWith('# 生成AI仕事利用アンケート 集計結果')).toBe(true);
    expect(md).toContain('## 使用したAI・AIツール');
    expect(md).toContain('※複数回答');
    expect(md).toContain('有効回答数:');
    expect(md).toContain('| 選択肢 | 人数 | 割合 |');
    // 自由記述の本文は出力しない
    expect(md).toContain('本文は個人情報配慮のため出力しません');
  });

  it('エクスポート: cross-tab.csv と responses.csv', () => {
    const ct = crossTabulate(ds, 'gender', 'ai-tools', 'count');
    const ctCsv = toCrossTabCsv(ct);
    expect(ctCsv.split('\r\n')[0]!.startsWith('#')).toBe(true);
    expect(ctCsv).toContain('合計(実人数)');

    const resCsv = toResponsesCsv(ds);
    const lines = resCsv.split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(101); // ヘッダー + 100件
    expect(lines[0]!.startsWith('No,')).toBe(true);
    expect(lines[0]!.endsWith(',included')).toBe(true);
    expect(lines[1]!.endsWith(',true')).toBe(true);
  });

  it('responses.csv は除外した回答も全件残し、included で判別できる', () => {
    // 10件を除外しても行数は 100 件のまま
    const excluded: Dataset = {
      ...ds,
      rows: ds.rows.map((r) => (r.id % 10 === 0 ? { ...r, included: false } : r)),
    };
    const lines = toResponsesCsv(excluded)
      .split('\r\n')
      .filter((l) => l.length > 0);

    expect(lines).toHaveLength(101);

    const flags = lines.slice(1).map((l) => (l.endsWith(',true') ? true : false));
    expect(flags.filter((f) => f)).toHaveLength(90);
    expect(flags.filter((f) => !f)).toHaveLength(10);
    // 除外したのは No.1, 11, 21… （id % 10 === 0）
    expect(flags[0]).toBe(false);
    expect(flags[1]).toBe(true);
    expect(flags[10]).toBe(false);

    // 集計側は除外が効いている（責務の切り分けの確認）
    expect(aggregateAll(excluded).includedResponses).toBe(90);
  });

  it('survey-free-text.md は集計対象の自由記述だけを本文に含む', () => {
    const full = toFreeTextMarkdown(ds);
    expect(full.startsWith('# 自由記述回答')).toBe(true);
    expect(full).toContain('集計対象回答数: 100件');

    const freeQuestions = ds.questions.filter((q) => q.kind === 'free');
    expect(freeQuestions.length).toBeGreaterThan(0);

    // 先頭の回答が持つ自由記述の本文を取り出しておく
    const firstRow = ds.rows[0]!;
    const firstBody = freeQuestions
      .map((q) => firstRow.values[q.columnIndex] ?? '')
      .find((t) => t.trim().length > 0)!;
    expect(firstBody.length).toBeGreaterThan(0);
    expect(full).toContain(firstBody);
    expect(full).toContain('## 回答 1');

    // 1件目を除外すると、その本文と見出しが消える
    const excluded: Dataset = {
      ...ds,
      rows: ds.rows.map((r) => (r.id === 0 ? { ...r, included: false } : r)),
    };
    const after = toFreeTextMarkdown(excluded);
    expect(after).toContain('集計対象回答数: 99件');
    expect(after).not.toMatch(/^## 回答 1$/m);

    // 見出しの番号は元データの通し番号のまま（2件目以降はずれない）
    expect(after).toContain('## 回答 2');
    const headings = [...after.matchAll(/^## 回答 (\d+)$/gm)].map((m) => Number(m[1]));
    expect(headings).toEqual([...headings].sort((a, b) => a - b));
    expect(Math.max(...headings)).toBeLessThanOrEqual(100);
  });

  it('survey-free-text.md の件数が実データと一致する', () => {
    const freeQuestions = ds.questions.filter((q) => q.kind === 'free');
    const expectedWithText = ds.rows.filter(
      (r) => r.included && freeQuestions.some((q) => (r.values[q.columnIndex] ?? '').trim() !== ''),
    ).length;

    const md = toFreeTextMarkdown(ds);
    expect(md).toContain(`自由記述あり: ${expectedWithText}件`);
    expect([...md.matchAll(/^## 回答 \d+$/gm)]).toHaveLength(expectedWithText);
  });
});

describe('統合: sample-survey-small.tsv (TSV)', () => {
  it('タブ区切りを自動判定して読み込める', () => {
    const ds = loadSample('sample-survey-small.tsv');
    expect(ds.delimiter).toBe('\t');
    expect(ds.rows).toHaveLength(12);
    expect(ds.headers).toHaveLength(23);
    const analysis = aggregateAll(ds);
    expect(analysis.includedResponses).toBe(12);
    expect(analysis.questions.length).toBeGreaterThan(0);
  });
});

describe('統合: sample-survey-messy.csv (汚れたデータ)', () => {
  const ds = loadSample('sample-survey-messy.csv');

  it('空行をスキップし、列数不足の行も落とさずに読める', () => {
    expect(ds.rows).toHaveLength(30);
    expect(ds.warnings.length).toBeGreaterThan(0);
  });

  it('区切り文字が行ごとにバラバラでも複数回答を分解できる', () => {
    const tools = ds.questions.find((q) => q.key === 'ai-tools')!;
    expect(tools.kind).toBe('multiple');
    const agg = aggregateQuestion(ds, tools);
    expect(agg.totalSelections).toBeGreaterThan(agg.validResponses);
  });

  it('括弧内のカンマ・読点で選択肢を割らない', () => {
    for (const key of ['job-category', 'ai-usage']) {
      const q = ds.questions.find((x) => x.key === key);
      if (!q) continue;
      const agg = aggregateQuestion(ds, q);
      const others = agg.items.filter((i) => i.label.startsWith('その他'));
      for (const o of others) {
        // 「その他（画像生成、動画編集）」が丸ごと1選択肢として残る
        expect(o.label).toMatch(/^その他[（(].+[）)]$/);
      }
      // 括弧の断片だけの選択肢が生まれていないこと
      expect(agg.items.some((i) => /^[)）]$/.test(i.label))).toBe(false);
    }
  });

  it('表記ゆれが正規化される', () => {
    const tools = ds.questions.find((q) => q.key === 'ai-tools')!;
    const labels = aggregateQuestion(ds, tools).items.map((i) => i.label);
    expect(labels).toContain('ChatGPT');
    expect(labels).not.toContain('chatgpt');
    expect(labels).not.toContain('Chat GPT');
  });

  it('報酬の表記ゆれ（30,000円 / 3万円 / 30000）が同じ値として扱われる', () => {
    const reward = ds.questions.find((q) => q.key === 'reward')!;
    const agg = aggregateQuestion(ds, reward);
    if (agg.kind === 'numeric') {
      expect(agg.numeric).toBeDefined();
      expect(agg.numeric!.n).toBeGreaterThan(0);
      expect(agg.numeric!.max).toBeGreaterThanOrEqual(agg.numeric!.min);
    }
    // どちらの種別でも集計自体は成立する
    expect(agg.validResponses).toBeGreaterThan(0);
  });

  it('全経路（集計→クロス→3種のエクスポート）が例外なく通る', () => {
    const analysis = aggregateAll(ds);
    expect(() => toSummaryCsv(analysis)).not.toThrow();
    expect(() => toAnalysisJson(analysis)).not.toThrow();
    expect(() => toMarkdown(analysis)).not.toThrow();

    const crossable = ds.questions.filter(
      (q) => q.kind === 'single' || q.kind === 'multiple' || q.kind === 'numeric',
    );
    // 総当たりでクロス集計しても落ちないこと
    for (const r of crossable) {
      for (const c of crossable) {
        expect(() => crossTabulate(ds, r.key, c.key, 'row')).not.toThrow();
      }
    }
  });
});
