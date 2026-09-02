/**
 * src/core/splitter.ts のユニットテスト。
 *
 * 複数回答セルの分割は誤爆が集計結果を直接壊すため、
 * 「括弧内のカンマで分割しない」「改行区切り」「重複除去」を重点的に確認する。
 */

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_DELIMITERS,
  SAFE_DELIMITERS,
  canonicalizeOption,
  splitAnswers,
} from '../src/core/splitter.ts';

describe('区切り文字の定義', () => {
  it('DEFAULT_DELIMITERS は想定しうる全区切り文字', () => {
    expect(DEFAULT_DELIMITERS).toEqual(['\n', ',', '、', ';', '；', '|', '｜', '/', '・']);
  });

  it('SAFE_DELIMITERS は自由記述で誤爆しやすい "/" と "・" を除く', () => {
    expect(SAFE_DELIMITERS).toEqual(['\n', ',', '、', ';', '；', '|', '｜']);
    expect(SAFE_DELIMITERS).not.toContain('/');
    expect(SAFE_DELIMITERS).not.toContain('・');
  });
});

describe('splitAnswers - 基本の分割', () => {
  it('読点・カンマ・セミコロン・縦棒で分割する', () => {
    expect(splitAnswers('ChatGPT、Claude', SAFE_DELIMITERS)).toEqual(['ChatGPT', 'Claude']);
    expect(splitAnswers('ChatGPT,Claude', SAFE_DELIMITERS)).toEqual(['ChatGPT', 'Claude']);
    expect(splitAnswers('ChatGPT;Claude', SAFE_DELIMITERS)).toEqual(['ChatGPT', 'Claude']);
    expect(splitAnswers('ChatGPT；Claude', SAFE_DELIMITERS)).toEqual(['ChatGPT', 'Claude']);
    expect(splitAnswers('ChatGPT|Claude', SAFE_DELIMITERS)).toEqual(['ChatGPT', 'Claude']);
    expect(splitAnswers('ChatGPT｜Claude', SAFE_DELIMITERS)).toEqual(['ChatGPT', 'Claude']);
  });

  it('改行で分割する', () => {
    expect(splitAnswers('ChatGPT\nClaude\nGemini', SAFE_DELIMITERS)).toEqual([
      'ChatGPT',
      'Claude',
      'Gemini',
    ]);
  });

  it('CRLF / CR も改行として分割する', () => {
    expect(splitAnswers('A\r\nB\rC', SAFE_DELIMITERS)).toEqual(['A', 'B', 'C']);
  });

  it('分割後に normalizeText を適用する', () => {
    expect(splitAnswers('  ChatGPT 、 ＣＬＡＵＤＥ  ', SAFE_DELIMITERS)).toEqual([
      'ChatGPT',
      'CLAUDE',
    ]);
  });

  it('SAFE_DELIMITERS は "/" と "・" で分割しない', () => {
    expect(splitAnswers('A/B・C', SAFE_DELIMITERS)).toEqual(['A/B・C']);
  });

  it('DEFAULT_DELIMITERS なら "/" と "・" でも分割する', () => {
    expect(splitAnswers('A/B・C', DEFAULT_DELIMITERS)).toEqual(['A', 'B', 'C']);
  });

  it('delimiters が空配列ならセル全体を1要素として返す', () => {
    expect(splitAnswers('A、B\nC', [])).toEqual(['A、B\nC']);
  });

  it('区切り文字を含まないセルは1要素', () => {
    expect(splitAnswers('ChatGPT', SAFE_DELIMITERS)).toEqual(['ChatGPT']);
  });
});

describe('splitAnswers - 括弧内では分割しない', () => {
  it('全角括弧の中のカンマ・読点で分割しない', () => {
    // 全角括弧は normalizeText の NFKC により半角括弧になる
    expect(splitAnswers('その他（AAA、BBB）', SAFE_DELIMITERS)).toEqual(['その他(AAA、BBB)']);
    expect(splitAnswers('その他（AAA、BBB）、ChatGPT', SAFE_DELIMITERS)).toEqual([
      'その他(AAA、BBB)',
      'ChatGPT',
    ]);
  });

  it('半角括弧の中でも分割しない', () => {
    expect(splitAnswers('その他(X,Y),Z', SAFE_DELIMITERS)).toEqual(['その他(X,Y)', 'Z']);
  });

  it('【】「」『』 の中でも分割しない', () => {
    expect(splitAnswers('【A、B】、C', SAFE_DELIMITERS)).toEqual(['【A、B】', 'C']);
    expect(splitAnswers('「A、B」、C', SAFE_DELIMITERS)).toEqual(['「A、B」', 'C']);
    expect(splitAnswers('『A、B』、C', SAFE_DELIMITERS)).toEqual(['『A、B』', 'C']);
  });

  it('入れ子の括弧でも深さを正しく数える', () => {
    expect(splitAnswers('その他（A（B、C）、D）、E', SAFE_DELIMITERS)).toEqual([
      'その他(A(B、C)、D)',
      'E',
    ]);
  });

  it('括弧内の改行でも分割しない', () => {
    expect(splitAnswers('その他（A\nB）\nC', SAFE_DELIMITERS)).toEqual(['その他(A\nB)', 'C']);
  });

  it('対応の取れない閉じ括弧があっても以降の分割が壊れない', () => {
    expect(splitAnswers('A）、B', SAFE_DELIMITERS)).toEqual(['A)', 'B']);
  });
});

describe('splitAnswers - 二重引用符の中では分割しない', () => {
  it('引用符で囲まれた範囲の区切り文字を無視し、外側の引用符は外す', () => {
    expect(splitAnswers('"A、B",C', SAFE_DELIMITERS)).toEqual(['A、B', 'C']);
  });

  it('引用符の中の改行でも分割しない', () => {
    expect(splitAnswers('"A\nB"\nC', SAFE_DELIMITERS)).toEqual(['A\nB', 'C']);
  });

  it('TSV で残った引用符付きの選択肢は引用符を外す（表記ゆれ防止）', () => {
    expect(splitAnswers('"ChatGPT"、Claude', SAFE_DELIMITERS)).toEqual(['ChatGPT', 'Claude']);
  });

  it('途中にしか引用符が無い場合は本文として残す', () => {
    expect(splitAnswers('5"モニタ、A', SAFE_DELIMITERS)).toEqual(['5"モニタ', 'A']);
  });
});

describe('splitAnswers - 空要素の除去', () => {
  it('空セルは空配列', () => {
    expect(splitAnswers('', SAFE_DELIMITERS)).toEqual([]);
    expect(splitAnswers('   ', SAFE_DELIMITERS)).toEqual([]);
    expect(splitAnswers('　', SAFE_DELIMITERS)).toEqual([]);
  });

  it('区切り文字だけのセルは空配列', () => {
    expect(splitAnswers('、、、', SAFE_DELIMITERS)).toEqual([]);
  });

  it('空欄トークン（"-" や "N/A"）は除去する', () => {
    expect(splitAnswers('A、、B、 、-、N/A、C', SAFE_DELIMITERS)).toEqual(['A', 'B', 'C']);
  });

  it('"なし" "0" は有効回答なので残す', () => {
    expect(splitAnswers('なし、0', SAFE_DELIMITERS)).toEqual(['なし', '0']);
  });
});

describe('splitAnswers - 同一回答者内の重複除去', () => {
  it('同じ回答が複数回現れても1つにまとめる', () => {
    expect(splitAnswers('ChatGPT、Claude、ChatGPT', SAFE_DELIMITERS)).toEqual([
      'ChatGPT',
      'Claude',
    ]);
  });

  it('重複判定は normalizeKey ベース（大文字小文字・全角半角を無視）', () => {
    expect(splitAnswers('ChatGPT、chatgpt、ＣｈａｔＧＰＴ', SAFE_DELIMITERS)).toEqual(['ChatGPT']);
  });

  it('末尾の句読点だけが違う回答も重複とみなす', () => {
    expect(splitAnswers('AI、AI。', SAFE_DELIMITERS)).toEqual(['AI']);
  });

  it('最初に現れた表記を残す', () => {
    expect(splitAnswers('ｃｈａｔｇｐｔ、ChatGPT', SAFE_DELIMITERS)).toEqual(['chatgpt']);
  });

  it('改行区切りでも重複を除去する', () => {
    expect(splitAnswers('A\nB\nA\nB\nC', SAFE_DELIMITERS)).toEqual(['A', 'B', 'C']);
  });
});

describe('canonicalizeOption', () => {
  it('対応表が無ければ normalizeText した値を返す', () => {
    expect(canonicalizeOption('  ＣｈａｔＧＰＴ  ')).toBe('ChatGPT');
    expect(canonicalizeOption('  Claude ')).toBe('Claude');
  });

  it('対応表に載っていれば正規ラベルへ寄せる', () => {
    const aliases = { ChatGPT: 'ChatGPT (OpenAI)' };
    expect(canonicalizeOption('ChatGPT', aliases)).toBe('ChatGPT (OpenAI)');
  });

  it('照合は normalizeKey ベース（大文字小文字・全角半角・末尾句読点を無視）', () => {
    const aliases = { ChatGPT: 'ChatGPT (OpenAI)' };
    expect(canonicalizeOption('chatgpt', aliases)).toBe('ChatGPT (OpenAI)');
    expect(canonicalizeOption('ＣｈａｔＧＰＴ', aliases)).toBe('ChatGPT (OpenAI)');
    expect(canonicalizeOption(' ChatGPT 。', aliases)).toBe('ChatGPT (OpenAI)');
  });

  it('対応表にヒットしなければ normalizeText した値を返す', () => {
    const aliases = { ChatGPT: 'ChatGPT (OpenAI)' };
    expect(canonicalizeOption('  Gemini  ', aliases)).toBe('Gemini');
  });

  it('空文字は空文字', () => {
    expect(canonicalizeOption('')).toBe('');
    expect(canonicalizeOption('', { ChatGPT: 'ChatGPT (OpenAI)' })).toBe('');
  });

  it('同じ対応表を繰り返し使っても結果が変わらない（照合表のキャッシュ）', () => {
    const aliases = { 'gpt-4': 'GPT-4', ChatGPT: 'ChatGPT (OpenAI)' };
    expect(canonicalizeOption('GPT-4', aliases)).toBe('GPT-4');
    expect(canonicalizeOption('chatgpt', aliases)).toBe('ChatGPT (OpenAI)');
    expect(canonicalizeOption('chatgpt', aliases)).toBe('ChatGPT (OpenAI)');
  });
});
