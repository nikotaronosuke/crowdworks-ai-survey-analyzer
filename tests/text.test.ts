/**
 * src/core/text.ts のユニットテスト。
 *
 * 文字列ユーティリティは列名の照合・集計キー・並び替えの土台なので、
 * SPEC.md に明記された挙動（空欄判定の対象、自然順、ヘッダー正規化）を
 * 網羅的に固定する。
 */

import { describe, it, expect } from 'vitest';

import {
  isBlank,
  naturalCompare,
  normalizeHeader,
  normalizeKey,
  normalizeText,
  uniquifyHeaders,
} from '../src/core/text.ts';

describe('normalizeText', () => {
  it('全角英数字を NFKC で半角に寄せる', () => {
    expect(normalizeText('ＡＢＣ１２３')).toBe('ABC123');
    expect(normalizeText('ＣｈａｔＧＰＴ')).toBe('ChatGPT');
  });

  it('全角空白を半角空白として扱い、前後の空白を除去する', () => {
    expect(normalizeText('　全角　空白　')).toBe('全角 空白');
  });

  it('連続する空白を1つに圧縮する', () => {
    expect(normalizeText('  a   b  ')).toBe('a b');
    expect(normalizeText('a\t\tb')).toBe('a b');
  });

  it('空文字・空白のみは空文字になる', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('   ')).toBe('');
    expect(normalizeText('　')).toBe('');
  });

  it('改行コードを \\n に統一し、改行そのものは保持する（splitAnswers の区切りに使うため）', () => {
    expect(normalizeText('a\r\nb')).toBe('a\nb');
    expect(normalizeText('a\rb')).toBe('a\nb');
    expect(normalizeText('A \n B')).toBe('A\nB');
  });

  it('全角括弧は NFKC により半角括弧になる', () => {
    expect(normalizeText('その他（AAA）')).toBe('その他(AAA)');
  });
});

describe('normalizeKey', () => {
  it('小文字化する', () => {
    expect(normalizeKey('ChatGPT')).toBe('chatgpt');
    expect(normalizeKey('ＣｈａｔＧＰＴ')).toBe('chatgpt');
  });

  it('末尾の句読点を除去する', () => {
    expect(normalizeKey('回答。')).toBe('回答');
    expect(normalizeKey('回答、')).toBe('回答');
    expect(normalizeKey('answer.')).toBe('answer');
    expect(normalizeKey('answer,')).toBe('answer');
  });

  it('末尾以外の句読点は残す', () => {
    expect(normalizeKey('A、B')).toBe('a、b');
  });

  it('normalizeText と同じ空白正規化を行う', () => {
    expect(normalizeKey('  Ａ　Ｂ  ')).toBe('a b');
  });

  it('表記ゆれが同じキーに寄る', () => {
    expect(normalizeKey('ABC')).toBe(normalizeKey('ａｂｃ'));
  });
});

describe('isBlank', () => {
  it('null / undefined / 空文字 / 空白のみは空欄', () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank('　')).toBe(true);
  });

  it('ハイフン類は空欄', () => {
    expect(isBlank('-')).toBe(true);
    expect(isBlank('－')).toBe(true); // 全角ハイフンマイナスは NFKC で '-' に寄る
    expect(isBlank('‐')).toBe(true);
    expect(isBlank('—')).toBe(true);
  });

  it('N/A・null・undefined という文字列は空欄（大文字小文字を問わない）', () => {
    expect(isBlank('N/A')).toBe(true);
    expect(isBlank('n/a')).toBe(true);
    expect(isBlank('NA')).toBe(true);
    expect(isBlank('na')).toBe(true);
    expect(isBlank('null')).toBe(true);
    expect(isBlank('undefined')).toBe(true);
  });

  it('"なし" "特になし" "0" "ー" は有効回答なので空欄ではない', () => {
    expect(isBlank('なし')).toBe(false);
    expect(isBlank('特になし')).toBe(false);
    expect(isBlank('0')).toBe(false);
    expect(isBlank('ー')).toBe(false); // 長音記号。「なし」の意味ではないため有効扱い
  });

  it('通常の回答は空欄ではない', () => {
    expect(isBlank('ChatGPT')).toBe(false);
    expect(isBlank('わからない')).toBe(false);
  });
});

describe('normalizeHeader', () => {
  it('空白を全除去する', () => {
    expect(normalizeHeader('  性 別  ')).toBe('性別');
    expect(normalizeHeader('現在の 職種')).toBe('現在の職種');
  });

  it('末尾の ? ？ ： : を除去する', () => {
    expect(normalizeHeader('年齢?')).toBe('年齢');
    expect(normalizeHeader('年齢？')).toBe('年齢');
    expect(normalizeHeader('年齢:')).toBe('年齢');
    expect(normalizeHeader('年齢：')).toBe('年齢');
  });

  it('括弧・区切り記号を除去する', () => {
    expect(normalizeHeader('年齢（必須）')).toBe('年齢必須');
    expect(normalizeHeader('年齢【必須】')).toBe('年齢必須');
    expect(normalizeHeader('年齢「必須」')).toBe('年齢必須');
    expect(normalizeHeader('Q1. 年齢を教えてください（必須）')).toBe('q1年齢を教えてください必須');
  });

  it('SPEC の ai-tools エイリアス例と同じ形になる', () => {
    expect(normalizeHeader('使用したAI・AIツールは？')).toBe('使用したaiaiツールは');
    expect(normalizeHeader('使用したＡＩ／ＡＩツール')).toBe('使用したaiaiツール');
  });

  it('表記ゆれのある列名が同じ形に寄る', () => {
    expect(normalizeHeader('仕事を受注・開始した年')).toBe(normalizeHeader('仕事を受注、開始した年'));
  });
});

describe('naturalCompare', () => {
  it('文字列中の数値を数値として比較する', () => {
    expect(naturalCompare('10代', '20代')).toBeLessThan(0);
    expect(naturalCompare('20代', '10代')).toBeGreaterThan(0);
    expect(naturalCompare('10代', '10代')).toBe(0);
  });

  it('辞書順では逆転してしまうケースを正しく並べる', () => {
    // 単純な文字列比較では "10代" > "2代" になってしまう
    expect(naturalCompare('2代', '10代')).toBeLessThan(0);
  });

  it('年月ラベルを昇順に比較する', () => {
    expect(naturalCompare('2024-01', '2024-02')).toBeLessThan(0);
    expect(naturalCompare('2024-02', '2024-01')).toBeGreaterThan(0);
    expect(naturalCompare('2023-12', '2024-01')).toBeLessThan(0);
  });

  it('金額レンジのラベルを数値順に比較する', () => {
    expect(naturalCompare('1万円未満', '3万円未満')).toBeLessThan(0);
    expect(naturalCompare('5,000円', '10,000円')).toBeLessThan(0); // 桁区切りカンマを無視する
  });

  it('数値を含まない場合は日本語ロケールの文字列比較にフォールバックする', () => {
    expect(naturalCompare('あ', 'い')).toBeLessThan(0);
    expect(naturalCompare('あ', 'あ')).toBe(0);
  });

  it('sort に渡すと自然順に並ぶ', () => {
    expect(['30代', '10代', '70代以上', '20代'].sort(naturalCompare)).toEqual([
      '10代',
      '20代',
      '30代',
      '70代以上',
    ]);
    expect(['2024-10', '2024-02', '2024-01'].sort(naturalCompare)).toEqual([
      '2024-01',
      '2024-02',
      '2024-10',
    ]);
  });
});

describe('uniquifyHeaders', () => {
  it('重複しない列名はそのまま返す', () => {
    expect(uniquifyHeaders(['年齢', '性別'])).toEqual(['年齢', '性別']);
  });

  it('重複する列名に (2) (3) を付ける', () => {
    expect(uniquifyHeaders(['名前', '名前', '名前'])).toEqual(['名前', '名前 (2)', '名前 (3)']);
  });

  it('付与した連番が既存の名前と衝突する場合は番号を進める', () => {
    expect(uniquifyHeaders(['名前', '名前 (2)', '名前'])).toEqual([
      '名前',
      '名前 (2)',
      '名前 (3)',
    ]);
  });

  it('空文字はそのまま残す（空ヘッダーの命名は parse.ts の責務）', () => {
    expect(uniquifyHeaders(['', 'a', ''])).toEqual(['', 'a', '']);
  });

  it('元の配列と同じ長さを返す', () => {
    expect(uniquifyHeaders(['a', 'a', 'b', 'a'])).toEqual(['a', 'a (2)', 'b', 'a (3)']);
  });
});
