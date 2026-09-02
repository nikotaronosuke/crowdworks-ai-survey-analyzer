/**
 * src/core/parse.ts のテスト。
 *
 * 区切り文字の推定（detectDelimiter）と、
 * CSV/TSV テキストから RawTable を作る処理（parseText）の仕様を検証する。
 * parseText は「例外を投げず warnings に理由を積む」契約なので、
 * 戻り値の rows/headers と warnings の両方を確認する。
 */

import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseText } from '../src/core/parse.ts';

/**
 * warnings のいずれかが指定の部分文字列を含むか。
 * 文言の細部に依存しすぎないよう、キーワードだけで判定する。
 */
function hasWarning(warnings: string[], fragment: string): boolean {
  return warnings.some((w) => w.includes(fragment));
}

describe('detectDelimiter', () => {
  it('カンマ区切りを "," と判定する', () => {
    const text = '名前,年齢,職種\n田中,30,ライター\n鈴木,40,デザイナー';
    expect(detectDelimiter(text)).toBe(',');
  });

  it('タブ区切りを "\\t" と判定する', () => {
    const text = '名前\t年齢\t職種\n田中\t30\tライター\n鈴木\t40\tデザイナー';
    expect(detectDelimiter(text)).toBe('\t');
  });

  it('セル内にカンマを含むTSVでも "\\t" と判定する（出現回数が安定している方を選ぶ）', () => {
    const text =
      '名前\t感想\n' +
      '田中\tとても,よかった\n' +
      '鈴木\tまあまあ,だった\n' +
      '佐藤\t特に問題なし';
    expect(detectDelimiter(text)).toBe('\t');
  });

  it('引用符の中にある区切り文字は数えない', () => {
    // 引用符内のタブを無視できないと "\t" 判定になってしまうケース
    const text = '名前,コメント\n田中,"a\tb\tc\td"\n鈴木,"e\tf\tg\th"';
    expect(detectDelimiter(text)).toBe(',');
  });

  it('セミコロン区切り・パイプ区切りも判定できる', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6')).toBe(';');
    expect(detectDelimiter('a|b|c\n1|2|3\n4|5|6')).toBe('|');
  });

  it('候補がどれも見つからなければ "," を返す', () => {
    expect(detectDelimiter('ひとつの列しかない\nデータ本文\nもう一行')).toBe(',');
  });
});

describe('parseText', () => {
  it('CSV の1行目をヘッダーとして読み、残りをデータ行にする', () => {
    const table = parseText('名前,年齢,職種\n田中,30,ライター\n鈴木,40,デザイナー');

    expect(table.headers).toEqual(['名前', '年齢', '職種']);
    expect(table.rows).toEqual([
      ['田中', '30', 'ライター'],
      ['鈴木', '40', 'デザイナー'],
    ]);
    expect(table.delimiter).toBe(',');
    expect(table.warnings).toEqual([]);
  });

  it('TSV も同じように読める', () => {
    const table = parseText('名前\t年齢\n田中\t30\n鈴木\t40');

    expect(table.headers).toEqual(['名前', '年齢']);
    expect(table.rows).toEqual([
      ['田中', '30'],
      ['鈴木', '40'],
    ]);
    expect(table.delimiter).toBe('\t');
  });

  it('引用符で囲まれたカンマはセルの一部として保持する', () => {
    const table = parseText('名前,コメント\n田中,"あ,い,う"\n鈴木,"え,お"');

    expect(table.headers).toEqual(['名前', 'コメント']);
    expect(table.rows).toEqual([
      ['田中', 'あ,い,う'],
      ['鈴木', 'え,お'],
    ]);
  });

  it('引用符の中の改行は行の区切りにしない', () => {
    const table = parseText('名前,コメント\n田中,"1行目\n2行目"\n鈴木,ふつう');

    expect(table.rows).toEqual([
      ['田中', '1行目\n2行目'],
      ['鈴木', 'ふつう'],
    ]);
  });

  it('全セルが空の行はスキップし、件数を warnings に載せる', () => {
    const table = parseText('名前,年齢\n田中,30\n\n鈴木,40');

    expect(table.rows).toEqual([
      ['田中', '30'],
      ['鈴木', '40'],
    ]);
    expect(hasWarning(table.warnings, '空行')).toBe(true);
    expect(table.warnings.some((w) => /空行を 1 件/.test(w))).toBe(true);
  });

  it('空欄扱いの記号（"-" や "N/A"）だけの行も空行として除外する', () => {
    const table = parseText('名前,年齢\n田中,30\n-,N/A\n鈴木,40');

    expect(table.rows).toEqual([
      ['田中', '30'],
      ['鈴木', '40'],
    ]);
    expect(hasWarning(table.warnings, '空行')).toBe(true);
  });

  it('列数が足りない行は空文字で補完する', () => {
    const table = parseText('名前,年齢,職種\n田中,30\n鈴木,40,デザイナー');

    expect(table.rows[0]).toEqual(['田中', '30', '']);
    expect(table.rows[0].length).toBe(table.headers.length);
    expect(table.rows[1]).toEqual(['鈴木', '40', 'デザイナー']);
  });

  it('列数がヘッダーより多い行は超過分を捨て、warnings に載せる', () => {
    const table = parseText('名前,年齢\n田中,30,余分な値');

    expect(table.rows).toEqual([['田中', '30']]);
    expect(hasWarning(table.warnings, '列数')).toBe(true);
  });

  it('重複したヘッダーを "名前 (2)" の形で一意化し、warnings に載せる', () => {
    const table = parseText('名前,名前,名前,年齢\nA,B,C,30');

    expect(table.headers).toEqual(['名前', '名前 (2)', '名前 (3)', '年齢']);
    expect(hasWarning(table.warnings, '重複')).toBe(true);
  });

  it('先頭の BOM を取り除いてからヘッダーを読む', () => {
    // BOM が残ると先頭列だけ列名が一致しなくなるため、除去を明示的に確認する
    const table = parseText('\ufeff名前,年齢\n田中,30');

    expect(table.headers).toEqual(['名前', '年齢']);
    expect(table.headers[0].includes('\ufeff')).toBe(false);
    expect(table.rows).toEqual([['田中', '30']]);
  });

  it('空のヘッダーには "列N"（1始まり）という名前を付ける', () => {
    const table = parseText('名前,,年齢,\n田中,x,30,y');

    expect(table.headers).toEqual(['名前', '列2', '年齢', '列4']);
    expect(table.rows).toEqual([['田中', 'x', '30', 'y']]);
  });

  it('ヘッダーの前後空白は正規化される', () => {
    const table = parseText('  名前  ,　年齢　\n田中,30');

    expect(table.headers).toEqual(['名前', '年齢']);
  });

  it('sourceName は指定があればそれを、無ければ既定値を使う', () => {
    expect(parseText('a,b\n1,2', 'survey.csv').sourceName).toBe('survey.csv');
    expect(parseText('a,b\n1,2').sourceName).toBe('貼り付けデータ');
  });

  it('中身が空なら例外にせず、空の RawTable と warnings を返す', () => {
    const table = parseText('');

    expect(table.headers).toEqual([]);
    expect(table.rows).toEqual([]);
    expect(hasWarning(table.warnings, 'データが空です')).toBe(true);
  });

  it('ヘッダー行だけでもデータ行0件として読める', () => {
    const table = parseText('名前,年齢');

    expect(table.headers).toEqual(['名前', '年齢']);
    expect(table.rows).toEqual([]);
  });
});
