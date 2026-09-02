/**
 * src/export/csv.ts / json.ts / markdown.ts のテスト。
 *
 * DOM に依存するモジュール（download.ts / png.ts）は対象外。
 * 出力フォーマットは「他のツールに貼って読ませる」ためのものなので、
 * ヘッダー・エスケープ・母数の明記といった契約部分を固定する。
 */

import { describe, it, expect } from 'vitest';
import {
  csvEscape,
  toCrossTabCsv,
  toCsv,
  toResponsesCsv,
  toSummaryCsv,
} from '../src/export/csv.ts';
import { toAnalysisJson } from '../src/export/json.ts';
import { crossTabToMarkdown, toFreeTextMarkdown, toMarkdown } from '../src/export/markdown.ts';
import { aggregateAll } from '../src/core/aggregate.ts';
import { crossTabulate } from '../src/core/crosstab.ts';
import { makeDataset, makeQuestion } from './helpers.ts';
import type { AnalysisResult, Dataset } from '../src/types.ts';

/**
 * エクスポート検証用のデータセット。
 * 全12件のうち末尾2件を除外 → 集計対象10件。
 *  - 性別: 有効8件（女性5 / 男性3）→ 女性 62.5%
 *  - 使用したAI（複数回答）: 有効7件 / 延べ8選択（ChatGPT6 / Claude2）
 *  - 自由記述: 有効1件
 */
function exportDataset(): Dataset {
  return makeDataset({
    headers: ['性別', '使用したAI', '自由記述'],
    questions: [
      makeQuestion({ key: 'gender', columnIndex: 0, label: '性別', order: 'count' }),
      makeQuestion({
        key: 'ai-tools',
        columnIndex: 1,
        label: '使用したAI',
        kind: 'multiple',
        chart: 'hbar',
        order: 'count',
      }),
      makeQuestion({
        key: 'free-comment',
        columnIndex: 2,
        label: '自由記述',
        kind: 'free',
        chart: 'none',
      }),
    ],
    rows: [
      ['女性', 'ChatGPT、Claude', 'すごく助かった'],
      ['女性', 'ChatGPT', ''],
      ['女性', 'ChatGPT', ''],
      ['女性', 'Claude', ''],
      ['女性', '', ''],
      ['男性', 'ChatGPT', ''],
      ['男性', 'ChatGPT', ''],
      ['男性', '', ''],
      ['', 'ChatGPT', ''],
      ['-', '', ''],
      { values: ['女性', 'ChatGPT', ''], included: false },
      { values: ['男性', 'ChatGPT', ''], included: false },
    ],
    sourceName: 'テストデータ.csv',
  });
}

/** 使用したAI（複数回答） × 年齢（単一回答）のクロス集計用データセット */
function crossDataset(): Dataset {
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
    ],
  });
}

describe('csvEscape / toCsv', () => {
  it('特別な文字を含まない値はそのまま', () => {
    expect(csvEscape('abc')).toBe('abc');
    expect(csvEscape('日本語')).toBe('日本語');
    expect(csvEscape(12)).toBe('12');
    expect(csvEscape('')).toBe('');
  });

  it('カンマ・改行・引用符を含む値はクォートし、" は "" にする', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
    expect(csvEscape('a\r\nb')).toBe('"a\r\nb"');
    expect(csvEscape('He said "yes"')).toBe('"He said ""yes"""');
  });

  it('行は CRLF で連結する', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('a,b\r\nc,d');
  });
});

describe('toSummaryCsv', () => {
  it('ヘッダー行が仕様どおり', () => {
    const csv = toSummaryCsv(aggregateAll(exportDataset()));
    expect(csv.split('\r\n')[0]).toBe(
      'question,option,count,percentage,valid_responses,multiple_choice',
    );
  });

  it('件数・割合・有効回答数・複数回答フラグを行ごとに出す', () => {
    const lines = toSummaryCsv(aggregateAll(exportDataset())).split('\r\n');

    // 割合は小数第2位まで、分母は各質問の有効回答数
    expect(lines[1]).toBe('性別,女性,5,62.50,8,false');
    expect(lines[2]).toBe('性別,男性,3,37.50,8,false');
    // 複数回答は multiple_choice=true。割合の合計は 100 を超える
    expect(lines[3]).toBe('使用したAI,ChatGPT,6,85.71,7,true');
    expect(lines[4]).toBe('使用したAI,Claude,2,28.57,7,true');
  });

  it('カンマや引用符を含むラベルを正しくエスケープする', () => {
    const ds = makeDataset({
      headers: ['満足度'],
      questions: [
        makeQuestion({ key: 'q1', columnIndex: 0, label: 'Q1, 満足度', order: 'count' }),
      ],
      rows: [['はい, そう思う'], ['はい, そう思う'], ['He said "yes"']],
    });
    const lines = toSummaryCsv(aggregateAll(ds)).split('\r\n');

    expect(lines[1]).toBe('"Q1, 満足度","はい, そう思う",2,66.67,3,false');
    expect(lines[2]).toBe('"Q1, 満足度","He said ""yes""",1,33.33,3,false');
  });
});

describe('toCrossTabCsv', () => {
  it('コメント行・ヘッダー行・合計行を持つ', () => {
    const ct = crossTabulate(crossDataset(), 'ai-tools', 'age', 'count');
    const lines = toCrossTabCsv(ct).split('\r\n');

    expect(lines[0]).toBe('# 行: 使用したAI / 列: 年齢 / 有効回答者数: 5 / 表示: count');
    expect(lines[1]).toBe('使用したAI,20代,30代,合計(実人数)');
    expect(lines[2]).toBe('ChatGPT,2,2,4');
    expect(lines[3]).toBe('Claude,1,2,3');
    expect(lines[4]).toBe('合計(実人数),2,3,5');
    expect(lines.length).toBe(5);
  });
});

describe('toResponsesCsv', () => {
  it('先頭に No、末尾に included 列を付ける', () => {
    const ds = makeDataset({
      headers: ['性別', 'コメント'],
      questions: [makeQuestion({ key: 'gender', columnIndex: 0, label: '性別' })],
      rows: [['女性', 'a,b'], { values: ['男性', 'ok'], included: false }],
    });
    const lines = toResponsesCsv(ds).split('\r\n');

    expect(lines[0]).toBe('No,性別,コメント,included');
    expect(lines[1]).toBe('1,女性,"a,b",true'); // No は 1 始まり
    expect(lines[2]).toBe('2,男性,ok,false');
  });

  it('除外した回答も削除せず全件残す（監査用）', () => {
    const ds = makeDataset({
      headers: ['性別'],
      questions: [makeQuestion({ key: 'gender', columnIndex: 0, label: '性別' })],
      rows: [
        ['女性'],
        { values: ['男性'], included: false },
        ['女性'],
        { values: ['その他'], included: false },
        ['男性'],
      ],
    });
    const lines = toResponsesCsv(ds)
      .split('\r\n')
      .filter((l) => l.length > 0);

    // ヘッダー + 5件（除外2件を含む）
    expect(lines).toHaveLength(6);
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['1', '2', '3', '4', '5']);
    expect(lines.slice(1).map((l) => l.split(',').at(-1))).toEqual([
      'true',
      'false',
      'true',
      'false',
      'true',
    ]);
  });

  it('included は true / false の2値だけを取る', () => {
    const ds = makeDataset({
      headers: ['性別'],
      questions: [makeQuestion({ key: 'gender', columnIndex: 0, label: '性別' })],
      rows: [['女性'], { values: ['男性'], included: false }],
    });
    const values = toResponsesCsv(ds)
      .split('\r\n')
      .filter((l) => l.length > 0)
      .slice(1)
      .map((l) => l.split(',').at(-1));

    for (const v of values) expect(['true', 'false']).toContain(v);
  });
});

describe('toAnalysisJson', () => {
  it('JSON.parse でき、件数と割合が取り出せる', () => {
    const json = toAnalysisJson(aggregateAll(exportDataset()));
    const parsed = JSON.parse(json) as AnalysisResult;

    expect(parsed.totalResponses).toBe(12);
    expect(parsed.includedResponses).toBe(10);
    expect(parsed.excludedResponses).toBe(2);
    expect(parsed.sourceName).toBe('テストデータ.csv');
    expect(parsed.generator).toBe('crowdworks-ai-survey-analyzer v1.0.0');

    const gender = parsed.questions.find((q) => q.key === 'gender');
    expect(gender?.validResponses).toBe(8);
    expect(gender?.items[0].label).toBe('女性');
    expect(gender?.items[0].percentage).toBe(62.5);

    const tools = parsed.questions.find((q) => q.key === 'ai-tools');
    expect(tools?.multiple).toBe(true);
    expect(tools?.totalSelections).toBe(8);
    expect(tools?.items[0].percentage).toBe(85.71);
  });

  it('インデント2の整形済み JSON を返す', () => {
    const json = toAnalysisJson(aggregateAll(exportDataset()));
    expect(json).toContain('\n  "generatedAt"');
  });
});

describe('toMarkdown', () => {
  const md = toMarkdown(aggregateAll(exportDataset()));

  it('見出しとメタ情報を含む', () => {
    expect(md).toContain('# 生成AI仕事利用アンケート 集計結果');
    expect(md).toContain('- データ名: テストデータ.csv');
    expect(md).toContain('- 出力元: crowdworks-ai-survey-analyzer v1.0.0');
    expect(md).toContain('- 全回答数: 12件');
    expect(md).toContain('- 有効回答数(集計対象): 10件');
    expect(md).toContain('- 除外回答数: 2件');
  });

  it('質問ごとの見出しと表を含む', () => {
    expect(md).toContain('## 性別');
    expect(md).toContain('| 選択肢 | 人数 | 割合 |');
    expect(md).toContain('|---|---:|---:|');
    // 割合は小数第1位まで
    expect(md).toContain('| 女性 | 5 | 62.5% |');
    expect(md).toContain('| 男性 | 3 | 37.5% |');
  });

  it('母数（有効回答数・未回答数・集計対象件数）を本文に書く', () => {
    expect(md).toContain('有効回答数: 8件（未回答 2件 / 集計対象 10件）');
    expect(md).toContain('有効回答数: 7件（未回答 3件 / 集計対象 10件）');
  });

  it('複数回答の質問に注記を入れる', () => {
    expect(md).toContain('## 使用したAI');
    expect(md).toContain('※複数回答');
    expect(md).toContain('| ChatGPT | 6 | 85.7% |');

    // 注記は複数回答の質問ブロックの中にある
    const toolsBlock = md.slice(md.indexOf('## 使用したAI'), md.indexOf('## 自由記述'));
    expect(toolsBlock).toContain('※複数回答');

    const genderBlock = md.slice(md.indexOf('## 性別'), md.indexOf('## 使用したAI'));
    expect(genderBlock).not.toContain('※複数回答');
  });

  it('自由記述は件数のみで、本文は出力しない', () => {
    expect(md).toContain('## 自由記述');
    expect(md).toContain('回答件数: 1件');
    expect(md).not.toContain('すごく助かった');
  });

  it('数値項目は要約統計を併記する', () => {
    const ds = makeDataset({
      headers: ['報酬'],
      questions: [
        makeQuestion({
          key: 'reward',
          columnIndex: 0,
          label: '報酬',
          kind: 'numeric',
          unit: '円',
          order: 'natural',
        }),
      ],
      rows: [['1000円'], ['2000円'], ['3000円']],
    });
    const numericMd = toMarkdown(aggregateAll(ds));

    expect(numericMd).toContain('- 件数: 3件');
    expect(numericMd).toContain('- 平均: 2,000.0円');
    expect(numericMd).toContain('- 中央値: 2,000.0円');
    expect(numericMd).toContain('- 最小: 1,000円');
    expect(numericMd).toContain('- 最大: 3,000円');
  });
});

describe('crossTabToMarkdown', () => {
  it('見出し・母数・表を出力する', () => {
    const ct = crossTabulate(crossDataset(), 'ai-tools', 'age', 'count');
    const md = crossTabToMarkdown(ct);

    expect(md).toContain('## クロス集計: 使用したAI × 年齢');
    expect(md).toContain('対象者数（行・列の両方に有効回答）: 5件');
    expect(md).toContain('| 使用したAI | 20代 | 30代 | 合計(実人数) |');
    expect(md).toContain('| ChatGPT | 2 | 2 | 4 |');
    expect(md).toContain('| Claude | 1 | 2 | 3 |');
    expect(md).toContain('| 合計(実人数) | 2 | 3 | 5 |');
    // 行が複数回答であることの注記
    expect(md).toContain('※行の質問は複数回答のため');
  });

  it('割合モードではセルに割合が入る', () => {
    const ct = crossTabulate(crossDataset(), 'ai-tools', 'age', 'row');
    const md = crossTabToMarkdown(ct);
    // ChatGPT の行合計は4、うち20代が2 → 50.0%
    expect(md).toContain('| ChatGPT | 2 (50.0%) | 2 (50.0%) | 4 |');
  });
});

describe('toFreeTextMarkdown', () => {
  /** 自由記述 1 問（コメント）と単一選択 1 問を持つデータセット */
  function freeTextDataset() {
    return makeDataset({
      headers: ['性別', 'コメント'],
      questions: [
        makeQuestion({ key: 'gender', columnIndex: 0, label: '性別' }),
        makeQuestion({
          key: 'free-comment',
          columnIndex: 1,
          label: '自由記述',
          kind: 'free',
          chart: 'none',
          delimiters: [],
        }),
      ],
      rows: [
        ['女性', '納期が短くて大変だった'],
        ['男性', ''], // 自由記述なし
        { values: ['女性', '除外された回答の本文'], included: false },
        ['男性', 'AIのおかげで単価が上がった'],
        { values: ['その他', 'これも除外'], included: false },
        ['女性', '   '], // 空白だけ＝自由記述なし
      ],
    });
  }

  it('見出しと母数を出す', () => {
    const md = toFreeTextMarkdown(freeTextDataset());

    expect(md.startsWith('# 自由記述回答')).toBe(true);
    // 集計対象は 6 件中 4 件、そのうち本文があるのは 2 件
    expect(md).toContain('集計対象回答数: 4件');
    expect(md).toContain('自由記述あり: 2件');
    expect(md).toContain('対象の設問: 自由記述');
  });

  it('集計対象の自由記述だけが本文として入る', () => {
    const md = toFreeTextMarkdown(freeTextDataset());

    expect(md).toContain('納期が短くて大変だった');
    expect(md).toContain('AIのおかげで単価が上がった');
  });

  it('除外した回答の自由記述は入らない', () => {
    const md = toFreeTextMarkdown(freeTextDataset());

    expect(md).not.toContain('除外された回答の本文');
    expect(md).not.toContain('これも除外');
  });

  it('見出しの番号は元データの通し番号（responses.csv の No と一致）', () => {
    const md = toFreeTextMarkdown(freeTextDataset());
    const headings = [...md.matchAll(/^## 回答 (\d+)$/gm)].map((m) => Number(m[1]));

    // 1 件目（No.1）と 4 件目（No.4）だけが出る。除外の No.3 / No.5 は出ない
    expect(headings).toEqual([1, 4]);
  });

  it('本文が空・空白だけの回答は見出しごと出さない', () => {
    const md = toFreeTextMarkdown(freeTextDataset());
    const headings = [...md.matchAll(/^## 回答 (\d+)$/gm)].map((m) => Number(m[1]));

    expect(headings).not.toContain(2); // 空文字
    expect(headings).not.toContain(6); // 空白だけ
  });

  it('本文を加工せずそのまま出力する（要約・切り詰めをしない）', () => {
    const long = 'あ'.repeat(600) + '\n2行目の内容';
    const ds = makeDataset({
      headers: ['コメント'],
      questions: [
        makeQuestion({
          key: 'free-comment',
          columnIndex: 0,
          label: '自由記述',
          kind: 'free',
          chart: 'none',
          delimiters: [],
        }),
      ],
      rows: [[long]],
    });

    expect(toFreeTextMarkdown(ds)).toContain(long);
  });

  it('自由記述が複数問あるときは設問ラベルを添える', () => {
    const ds = makeDataset({
      headers: ['仕事内容', 'コメント'],
      questions: [
        makeQuestion({
          key: 'job-detail',
          columnIndex: 0,
          label: '具体的に行った仕事内容',
          kind: 'free',
          chart: 'none',
          delimiters: [],
        }),
        makeQuestion({
          key: 'free-comment',
          columnIndex: 1,
          label: '自由記述',
          kind: 'free',
          chart: 'none',
          delimiters: [],
        }),
      ],
      rows: [['記事のリライト', '楽しかった'], ['バナー作成', '']],
    });
    const md = toFreeTextMarkdown(ds);

    expect(md).toContain('対象の設問: 具体的に行った仕事内容 / 自由記述');
    expect(md).toContain('**具体的に行った仕事内容**');
    expect(md).toContain('**自由記述**');
    expect(md).toContain('記事のリライト');
    expect(md).toContain('楽しかった');
    // 2 件とも「仕事内容」には回答があるので両方出る
    expect([...md.matchAll(/^## 回答 (\d+)$/gm)].map((m) => Number(m[1]))).toEqual([1, 2]);
  });

  it('自由記述が 1 問だけならラベルを付けない（依頼の形式どおり）', () => {
    const md = toFreeTextMarkdown(freeTextDataset());

    expect(md).not.toContain('**自由記述**');
  });

  it('自由記述の設問が無いデータでも例外にならない', () => {
    const ds = makeDataset({
      headers: ['性別'],
      questions: [makeQuestion({ key: 'gender', columnIndex: 0, label: '性別' })],
      rows: [['女性'], ['男性']],
    });
    const md = toFreeTextMarkdown(ds);

    expect(md).toContain('自由記述あり: 0件');
    expect(md).toContain('（自由記述として扱っている設問がありません）');
  });

  it('全員が除外されているときは本文が 1 件も出ない', () => {
    const ds = makeDataset({
      headers: ['コメント'],
      questions: [
        makeQuestion({
          key: 'free-comment',
          columnIndex: 0,
          label: '自由記述',
          kind: 'free',
          chart: 'none',
          delimiters: [],
        }),
      ],
      rows: [
        { values: ['あ'], included: false },
        { values: ['い'], included: false },
      ],
    });
    const md = toFreeTextMarkdown(ds);

    expect(md).toContain('集計対象回答数: 0件');
    expect(md).toContain('自由記述あり: 0件');
    expect(md).toContain('（集計対象の回答に自由記述がありません）');
    expect(md).not.toContain('## 回答');
  });
});
