/**
 * src/core/schema.ts のテスト。
 *
 * 1列の値から種別を推定する inferKind と、
 * プロファイル照合と推定を組み合わせて質問定義を作る buildQuestions / buildDataset を検証する。
 */

import { describe, expect, it } from 'vitest';
import { buildDataset, buildQuestions, inferKind } from '../src/core/schema.ts';
import { SAFE_DELIMITERS } from '../src/core/splitter.ts';
import type { QuestionDef, RawTable } from '../src/types.ts';

/** テスト用の RawTable を組み立てる（parse.ts を通さず直接与える） */
function makeTable(headers: string[], rows: string[][]): RawTable {
  return { headers, rows, delimiter: ',', warnings: [], sourceName: 'テストデータ' };
}

/** 生ヘッダーから質問定義を取り出す。無ければテストを失敗させる */
function byHeader(questions: QuestionDef[], header: string): QuestionDef {
  const found = questions.find((q) => q.header === header);
  if (!found) throw new Error(`列が見つかりません: ${header}`);
  return found;
}

/** 自由記述・複数回答・数値の3列を持つ表を作るための素材 */
const KANA = ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け', 'こ', 'さ', 'し', 'す', 'せ', 'そ'];
const FRUITS = ['りんご', 'みかん', 'ぶどう', 'もも', 'いちご'];

/**
 * プロファイルに載っていない3列（自由記述 / 数値 / 複数回答）だけの表。
 * どの列名も CROWDWORKS_PROFILES のエイリアスに部分一致しないものを選んである。
 */
function makeMixedTable(): RawTable {
  return makeTable(
    ['メモ欄', 'ポイント数', '好きな果物'],
    KANA.map((kana, i) => [
      // 数字も区切り文字も含まない一意な文章 → 自由記述
      `納期に追われながらも丁寧に仕上げた${kana}`,
      // 15種類の異なる数値 → 数値
      String((i + 1) * 100),
      // 3行に1行は単一、残りは "、" 区切りの複数回答
      i % 3 === 0 ? FRUITS[i % 5] : `${FRUITS[i % 5]}、${FRUITS[(i + 1) % 5]}`,
    ]),
  );
}

describe('inferKind', () => {
  it('非空セルが0なら ignore', () => {
    const result = inferKind(['', '  ', '-', 'N/A', '']);

    expect(result.kind).toBe('ignore');
    expect(result.chart).toBe('none');
  });

  it('改行を含むセルが多い列は数値扱いしない', () => {
    // 実CSVの「11. 実際の作業時間」の形。
    // 数値扱いすると最初に出てくる「作業日数」の数字を時間として集計してしまう。
    const values = Array.from(
      { length: 20 },
      (_, i) => `- 作業日数:${(i % 5) + 1}日\n- 合計作業時間:${i + 1}時間`,
    );
    const result = inferKind(values);

    expect(result.kind).not.toBe('numeric');
  });

  it('改行が無ければ従来どおり数値扱いする', () => {
    const values = Array.from({ length: 20 }, (_, i) => `${(i + 1) * 1000}円`);

    expect(inferKind(values).kind).toBe('numeric');
  });

  it('数値ばかりで異なり値が12を超えれば numeric', () => {
    const values = Array.from({ length: 15 }, (_, i) => String((i + 1) * 100));
    const result = inferKind(values);

    expect(result.kind).toBe('numeric');
    expect(result.chart).toBe('bar');
    expect(result.delimiters).toEqual([]);
  });

  it('数値でも異なり値が12以下なら numeric にしない（選択肢式とみなす）', () => {
    const values = Array.from({ length: 15 }, (_, i) => String((i % 3) + 1));

    expect(inferKind(values).kind).toBe('single');
  });

  it('"1万円" のような日本語混じりの数値も numeric として拾う', () => {
    const values = Array.from({ length: 15 }, (_, i) => `${(i + 1) * 1000}円`);

    expect(inferKind(values).kind).toBe('numeric');
  });

  it('区切り文字で2要素以上に割れる行が多ければ multiple', () => {
    const values = [
      'ChatGPT、Claude',
      'ChatGPT',
      'ChatGPT、Gemini',
      'Claude、Gemini',
      'Gemini',
      'ChatGPT、Claude、Gemini',
      'Claude',
      'ChatGPT、Claude',
    ];
    const result = inferKind(values);

    expect(result.kind).toBe('multiple');
    expect(result.chart).toBe('hbar');
    expect(result.delimiters).toEqual(SAFE_DELIMITERS);
  });

  it('値の種類が少なくまとまっていれば single（6種類以下は円グラフ）', () => {
    const values = ['20代', '30代', '20代', '40代', '30代', '20代', '40代', '30代'];
    const result = inferKind(values);

    expect(result.kind).toBe('single');
    expect(result.chart).toBe('pie');
  });

  it('single でも異なり値が7種類以上なら棒グラフ', () => {
    const labels = ['あ', 'い', 'う', 'え', 'お', 'か', 'き'];
    const values = [...labels, ...labels];
    const result = inferKind(values);

    expect(result.kind).toBe('single');
    expect(result.chart).toBe('bar');
  });

  it('回答がほぼ全部バラバラなら free', () => {
    const values = KANA.map((kana) => `納期に追われながらも丁寧に仕上げた${kana}`);
    const result = inferKind(values);

    expect(result.kind).toBe('free');
    expect(result.chart).toBe('none');
    expect(result.delimiters).toEqual([]);
  });
});

describe('buildQuestions（プロファイルなしの列の推定）', () => {
  it('複数選択列は multiple、自由記述列は free、数値ばかりの列は numeric になる', () => {
    const questions = buildQuestions(makeMixedTable());

    const free = byHeader(questions, 'メモ欄');
    expect(free.kind).toBe('free');
    expect(free.chart).toBe('none');
    expect(free.delimiters).toEqual([]);

    const numeric = byHeader(questions, 'ポイント数');
    expect(numeric.kind).toBe('numeric');
    expect(numeric.chart).toBe('bar');

    const multiple = byHeader(questions, '好きな果物');
    expect(multiple.kind).toBe('multiple');
    expect(multiple.chart).toBe('hbar');
    expect(multiple.delimiters).toEqual(SAFE_DELIMITERS);
  });

  it('プロファイルに無い列は inferred=true、key は "q1","q2"… になる', () => {
    const questions = buildQuestions(makeMixedTable());

    expect(questions.map((q) => q.key)).toEqual(['q1', 'q2', 'q3']);
    expect(questions.every((q) => q.inferred)).toBe(true);
    expect(questions.every((q) => q.order === 'count')).toBe(true);
    expect(questions.every((q) => q.profileKey === undefined)).toBe(true);
    // ラベルは生ヘッダーをそのまま使う
    expect(questions.map((q) => q.label)).toEqual(['メモ欄', 'ポイント数', '好きな果物']);
    expect(questions.map((q) => q.columnIndex)).toEqual([0, 1, 2]);
  });
});

describe('buildQuestions（プロファイル照合）', () => {
  it('列名がプロファイルに当たれば inferred=false でプロファイルの定義を使う', () => {
    const table = makeTable(
      ['Q1. あなたの年齢を教えてください'],
      [['20代'], ['30代'], ['30代'], ['40代']],
    );
    const [question] = buildQuestions(table);

    expect(question.key).toBe('age');
    expect(question.profileKey).toBe('age');
    expect(question.inferred).toBe(false);
    expect(question.label).toBe('年齢');
    expect(question.kind).toBe('single');
    expect(question.order).toBe('preset');
    // プリセットは実CSVの選択肢に合わせてある（プロファイル定義のコピーであること）
    expect(question.presetOptions).toEqual([
      '18～24',
      '25～34',
      '35～44',
      '45～54',
      '55～64',
      '65～74',
      '75以上',
    ]);
  });

  it('プロファイルが single でも実データが数値ばかりなら numeric に上書きする', () => {
    const table = makeTable(
      ['Q10. 今回の報酬はいくらでしたか'],
      Array.from({ length: 15 }, (_, i) => [`${(i + 1) * 1000 + 500}円`]),
    );
    const [question] = buildQuestions(table);

    expect(question.profileKey).toBe('reward');
    expect(question.kind).toBe('numeric');
    expect(question.chart).toBe('bar');
    expect(question.unit).toBe('円');
    expect(question.inferred).toBe(false);
  });

  it('同じ列が選択肢式なら single のまま（区切り記号で複数回答に化けない）', () => {
    const options = ['〜5,000円', '5,001〜10,000円', '10,001〜30,000円', '30,001〜50,000円'];
    const table = makeTable(
      ['Q10. 今回の報酬はいくらでしたか'],
      [...options, ...options, ...options].map((v) => [v]),
    );
    const [question] = buildQuestions(table);

    expect(question.profileKey).toBe('reward');
    expect(question.kind).toBe('single');
    expect(question.delimiters).toEqual([]);
  });

  it('同じ profile.key に2列が当たったら2列目以降を "key-2" と一意化する', () => {
    const table = makeTable(
      ['年齢', '年齢 (2)'],
      [
        ['20代', '30代'],
        ['30代', '40代'],
        ['20代', '30代'],
      ],
    );
    const questions = buildQuestions(table);

    expect(questions.map((q) => q.key)).toEqual(['age', 'age-2']);
    expect(questions.map((q) => q.profileKey)).toEqual(['age', 'age']);
  });
});

describe('buildQuestions（派生質問 start-year-month）', () => {
  /** 年列と月列を離れた位置に持つ表 */
  function makeYearMonthTable(): RawTable {
    return makeTable(
      ['回答ID', '仕事を受注・開始した年', 'メモ欄', '仕事を受注・開始した月'],
      [
        ['R-A', '2024', 'よかった', '5月'],
        ['R-B', '2024', 'ふつう', '12月'],
        ['R-C', '2025', 'たいへんだった', '1月'],
        ['R-D', '2025', 'よかった', '3月'],
        ['R-E', '2024', 'ふつう', '5月'],
        ['R-F', '2025', 'たいへんだった', '12月'],
      ],
    );
  }

  it('start-year と start-month が揃ったら末尾に派生質問を追加する', () => {
    const questions = buildQuestions(makeYearMonthTable());

    expect(questions.map((q) => q.profileKey)).toContain('start-year');
    expect(questions.map((q) => q.profileKey)).toContain('start-month');

    const derived = questions[questions.length - 1];
    expect(derived.key).toBe('start-year-month');
    expect(derived.label).toBe('仕事を受注・開始した年月');
    expect(derived.kind).toBe('single');
    expect(derived.chart).toBe('line');
    expect(derived.order).toBe('natural');
    expect(derived.columnIndex).toBe(-1);
    expect(derived.derived).toEqual({ type: 'year-month', yearColumn: 1, monthColumn: 3 });
  });

  it('片方しか無ければ派生質問は作らない', () => {
    const yearOnly = makeTable(
      ['仕事を受注・開始した年'],
      [['2024'], ['2025'], ['2024'], ['2025']],
    );
    const questions = buildQuestions(yearOnly);

    expect(questions).toHaveLength(1);
    expect(questions.some((q) => q.key === 'start-year-month')).toBe(false);
  });
});

describe('buildDataset', () => {
  it('全行を included=true にし、RawTable のメタ情報を引き継ぐ', () => {
    const table = makeMixedTable();
    table.warnings.push('テスト警告');
    const ds = buildDataset(table);

    expect(ds.headers).toEqual(table.headers);
    expect(ds.rows).toHaveLength(table.rows.length);
    expect(ds.rows.map((r) => r.id)).toEqual(table.rows.map((_, i) => i));
    expect(ds.rows.every((r) => r.included)).toBe(true);
    expect(ds.rows[0].values).toEqual(table.rows[0]);
    expect(ds.delimiter).toBe(table.delimiter);
    expect(ds.warnings).toEqual(['テスト警告']);
    expect(ds.sourceName).toBe('テストデータ');
    expect(ds.questions.map((q) => q.key)).toEqual(['q1', 'q2', 'q3']);
  });
});
