/**
 * 数値パースと要約統計。
 *
 * アンケートの自由入力（"1万5千円" "3〜5時間" "約5,000円"）を数値へ寄せ、
 * ヒストグラム用のビンと要約統計を作る。すべて外部依存なしの純関数。
 */

import type { NumericSummary } from '../types.ts';

/** ビン1つ分 */
export interface NumericBin {
  label: string;
  count: number;
  /** 下限（含む） */
  from: number;
  /** 上限（最終ビン以外は含まない） */
  to: number;
}

/** 漢字の桁単位と倍率 */
const SCALE: Record<string, number> = {
  億: 100000000,
  万: 10000,
  千: 1000,
};

/** 範囲表記の区切り（"3〜5" "3~5" "3-5" "3から5"） */
const RANGE_SEPARATORS = ['〜', '～', '~', 'から', '-', '−', '‐', '–', '—'];

/** ビン幅の候補に使う仮数（1/2/5 × 10^n） */
const NICE_MANTISSA = [1, 2, 5];

/** 浮動小数の演算誤差（0.30000000000000004 など）を丸めて落とす */
function tidy(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  return Number(value.toPrecision(12));
}

/** 3桁区切り + 指定桁数の小数で整形する */
function formatNumber(value: number, decimals: number): string {
  const fixed = decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
  const negative = fixed.startsWith('-');
  const body = negative ? fixed.slice(1) : fixed;
  const dot = body.indexOf('.');
  const intPart = dot >= 0 ? body.slice(0, dot) : body;
  const fracPart = dot >= 0 ? body.slice(dot) : '';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fracPart}`;
}

/**
 * "1時間30分" のような時間表記を時間単位の数値にする。
 * 時・分どちらの表記も無ければ null を返し、通常の数値解釈に委ねる。
 */
function parseHours(t: string): number | null {
  const hour = t.match(/(\d+(?:\.\d+)?)\s*(?:時間|時|hours?|hrs?|h)/i);
  const minute = t.match(/(\d+(?:\.\d+)?)\s*(?:分|minutes?|mins?|m(?![a-z]))/i);
  if (!hour && !minute) return null;
  const h = hour ? Number(hour[1]) : 0;
  const m = minute ? Number(minute[1]) : 0;
  return tidy(h + m / 60);
}

/**
 * 「万」「千」「億」を解釈して1つの数値にまとめる。
 * 隣接し、かつ桁単位が小さくなっていく並びだけを合算する
 * （"3万5000" → 35000 / "2024-01" は "2024" で打ち切り）。
 */
function parseScaled(t: string): number | null {
  const re = /(\d+(?:\.\d+)?)\s*([億万千])?/g;
  let total = 0;
  let matched = false;
  let firstIndex = -1;
  let prevEnd = -1;
  let prevScale = Number.POSITIVE_INFINITY;
  let m: RegExpExecArray | null = re.exec(t);
  while (m !== null) {
    const value = Number(m[1]);
    const scale = m[2] ? SCALE[m[2]] : 1;
    if (!matched) {
      matched = true;
      firstIndex = m.index;
    } else if (m.index !== prevEnd || scale >= prevScale) {
      // 連続しない数値（別の意味を持つ数字）はここで打ち切る
      break;
    }
    total += value * scale;
    prevEnd = m.index + m[0].length;
    prevScale = scale;
    m = re.exec(t);
  }
  if (!matched) return null;
  // 先頭に付いた負号だけを符号として扱う
  if (firstIndex === 1 && (t.startsWith('-') || t.startsWith('−'))) {
    total = -total;
  }
  return tidy(total);
}

/** 範囲表記でない1つの値としてパースする */
function parseScalar(t: string, unit?: string): number | null {
  if (!/\d/.test(t)) return null;
  if (unit === '時間') {
    const hours = parseHours(t);
    if (hours !== null) return hours;
  }
  return parseScaled(t);
}

/**
 * 範囲表記なら [左辺, 右辺] を返す。
 * "2024-01" のような年月表記と負数は範囲扱いしない。
 */
function findRange(t: string): [string, string] | null {
  if (t.includes('年')) return null;
  if (/^\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?$/.test(t)) return null;
  for (let i = 1; i < t.length; i++) {
    for (const sep of RANGE_SEPARATORS) {
      if (!t.startsWith(sep, i)) continue;
      const left = t.slice(0, i);
      const right = t.slice(i + sep.length);
      if (/\d/.test(left) && /\d/.test(right)) return [left, right];
    }
  }
  return null;
}

/**
 * 日本語混じりの数値表現を数値へ。パースできなければ null。
 *
 * "12,000円" → 12000 / "1.5万円" → 15000 / "3万5000円" → 35000 /
 * "約5000円" → 5000 / "3〜5" → 4（範囲は両端の平均）/
 * "30分" → 0.5・"1時間30分" → 1.5（unit==='時間' のとき）。
 * 全角数字は NFKC で半角に寄せてから処理する。数字が1つも無ければ null。
 */
export function parseJapaneseNumber(s: string, unit?: string): number | null {
  if (!s) return null;
  let t = s.normalize('NFKC');
  // 空白類は意味を持たないので全部落とす
  t = t.replace(/\s+/g, '');
  if (t === '') return null;
  // 桁区切りカンマだけを除去する（"3,5" のような1〜2桁グループは残す）
  t = t.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  if (!/\d/.test(t)) return null;

  const range = findRange(t);
  if (range) {
    const [leftText, rightText] = range;
    const left = parseScalar(leftText, unit);
    const right = parseScalar(rightText, unit);
    if (left !== null && right !== null) {
      const hint = rightText.match(/[億万千]/);
      // "1〜3万円" のように単位が右辺だけに付く書き方を補う
      const scaled =
        hint && !/[億万千]/.test(leftText) ? left * SCALE[hint[0]] : left;
      return tidy((scaled + right) / 2);
    }
  }
  return parseScalar(t, unit);
}

/**
 * 数値配列の要約統計。
 * 空配列なら n=0（min/max/mean/median/p25/p75/sum は 0）で unit と unparsed だけ持つ。
 * median は偶数個のとき中央2値の平均、p25/p75 は補間せず
 * ソート済み配列の floor(n*0.25) / floor(n*0.75) 番目の値を採る。
 */
export function summarizeNumeric(
  values: number[],
  unit: string | undefined,
  unparsed: number,
): NumericSummary {
  const finite = values.filter((v) => Number.isFinite(v));
  const n = finite.length;
  if (n === 0) {
    return { n: 0, min: 0, max: 0, mean: 0, median: 0, p25: 0, p75: 0, sum: 0, unit, unparsed };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const sum = tidy(sorted.reduce((acc, v) => acc + v, 0));
  const median =
    n % 2 === 1
      ? sorted[(n - 1) / 2]
      : tidy((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: tidy(sum / n),
    median,
    p25: sorted[Math.min(n - 1, Math.floor(n * 0.25))],
    p75: sorted[Math.min(n - 1, Math.floor(n * 0.75))],
    sum,
    unit,
    unparsed,
  };
}

/**
 * ビン幅を「1/2/5 × 10^n」から選ぶ。
 * ビン数が 6〜12 に収まる候補を優先し、無ければ最も近いものを選ぶ。
 */
function chooseWidth(min: number, max: number): number {
  const span = max - min;
  const baseExp = Math.floor(Math.log10(span));
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let exp = baseExp - 3; exp <= baseExp + 2; exp++) {
    for (const mantissa of NICE_MANTISSA) {
      const width = tidy(mantissa * Math.pow(10, exp));
      if (!(width > 0)) continue;
      const count = binCountFor(min, max, width);
      if (count > 400) continue; // 細かすぎる候補は捨てる
      const score = count < 6 ? 6 - count + 0.5 : count > 12 ? count - 12 : 0;
      // 候補は幅の昇順に走査するので、同点なら細かい方が残る
      if (score < bestScore) {
        bestScore = score;
        best = width;
      }
    }
  }
  return best;
}

/** 幅 width のときのビン数（最終ビンは最大値を含む閉区間として数える） */
function binCountFor(min: number, max: number, width: number): number {
  const start = binStart(min, width);
  return Math.max(1, Math.ceil(tidy((max - start) / width)));
}

/** 下限を幅の倍数へ切り下げる */
function binStart(min: number, width: number): number {
  return tidy(Math.floor(tidy(min / width)) * width);
}

/**
 * ヒストグラム用のビンを作る。
 * 異なり値が10種類以下なら値そのものを1ビンにする（回数などの離散値向け）。
 * それ以外は「1/2/5 × 10^n」のきりの良い幅で 6〜12 個程度に分ける。
 * ラベルは "10,000〜19,999円" 形式。最終ビンだけ最大値を含む閉区間。
 */
export function makeBins(values: number[], unit?: string): NumericBin[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [];
  const suffix = unit ?? '';

  const counter = new Map<number, number>();
  for (const v of finite) counter.set(v, (counter.get(v) ?? 0) + 1);
  const distinct = [...counter.keys()].sort((a, b) => a - b);

  // 異なり値が少ない（＝離散値とみなせる）場合は値そのものをビンにする
  if (distinct.length <= 10) {
    const decimals = distinct.some((v) => !Number.isInteger(v)) ? 1 : 0;
    return distinct.map((v) => ({
      label: `${formatNumber(v, decimals)}${suffix}`,
      count: counter.get(v) ?? 0,
      from: v,
      to: v,
    }));
  }

  const min = distinct[0];
  const max = distinct[distinct.length - 1];
  const width = chooseWidth(min, max);
  const start = binStart(min, width);
  const binCount = binCountFor(min, max, width);
  // 値・幅・下限のいずれかに小数があるなら小数第1位まで表示する
  const fractional =
    distinct.some((v) => !Number.isInteger(v)) ||
    !Number.isInteger(width) ||
    !Number.isInteger(start);
  let decimals = fractional ? 1 : 0;
  // 幅が表示単位より細かいと区間表示が潰れるので桁を足す
  while (decimals < 4 && width < Math.pow(10, -decimals)) decimals += 1;
  const step = Math.pow(10, -decimals);

  const bins: NumericBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const from = tidy(start + i * width);
    const to = tidy(start + (i + 1) * width);
    // 表示上の上限は「次のビンの直前」にして区間が重ならないようにする。
    // ただし最終ビンだけは最大値を含む閉区間なので、
    // 最大値が境界にぴったり乗った場合 (例: 幅2000で最大20000) は
    // その最大値をラベルの上限にする。そうしないと
    // 「18,000〜19,999」というラベルの中に 20,000 が入ってしまう。
    const isLast = i === binCount - 1;
    const upper = isLast ? Math.max(tidy(to - step), max) : tidy(to - step);
    // 幅が表示単位と同じ (＝1ビンに1つの表示値しか入らない) ときは
    // "3〜3" のような潰れたラベルにせず、単一値として表示する
    const label =
      from === upper
        ? `${formatNumber(from, decimals)}${suffix}`
        : `${formatNumber(from, decimals)}〜${formatNumber(upper, decimals)}${suffix}`;
    bins.push({ label, count: 0, from, to });
  }
  for (const v of finite) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor(tidy((v - start) / width))));
    bins[index].count += 1;
  }
  return bins;
}
