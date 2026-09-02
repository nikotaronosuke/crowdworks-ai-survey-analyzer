/**
 * src/core/numeric.ts のユニットテスト。
 *
 * SPEC.md の parseJapaneseNumber の対応例をすべて含める。
 * 要約統計とビン分割は「空配列」「離散値」「連続値」「最終ビンが最大値を含む」を確認する。
 */

import { describe, it, expect } from 'vitest';

import { makeBins, parseJapaneseNumber, summarizeNumeric } from '../src/core/numeric.ts';

describe('parseJapaneseNumber', () => {
  it('SPEC に列挙された対応例をすべて満たす', () => {
    expect(parseJapaneseNumber('12,000円')).toBe(12000);
    expect(parseJapaneseNumber('1万円')).toBe(10000);
    expect(parseJapaneseNumber('1.5万円')).toBe(15000);
    expect(parseJapaneseNumber('3万5000円')).toBe(35000);
    expect(parseJapaneseNumber('10万')).toBe(100000);
    expect(parseJapaneseNumber('約5000円')).toBe(5000);
    expect(parseJapaneseNumber('3時間')).toBe(3);
    expect(parseJapaneseNumber('30分', '時間')).toBe(0.5);
    expect(parseJapaneseNumber('3h')).toBe(3);
    expect(parseJapaneseNumber('5回')).toBe(5);
    expect(parseJapaneseNumber('0')).toBe(0);
    expect(parseJapaneseNumber('3〜5')).toBe(4);
    expect(parseJapaneseNumber('5000円以上')).toBe(5000);
    expect(parseJapaneseNumber('1万円未満')).toBe(10000);
  });

  it('全角数字を半角に正規化してから処理する', () => {
    expect(parseJapaneseNumber('１２０００円')).toBe(12000);
    expect(parseJapaneseNumber('３万５０００円')).toBe(35000);
    expect(parseJapaneseNumber('１.５万円')).toBe(15000);
  });

  it('数字が1つも無ければ null', () => {
    expect(parseJapaneseNumber('')).toBeNull();
    expect(parseJapaneseNumber('なし')).toBeNull();
    expect(parseJapaneseNumber('わからない')).toBeNull();
    expect(parseJapaneseNumber('-')).toBeNull();
    expect(parseJapaneseNumber('   ')).toBeNull();
  });

  it('0 は null ではなく 0 を返す（"なし"と区別する）', () => {
    expect(parseJapaneseNumber('0')).toBe(0);
    expect(parseJapaneseNumber('0回')).toBe(0);
    expect(parseJapaneseNumber('0円')).toBe(0);
  });

  it('桁区切りカンマを除去する', () => {
    expect(parseJapaneseNumber('1,234,567円')).toBe(1234567);
    expect(parseJapaneseNumber('100,001円以上')).toBe(100001);
  });

  it('範囲表記は両端の中央値を返す', () => {
    expect(parseJapaneseNumber('3〜5')).toBe(4);
    expect(parseJapaneseNumber('3～5')).toBe(4); // 全角チルダ
    expect(parseJapaneseNumber('3~5')).toBe(4);
    expect(parseJapaneseNumber('3から5')).toBe(4);
    expect(parseJapaneseNumber('5,001〜10,000円')).toBe(7500.5);
  });

  it('単位が右辺だけに付く範囲表記を補う', () => {
    expect(parseJapaneseNumber('1〜3万円')).toBe(20000);
    expect(parseJapaneseNumber('1万円〜3万円未満')).toBe(20000);
  });

  it('unit==="時間" のとき時分表記を時間の小数にする', () => {
    expect(parseJapaneseNumber('30分', '時間')).toBe(0.5);
    expect(parseJapaneseNumber('90分', '時間')).toBe(1.5);
    expect(parseJapaneseNumber('1時間30分', '時間')).toBe(1.5);
    expect(parseJapaneseNumber('3時間', '時間')).toBe(3);
    expect(parseJapaneseNumber('3h', '時間')).toBe(3);
  });

  it('年月表記は範囲扱いせず先頭の数値を返す', () => {
    expect(parseJapaneseNumber('2024-01')).toBe(2024);
    expect(parseJapaneseNumber('2024年')).toBe(2024);
    expect(parseJapaneseNumber('1月')).toBe(1);
    expect(parseJapaneseNumber('12月')).toBe(12);
  });

  it('選択肢ラベルの「以上」「未満」を無視して数値を取り出す', () => {
    expect(parseJapaneseNumber('20時間以上')).toBe(20);
    expect(parseJapaneseNumber('4回以上')).toBe(4);
    expect(parseJapaneseNumber('〜5,000円')).toBe(5000);
  });
});

describe('summarizeNumeric', () => {
  it('空配列なら n=0 で各統計量は 0', () => {
    expect(summarizeNumeric([], '円', 3)).toEqual({
      n: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      p25: 0,
      p75: 0,
      sum: 0,
      unit: '円',
      unparsed: 3,
    });
  });

  it('奇数個のとき中央値は中央の値', () => {
    const s = summarizeNumeric([3, 1, 2], undefined, 0);
    expect(s.n).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(3);
    expect(s.sum).toBe(6);
    expect(s.mean).toBe(2);
    expect(s.median).toBe(2);
  });

  it('偶数個のとき中央値は中央2値の平均', () => {
    const s = summarizeNumeric([1, 2, 3, 4], '円', 2);
    expect(s.n).toBe(4);
    expect(s.median).toBe(2.5);
    expect(s.mean).toBe(2.5);
    expect(s.sum).toBe(10);
    expect(s.unit).toBe('円');
    expect(s.unparsed).toBe(2);
  });

  it('四分位は線形補間せずソート済み配列の値をそのまま採る', () => {
    const s = summarizeNumeric([10, 20, 30, 40, 50, 60, 70, 80], undefined, 0);
    // floor(8*0.25)=2 番目 / floor(8*0.75)=6 番目（0始まり）
    expect(s.p25).toBe(30);
    expect(s.p75).toBe(70);
    expect(s.p25 % 10).toBe(0); // 補間していれば小数が出る
    expect(s.p75 % 10).toBe(0);
  });

  it('入力順に依存せず、元の配列を破壊しない', () => {
    const values = [5, 1, 4, 2, 3];
    const s = summarizeNumeric(values, undefined, 0);
    expect(values).toEqual([5, 1, 4, 2, 3]);
    expect(s.median).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
  });

  it('浮動小数の誤差を丸めて返す', () => {
    const s = summarizeNumeric([0.1, 0.2], undefined, 0);
    expect(s.sum).toBe(0.3);
    expect(s.mean).toBe(0.15);
  });

  it('unparsed と unit をそのまま保持する', () => {
    const s = summarizeNumeric([1], '時間', 7);
    expect(s.unit).toBe('時間');
    expect(s.unparsed).toBe(7);
  });
});

describe('makeBins', () => {
  it('空配列なら空のビン列', () => {
    expect(makeBins([], '円')).toEqual([]);
  });

  it('異なり値が10種類以下なら値そのものをビンにする', () => {
    expect(makeBins([0, 1, 1, 2, 3], '回')).toEqual([
      { label: '0回', count: 1, from: 0, to: 0 },
      { label: '1回', count: 2, from: 1, to: 1 },
      { label: '2回', count: 1, from: 2, to: 2 },
      { label: '3回', count: 1, from: 3, to: 3 },
    ]);
  });

  it('異なり値がちょうど10種類でも値そのものをビンにする', () => {
    const bins = makeBins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '回');
    expect(bins).toHaveLength(10);
    expect(bins.every((b) => b.from === b.to)).toBe(true);
    expect(bins.map((b) => b.count)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('unit を省略するとラベルに単位を付けない', () => {
    expect(makeBins([1, 2]).map((b) => b.label)).toEqual(['1', '2']);
  });

  it('離散値ビンのラベルは3桁区切り', () => {
    expect(makeBins([1000, 100000], '円').map((b) => b.label)).toEqual(['1,000円', '100,000円']);
  });

  it('異なり値が多いときは きりの良い幅で 6〜12 個のビンを作る', () => {
    const values = Array.from({ length: 21 }, (_, i) => i * 1000); // 0〜20000
    const bins = makeBins(values, '円');
    expect(bins.length).toBeGreaterThanOrEqual(6);
    expect(bins.length).toBeLessThanOrEqual(12);
    expect(bins[0].from).toBe(0);
    expect(bins[0].to).toBe(2000);
    expect(bins[0].label).toBe('0〜1,999円');
    expect(bins[1].label).toBe('2,000〜3,999円');
  });

  it('ビンは隙間なく連続し、全件がいずれかのビンに入る', () => {
    const values = Array.from({ length: 21 }, (_, i) => i * 1000);
    const bins = makeBins(values, '円');
    for (let i = 0; i < bins.length - 1; i++) {
      expect(bins[i].to).toBe(bins[i + 1].from);
    }
    expect(bins.reduce((acc, b) => acc + b.count, 0)).toBe(values.length);
  });

  it('最終ビンは最大値を含む（閉区間）', () => {
    const values = Array.from({ length: 21 }, (_, i) => i * 1000); // 最大 20000 は境界値
    const bins = makeBins(values, '円');
    const last = bins[bins.length - 1];
    expect(last.to).toBe(20000);
    // 18000 / 19000 / 20000 の3件。境界の 20000 がはみ出さずに最終ビンへ入る
    expect(last.count).toBe(3);
  });

  it('ラベルの末尾に unit を付ける', () => {
    const values = Array.from({ length: 21 }, (_, i) => i * 1000);
    expect(makeBins(values, '円').every((b) => b.label.endsWith('円'))).toBe(true);
    expect(makeBins(values).every((b) => !b.label.endsWith('円'))).toBe(true);
  });
});
