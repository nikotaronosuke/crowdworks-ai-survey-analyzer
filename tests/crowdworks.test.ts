/**
 * CrowdWorks 実CSV形式アダプターのテスト。
 *
 * CrowdWorks は選択式設問を「選択肢番号の列 + ヘッダーが空欄のラベル列」の
 * 2列セットで出力する。ここでは
 *   - その2列セットを1列へ畳み込めること
 *   - 枝番付き（12-1, 12-2, …）を1つの複数選択へ束ねること
 *   - 選択肢番号を捨てて人間可読なラベルを使うこと
 *   - 回答件数が変わらないこと
 *   - 通常CSVを誤検出しないこと
 * を固定する。
 */

import { describe, expect, it } from 'vitest';

import {
  CROWDWORKS_MANAGEMENT_HEADERS,
  isCrowdWorksTable,
  normalizeCrowdWorksTable,
} from '../src/core/adapters/crowdworks.ts';
import { aggregateAll, aggregateQuestion } from '../src/core/aggregate.ts';
import { crossTabulate } from '../src/core/crosstab.ts';
import { defaultIdentityVisibility, hiddenIdentityColumns } from '../src/core/identity.ts';
import { parseText } from '../src/core/parse.ts';
import { buildDataset } from '../src/core/schema.ts';
import { toResponsesCsv, toSummaryCsv } from '../src/export/csv.ts';
import { UNPARSED_LABEL, WORK_MINUTES_BINS } from '../src/core/worktime.ts';
import { toAnalysisJson } from '../src/export/json.ts';
import { toFreeTextMarkdown, toMarkdown } from '../src/export/markdown.ts';
import type { Dataset, RawTable } from '../src/types.ts';
import {
  CROWDWORKS_FIXTURE_COLUMNS,
  CROWDWORKS_FIXTURE_QUESTIONS,
  makeCrowdWorksCsv,
} from './fixtures/crowdworks.ts';

/** fixture を読み込んで生テーブルにする */
function rawFixture(count = 52): RawTable {
  return parseText(makeCrowdWorksCsv(count), 'crowdworks.csv');
}

/** fixture を読み込んで Dataset にする（buildDataset が自動で正規化する） */
function fixtureDataset(count = 52): Dataset {
  return buildDataset(rawFixture(count));
}

/** 小さな CrowdWorks 風テーブルを手で組み立てる（境界条件の確認用） */
function tinyTable(headers: string[], rows: string[][]): RawTable {
  const body = [headers.map((h) => `"${h}"`).join(',')];
  for (const row of rows) body.push(row.map((c) => `"${c}"`).join(','));
  return parseText(body.join('\n'), 'tiny.csv');
}

/** 管理列4つ + 指定の設問列を持つヘッダーを作る */
function withManagement(extra: string[]): string[] {
  return [...CROWDWORKS_MANAGEMENT_HEADERS, ...extra];
}

/** 管理列4つ分のダミー値 */
const MGMT = ['W-1', 'ダミー作業者', 'https://example.invalid/u/1', '2026-01-05 10:00'];

describe('CrowdWorks形式の自動判定', () => {
  it('管理列4つ + 枝番付きヘッダーがあれば CrowdWorks 形式と判定する', () => {
    expect(isCrowdWorksTable(rawFixture(3))).toBe(true);
  });

  it('管理列4つ + 番号付きヘッダーの直後が空ヘッダーでも判定する', () => {
    const table = tinyTable(withManagement(['1. 年齢', '']), [[...MGMT, '4', '45～54']]);

    expect(isCrowdWorksTable(table)).toBe(true);
  });

  it('管理列が欠けていれば CrowdWorks 形式と判定しない', () => {
    // 作業者ページURL が無い
    const table = tinyTable(['作業ID', '作業者', '承認日時', '1. 年齢', ''], [
      ['W-1', 'ダミー', '2026-01-05', '4', '45～54'],
    ]);

    expect(isCrowdWorksTable(table)).toBe(false);
  });

  it('管理列があっても CrowdWorks 特有のヘッダーが無ければ判定しない', () => {
    const table = tinyTable(withManagement(['年齢', '性別']), [[...MGMT, '45～54', '男性']]);

    expect(isCrowdWorksTable(table)).toBe(false);
  });

  it('通常のCSVは誤検出しない（従来どおり汎用パーサーで扱う）', () => {
    const table = tinyTable(['性別', '年齢', '使用したAI'], [['女性', '20代', 'ChatGPT']]);

    expect(isCrowdWorksTable(table)).toBe(false);
    const ds = buildDataset(table);
    expect(ds.sourceFormat).toBe('generic');
    expect(ds.headers).toEqual(['性別', '年齢', '使用したAI']);
  });

  it('空のテーブルでは判定しない', () => {
    expect(isCrowdWorksTable(parseText('', 'empty.csv'))).toBe(false);
  });

  it('buildDataset が検出結果を sourceFormat に載せる', () => {
    expect(fixtureDataset(5).sourceFormat).toBe('crowdworks');
  });
});

describe('2列セットの単一選択変換', () => {
  it('選択肢番号を捨てて右のラベル列の値を使う', () => {
    const table = tinyTable(withManagement(['1. 年齢', '', '2. 性別', '']), [
      [...MGMT, '4', '45～54', '1', '男性'],
      [...MGMT, '1', '18～24', '2', '女性'],
    ]);
    const normalized = normalizeCrowdWorksTable(table);

    expect(normalized.headers).toEqual([...CROWDWORKS_MANAGEMENT_HEADERS, '1. 年齢', '2. 性別']);
    // 単一選択のセルは元の値をそのまま残す（表記の正規化は集計時に行う）。
    // 自由入力列の改行や記号を読み込み層で壊さないための設計。
    expect(normalized.rows[0]!.slice(4)).toEqual(['45～54', '男性']);
    expect(normalized.rows[1]!.slice(4)).toEqual(['18～24', '女性']);
  });

  it('空ヘッダー列を単独の質問として生成しない', () => {
    const ds = fixtureDataset(5);

    // "列5" のような自動命名の列が残っていないこと
    expect(ds.headers.filter((h) => /^列\d+$/.test(h))).toEqual([]);
    for (const q of ds.questions) {
      expect(q.header).not.toMatch(/^列\d+$/);
    }
  });

  it('年齢が選択肢番号ではなくラベルになる', () => {
    const ds = fixtureDataset();
    const age = aggregateQuestion(ds, ds.questions.find((q) => q.key === 'age')!);

    expect(age.items.length).toBeGreaterThan(0);
    for (const item of age.items) {
      expect(item.label).toMatch(/^\d+~\d+$/); // "18~24" 等
      expect(item.label).not.toMatch(/^\d$/); // 選択肢番号そのものではない
    }
  });

  it('性別が「男性」「女性」になる', () => {
    const ds = fixtureDataset();
    const gender = aggregateQuestion(ds, ds.questions.find((q) => q.key === 'gender')!);

    expect(gender.items).toHaveLength(2);
    expect(gender.items.map((i) => i.label)).toEqual(expect.arrayContaining(['男性', '女性']));
    expect(gender.items.reduce((s, i) => s + i.count, 0)).toBe(52);
  });
});

describe('複数選択グループの統合', () => {
  it('枝番付きの2列セットを1つの複数選択へ束ねる', () => {
    const table = tinyTable(
      withManagement([
        '12-1. 使用したAI・AIツール（複数選択可）',
        '',
        '12-2. 使用したAI・AIツール（複数選択可）',
        '',
        '12-3. 使用したAI・AIツール（複数選択可）',
        '',
      ]),
      [
        // 1つ目と3つ目だけ選択（2つ目は未選択で両方空）
        [...MGMT, '1', 'ChatGPT', '', '', '3', 'Gemini'],
      ],
    );
    const normalized = normalizeCrowdWorksTable(table);

    // ヘッダーは normalizeText を通すので、NFKC で全角括弧が半角になる
    expect(normalized.headers).toEqual([
      ...CROWDWORKS_MANAGEMENT_HEADERS,
      '12. 使用したAI・AIツール(複数選択可)',
    ]);
    // 改行区切りで結合される（選択肢ラベルに読点やカンマが入っても壊れない）
    expect(normalized.rows[0]![4]).toBe('ChatGPT\nGemini');
  });

  it('未選択セルは無視される', () => {
    const table = tinyTable(
      withManagement(['12-1. 使用したAI', '', '12-2. 使用したAI', '']),
      [[...MGMT, '', '', '2', 'Claude']],
    );
    const normalized = normalizeCrowdWorksTable(table);

    expect(normalized.rows[0]![4]).toBe('Claude');
  });

  it('全部未選択なら空セルになる（回答なし扱い）', () => {
    const table = tinyTable(
      withManagement(['12-1. 使用したAI', '', '12-2. 使用したAI', '']),
      [[...MGMT, '', '', '', '']],
    );
    const normalized = normalizeCrowdWorksTable(table);

    expect(normalized.rows[0]![4]).toBe('');
  });

  it('同じ選択肢が重複していても1回だけ数える', () => {
    const table = tinyTable(
      withManagement(['12-1. 使用したAI', '', '12-2. 使用したAI', '']),
      [[...MGMT, '1', 'ChatGPT', '1', 'ChatGPT']],
    );

    expect(normalizeCrowdWorksTable(table).rows[0]![4]).toBe('ChatGPT');
  });

  it('複数選択グループは種別が multiple に固定される（プロファイルが single/free でも）', () => {
    const ds = fixtureDataset(10);

    // occupation はプロファイル上 single、job-detail は free だが、
    // 実データが枝番付きの複数選択なので multiple になる
    expect(ds.questions.find((q) => q.key === 'occupation')!.kind).toBe('multiple');
    expect(ds.questions.find((q) => q.key === 'job-detail')!.kind).toBe('multiple');
    expect(ds.questions.find((q) => q.key === 'channel')!.kind).toBe('multiple');
    expect(ds.questions.find((q) => q.key === 'ai-tools')!.kind).toBe('multiple');
    expect(ds.questions.find((q) => q.key === 'ai-usage')!.kind).toBe('multiple');
  });

  it('枝番なしの2列セットは単一選択に固定される', () => {
    const ds = fixtureDataset(10);

    // 実CSVの Q7「仕事の主なカテゴリ」は枝番なし＝単一選択
    expect(ds.questions.find((q) => q.key === 'job-category')!.kind).toBe('single');
    expect(ds.questions.find((q) => q.key === 'age')!.kind).toBe('single');
    expect(ds.questions.find((q) => q.key === 'gender')!.kind).toBe('single');
    expect(ds.questions.find((q) => q.key === 'reward')!.kind).toBe('single');
  });

  it('選択肢に非数値が混じっても月の設問が数値集計に化けない', () => {
    // 実CSVの Q6 には "覚えていない" が混じり、異なり13・ほぼ数値になる。
    // 2列セット＝単一選択と構造で確定させているので numeric へ落ちない。
    const table = tinyTable(
      withManagement(['6. その仕事を受注・開始した月', '']),
      Array.from({ length: 13 }, (_, i) =>
        i === 12 ? [...MGMT, '13', '覚えていない'] : [...MGMT, String(i + 1), `${i + 1}月`],
      ),
    );
    const ds = buildDataset(table);
    const month = ds.questions.find((q) => q.key === 'start-month')!;

    expect(month.kind).toBe('single');
    const agg = aggregateQuestion(ds, month);
    expect(agg.items.map((i) => i.label)).toContain('覚えていない');
    // プリセット順（1月→12月）が先、preset に無い "覚えていない" は末尾
    expect(agg.items[0]!.label).toBe('1月');
    expect(agg.items.at(-1)!.label).toBe('覚えていない');
  });

  it('ペアにならない1列（自由入力）は種別を固定しない', () => {
    const table = tinyTable(withManagement(['11. 実際の作業時間', '13. 一番使ったAI']), [
      [...MGMT, '約3時間', 'chatGPT'],
    ]);
    const norm = normalizeCrowdWorksTable(table);

    // 管理列4つのあとの2列は自由入力なので forcedKinds に載らない
    expect(norm.forcedKinds?.[4]).toBeUndefined();
    expect(norm.forcedKinds?.[5]).toBeUndefined();
  });

  it('複数選択に矯正された設問はグラフ種別も横棒になる', () => {
    const ds = fixtureDataset(10);

    // job-detail のプロファイル chart は 'none' だが、複数選択なので描ける
    expect(ds.questions.find((q) => q.key === 'job-detail')!.chart).toBe('hbar');
    expect(ds.questions.find((q) => q.key === 'occupation')!.chart).toBe('hbar');
  });

  it('職種・仕事内容・使用AI・AI用途が1人分に統合される', () => {
    const ds = fixtureDataset();

    for (const key of ['occupation', 'job-detail', 'ai-tools', 'ai-usage']) {
      const agg = aggregateQuestion(ds, ds.questions.find((q) => q.key === key)!);
      expect(agg.multiple).toBe(true);
      // 1人が複数選ぶので、延べ選択数は回答者数を上回る
      expect(agg.totalSelections).toBeGreaterThan(agg.validResponses);
      // 選択肢は fixture で定義した数を超えない（＝取りこぼしも増殖もしない）
      expect(agg.items.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('同じ設問番号の枝番を誤統合しない', () => {
  it('番号が違えば別設問（3-1 と 13-1 を混ぜない）', () => {
    const table = tinyTable(
      withManagement(['3-1. 現在の職種', '', '13-1. 別の設問', '']),
      [[...MGMT, '1', '会社員', '1', '別の回答']],
    );
    const normalized = normalizeCrowdWorksTable(table);

    expect(normalized.headers.slice(4)).toEqual(['3. 現在の職種', '13. 別の設問']);
    expect(normalized.rows[0]!.slice(4)).toEqual(['会社員', '別の回答']);
  });

  it('枝番なしと枝番ありは別設問（1. と 1-1. を混ぜない）', () => {
    const table = tinyTable(
      withManagement(['1. 年齢', '', '1-1. 別の複数選択', '']),
      [[...MGMT, '4', '45～54', '1', '選択A']],
    );
    const normalized = normalizeCrowdWorksTable(table);

    expect(normalized.headers.slice(4)).toEqual(['1. 年齢', '1. 別の複数選択']);
    expect(normalized.rows[0]!.slice(4)).toEqual(['45～54', '選択A']);
  });
});

describe('自由入力列の保持', () => {
  it('番号付きでも空ヘッダー列が続かなければ値をそのまま保持する', () => {
    const table = tinyTable(withManagement(['11. 実際の作業時間', '13. 一番使ったAI']), [
      [...MGMT, '約3時間', 'chatGPT'],
    ]);
    const normalized = normalizeCrowdWorksTable(table);

    expect(normalized.headers.slice(4)).toEqual(['11. 実際の作業時間', '13. 一番使ったAI']);
    expect(normalized.rows[0]!.slice(4)).toEqual(['約3時間', 'chatGPT']);
  });

  it('作業時間の改行を壊さない', () => {
    const ds = fixtureDataset();
    const column = ds.questions.find((q) => q.key === 'work-hours')!.columnIndex;
    const multiline = ds.rows.map((r) => r.values[column] ?? '').filter((v) => v.includes('\n'));

    expect(multiline.length).toBeGreaterThan(0);
    expect(multiline[0]).toContain('約3時間');
    expect(multiline[0]).toContain('（調査含む）');
  });

  it('自由記述の改行・読点を壊さない', () => {
    const ds = fixtureDataset();
    const md = toFreeTextMarkdown(ds);

    expect(md).toContain('AIのおかげで時短になった。');
    expect(md).toContain('ただし事実確認は必須です、と感じました。');
  });

  it('一番使ったAIの自由入力を保持しつつ、主要な表記ゆれだけ正規化する', () => {
    const ds = fixtureDataset();
    const main = aggregateQuestion(ds, ds.questions.find((q) => q.key === 'main-ai')!);
    const labels = main.items.map((i) => i.label);

    // ChatGPT / chatGPT / Chat GPT / チャットGPT / chat gpt が1つに寄る
    expect(labels).toContain('ChatGPT');
    expect(labels).not.toContain('chatGPT');
    expect(labels).not.toContain('chat gpt');
    expect(labels).not.toContain('チャットGPT');
    expect(labels).toContain('Gemini');
    expect(labels).not.toContain('gemini');
    expect(labels).toContain('Claude');
    expect(labels).not.toContain('claude');
    expect(labels).toContain('Canva AI');
    // 全員が回答している
    expect(main.validResponses).toBe(52);
  });
});

describe('管理列の保持と識別情報の扱い', () => {
  it('管理列4つがそのまま残り、識別情報として認識される', () => {
    const ds = fixtureDataset(5);
    const identities = ds.questions.filter((q) => q.identity);

    expect(identities.map((q) => q.identity).sort()).toEqual([
      'approved-at',
      'worker-id',
      'worker-name',
      'worker-url',
    ]);
    // 実CSVの列名は「作業者名」ではなく「作業者」
    expect(ds.headers.slice(0, 4)).toEqual([...CROWDWORKS_MANAGEMENT_HEADERS]);
    expect(ds.questions.find((q) => q.identity === 'worker-name')!.header).toBe('作業者');
  });

  it('管理列は集計・グラフに載らない', () => {
    const ds = fixtureDataset(10);
    const labels = aggregateAll(ds).questions.map((q) => q.question);

    expect(labels).not.toContain('作業ID');
    expect(labels).not.toContain('作業者');
    expect(labels).not.toContain('作業者名');
    expect(labels).not.toContain('作業者ページURL');
    expect(labels).not.toContain('承認日時');
  });

  it('summary / json / markdown に管理列が漏れない', () => {
    const ds = fixtureDataset();
    const analysis = aggregateAll(ds);
    const outputs = {
      'summary.csv': toSummaryCsv(analysis),
      'analysis.json': toAnalysisJson(analysis),
      'survey-summary.md': toMarkdown(analysis),
      'survey-free-text.md': toFreeTextMarkdown(ds),
      'cross-tab.csv': JSON.stringify(crossTabulate(ds, 'gender', 'ai-tools', 'count')),
    };

    for (const [name, text] of Object.entries(outputs)) {
      expect(text, name).not.toContain('ダミー作業者');
      expect(text, name).not.toContain('example.invalid');
      expect(text, name).not.toContain('W-0001');
      expect(text, name).not.toContain('作業者ページURL');
    }
  });

  it('responses.csv は既定で個人情報の列を落とし、承認日時は残す', () => {
    const ds = fixtureDataset(3);
    const header = toResponsesCsv(ds, hiddenIdentityColumns(ds, defaultIdentityVisibility()))
      .split('\r\n')[0]!;

    expect(header).not.toContain('作業ID');
    expect(header).not.toContain('作業者');
    expect(header).toContain('承認日時');
    expect(header.startsWith('No,')).toBe(true);
    expect(header.endsWith(',included')).toBe(true);
  });
});

describe('正規化の全体像', () => {
  it('321列相当の入力を 管理列4 + 設問23 に畳み込む', () => {
    const raw = rawFixture();
    const ds = fixtureDataset();

    expect(raw.headers).toHaveLength(CROWDWORKS_FIXTURE_COLUMNS);
    expect(ds.headers).toHaveLength(4 + CROWDWORKS_FIXTURE_QUESTIONS);
  });

  it('正規化の前後で回答件数が変わらない（52件）', () => {
    const raw = rawFixture();
    const ds = fixtureDataset();

    expect(raw.rows).toHaveLength(52);
    expect(ds.rows).toHaveLength(52);
    expect(aggregateAll(ds).totalResponses).toBe(52);
    expect(aggregateAll(ds).includedResponses).toBe(52);
  });

  it('23設問すべてがプロファイルに解決される（自動推定に落ちない）', () => {
    const ds = fixtureDataset();
    const columnQuestions = ds.questions.filter((q) => q.columnIndex >= 0);

    expect(columnQuestions.filter((q) => q.inferred).map((q) => q.header)).toEqual([]);
    expect(columnQuestions).toHaveLength(4 + CROWDWORKS_FIXTURE_QUESTIONS);
  });

  it('受注年・受注月から派生年月が生成される', () => {
    const ds = fixtureDataset();
    const derived = ds.questions.find((q) => q.key === 'start-year-month');

    expect(derived).toBeDefined();
    const agg = aggregateQuestion(ds, derived!);
    expect(agg.validResponses).toBe(52);
    for (const item of agg.items) {
      expect(item.label).toMatch(/^\d{4}-\d{2}$/);
    }
    // 時系列なので昇順に並ぶ
    const labels = agg.items.map((i) => i.label);
    expect(labels).toEqual([...labels].sort());
  });

  it('検出したことが warnings に残る', () => {
    const ds = fixtureDataset();

    expect(ds.warnings.some((w) => w.includes('CrowdWorks形式を検出しました'))).toBe(true);
  });

  it('クロス集計まで通る（性別 × 使用AI）', () => {
    const ds = fixtureDataset();
    const ct = crossTabulate(ds, 'gender', 'ai-tools', 'count');

    expect(ct.grandTotal).toBe(52);
    expect(ct.rowLabels.length).toBeGreaterThan(0);
    expect(ct.colLabels.length).toBeGreaterThan(0);
    // 行が単一選択なので行合計は総数に一致する
    expect(ct.rowTotals.reduce((a, b) => a + b, 0)).toBe(52);
  });

  it('複数選択 × 複数選択のクロス集計も通る', () => {
    const ds = fixtureDataset();
    const ct = crossTabulate(ds, 'job-detail', 'ai-usage', 'row');

    expect(ct.rowMultiple).toBe(true);
    expect(ct.colMultiple).toBe(true);
    expect(ct.grandTotal).toBeGreaterThan(0);
  });

  it('全設問の総当たりクロス集計が例外を出さない', () => {
    const ds = fixtureDataset(20);
    const crossable = ds.questions.filter(
      (q) => q.kind === 'single' || q.kind === 'multiple' || q.kind === 'numeric',
    );

    for (const r of crossable) {
      for (const c of crossable) {
        expect(() => crossTabulate(ds, r.key, c.key, 'row')).not.toThrow();
      }
    }
  });
});

describe('Q11 実際の作業時間 の派生質問', () => {
  /** Q11 だけを持つ最小の CrowdWorks テーブルを作る */
  function workTimeDataset(values: string[]): Dataset {
    const table = tinyTable(
      withManagement(['11. 実際の作業時間']),
      values.map((v) => [...MGMT, v]),
    );
    return buildDataset(table);
  }

  const REAL_SHAPE = [
    '- 作業日数：1日\n- 合計作業時間：3時間',
    '- 作業日数：2日\n- 合計作業時間：30分',
    '- 作業日数：一日\n- 合計作業時間：5時間30分',
    '- 作業日数：3\n- 合計作業時間：1時間半程',
    '- 作業日数：半日以下\n- 合計作業時間：1時間程度', // 日数だけ解析不能
    '- 作業日数：3ヶ月 週5\n- 合計作業時間：8時間', // 日数だけ解析不能
    '- 作業日数：2\n- 合計作業時間：8', // 時間だけ解析不能
    '応募に1分、作業に3分です。', // 両方解析不能
  ];

  it('作業日数と合計作業時間の派生質問が作られる', () => {
    const ds = workTimeDataset(REAL_SHAPE);
    const days = ds.questions.find((q) => q.key === 'work-days');
    const minutes = ds.questions.find((q) => q.key === 'work-minutes');

    expect(days).toBeDefined();
    expect(minutes).toBeDefined();
    // 派生質問なので元の列を持たない
    expect(days!.columnIndex).toBe(-1);
    expect(minutes!.columnIndex).toBe(-1);
    expect(days!.kind).toBe('single');
    expect(minutes!.kind).toBe('single');
  });

  it('元のQ11は原文のまま残る', () => {
    const ds = workTimeDataset(REAL_SHAPE);
    const source = ds.questions.find((q) => q.key === 'work-hours')!;

    // 派生値を作っても、元の列の値は1文字も変えない
    ds.rows.forEach((row, i) => {
      expect(row.values[source.columnIndex]).toBe(REAL_SHAPE[i]);
    });
  });

  it('responses.csv には原文が残る', () => {
    const ds = workTimeDataset(REAL_SHAPE);
    const csv = toResponsesCsv(ds);

    expect(csv).toContain('11. 実際の作業時間');
    expect(csv).toContain('作業日数：半日以下');
    expect(csv).toContain('応募に1分、作業に3分です。');
    // 派生質問は列として増やさない（監査用の原文だけを持つ）
    const header = csv.split('\r\n')[0]!;
    expect(header).not.toContain('作業日数（派生）');
    expect(header).not.toContain('合計作業時間（派生）');
  });

  it('解析できた日数だけが分布に載り、残りは解析不能になる', () => {
    const ds = workTimeDataset(REAL_SHAPE);
    const agg = aggregateQuestion(ds, ds.questions.find((q) => q.key === 'work-days')!);
    const byLabel = new Map(agg.items.map((i) => [i.label, i.count]));

    expect(agg.validResponses).toBe(8);
    expect(byLabel.get('1日')).toBe(2); // "1日" と "一日"
    expect(byLabel.get('2日')).toBe(2); // "2日" と ラベル直後の "2"
    expect(byLabel.get('3日')).toBe(1); // ラベル直後の "3"
    expect(byLabel.get(UNPARSED_LABEL)).toBe(3); // 半日以下 / 3ヶ月 週5 / 文章
    // 解析不能を 0日 として数えない
    expect(byLabel.get('0日')).toBeUndefined();
  });

  it('解析できた時間だけがビンに載り、残りは解析不能になる', () => {
    const ds = workTimeDataset(REAL_SHAPE);
    const agg = aggregateQuestion(ds, ds.questions.find((q) => q.key === 'work-minutes')!);
    const byLabel = new Map(agg.items.map((i) => [i.label, i.count]));

    expect(agg.validResponses).toBe(8);
    // 30分ちょうどは「30分~1時間未満」に入る（ビンは下限を含み上限を含まない）
    expect(byLabel.get('30分~1時間未満')).toBe(1); // 30分
    expect(byLabel.get('1~2時間未満')).toBe(2); // 1時間半程 / 1時間程度
    expect(byLabel.get('3~5時間未満')).toBe(1); // 3時間
    expect(byLabel.get('5~10時間未満')).toBe(2); // 5時間30分 / 8時間
    expect(byLabel.get(UNPARSED_LABEL)).toBe(2); // "8" / 文章
    // 解析不能を最小のビンへ寄せない
    expect(byLabel.get('30分未満')).toBeUndefined();
    // 解析できた6件とビンの合計が一致する
    const binned = agg.items
      .filter((i) => i.label !== UNPARSED_LABEL)
      .reduce((sum, i) => sum + i.count, 0);
    expect(binned).toBe(6);
  });

  it('ビンは依頼された順に並ぶ（解析不能は末尾）', () => {
    const ds = workTimeDataset(REAL_SHAPE);
    const labels = aggregateQuestion(
      ds,
      ds.questions.find((q) => q.key === 'work-minutes')!,
    ).items.map((i) => i.label);

    const order = labels.filter((l) => l !== UNPARSED_LABEL);
    const expected = WORK_MINUTES_BINS.filter((b) => order.includes(b));
    expect(order).toEqual(expected);
    expect(labels.at(-1)).toBe(UNPARSED_LABEL);
  });

  it('Q11 が未回答の行は母数から外れる（解析不能とは別扱い）', () => {
    const ds = workTimeDataset(['- 作業日数：1日\n- 合計作業時間：3時間', '', '半日以下']);
    const agg = aggregateQuestion(ds, ds.questions.find((q) => q.key === 'work-days')!);

    expect(agg.validResponses).toBe(2); // 空欄の1件は母数外
    expect(agg.blankResponses).toBe(1);
    expect(agg.items.find((i) => i.label === UNPARSED_LABEL)?.count).toBe(1);
  });

  it('summary.csv / analysis.json / survey-summary.md に解析不能件数と分布が出る', () => {
    const ds = workTimeDataset(REAL_SHAPE);
    const analysis = aggregateAll(ds);

    const summary = toSummaryCsv(analysis);
    expect(summary).toContain(`合計作業時間（派生）,${UNPARSED_LABEL},2,`);
    expect(summary).toContain('合計作業時間（派生）,3~5時間未満,1,');
    expect(summary).toContain(`作業日数（派生）,${UNPARSED_LABEL},3,`);

    const json = JSON.parse(toAnalysisJson(analysis)) as {
      questions: { key: string; validResponses: number; items: { label: string; count: number }[] }[];
    };
    const minutes = json.questions.find((q) => q.key === 'work-minutes')!;
    expect(minutes.validResponses).toBe(8);
    expect(minutes.items.find((i) => i.label === UNPARSED_LABEL)?.count).toBe(2);

    const md = toMarkdown(analysis);
    expect(md).toContain('## 合計作業時間（派生）');
    expect(md).toContain('## 作業日数（派生）');
    expect(md).toContain(UNPARSED_LABEL);
  });

  it('Q11 が無いデータでは派生質問を作らない', () => {
    const table = tinyTable(withManagement(['1. 年齢', '']), [[...MGMT, '4', '45～54']]);
    const ds = buildDataset(table);

    expect(ds.questions.find((q) => q.key === 'work-days')).toBeUndefined();
    expect(ds.questions.find((q) => q.key === 'work-minutes')).toBeUndefined();
  });
});
