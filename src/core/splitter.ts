/**
 * 複数回答セルの分割。
 *
 * 「その他（AAA、BBB）」のような括弧付きの回答を壊さないため、
 * 正規表現の split ではなく 1 文字ずつ走査するスキャナで分割する。
 */

import { isBlank, normalizeKey, normalizeText } from './text.ts';

/** 想定しうる全区切り文字。自由記述では誤爆しうるので明示的に選んだときだけ使う */
export const DEFAULT_DELIMITERS: string[] = ['\n', ',', '、', ';', '；', '|', '｜', '/', '・'];

/** 既定の区切り文字。"/" と "・" は自由記述での誤爆が多いため外してある */
export const SAFE_DELIMITERS: string[] = ['\n', ',', '、', ';', '；', '|', '｜'];

/** 深さを数える括弧の対応（開き → 閉じ） */
const BRACKET_PAIRS: Record<string, string> = {
  '(': ')',
  '（': '）',
  '【': '】',
  '「': '」',
  '『': '』',
};

/** 開き括弧の集合 */
const OPEN_BRACKETS = new Set<string>(Object.keys(BRACKET_PAIRS));

/** 閉じ括弧の集合 */
const CLOSE_BRACKETS = new Set<string>(Object.values(BRACKET_PAIRS));

/**
 * セルを区切り文字で分割し、正規化・空要素除去・同一セル内の重複除去を行う。
 *
 * - 改行は "\r\n" / "\r" を "\n" に統一してから走査する
 * - 括弧の深さが 0 で、かつ二重引用符の外にあるときだけ区切る
 *   （"その他（AAA、BBB）" を 1 つの回答として保つため）
 * - 各断片は normalizeText し、空欄判定に当たるものは捨てる
 * - 同一セル内の重複は normalizeKey が一致したら重複とみなし、最初の 1 つだけ残す
 * - delimiters が空配列なら分割せず、セル全体を 1 要素として返す
 *
 * @param cell 元のセル値
 * @param delimiters 区切り文字の配列
 * @returns 分割・正規化済みの回答配列（空欄なら空配列）
 */
export function splitAnswers(cell: string, delimiters: string[]): string[] {
  if (!cell) return [];
  // 改行コードを \n に統一する
  const text = cell.replace(/\r\n?/g, '\n');

  if (delimiters.length === 0) {
    const whole = normalizeText(text);
    return isBlank(whole) ? [] : [whole];
  }

  const delimiterSet = new Set<string>(delimiters);
  let scan = scanFragments(text, delimiterSet, true);
  if (scan.unterminatedQuote) {
    // 引用符が閉じないまま終端に達した ＝ その `"` は引用符ではなく本文の一部
    // （例: `5"モニタ、A`）。引用符を無視して走査し直す。
    scan = scanFragments(text, delimiterSet, false);
  }
  const fragments = scan.fragments;

  const seen = new Set<string>();
  const answers: string[] = [];
  for (const fragment of fragments) {
    const value = unwrapQuotes(normalizeText(fragment));
    if (isBlank(value)) continue;
    const key = normalizeKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    answers.push(value);
  }
  return answers;
}

/**
 * セルを1文字ずつ走査して断片に切り分ける。
 *
 * 括弧の深さが 0 で、かつ引用符の外にある区切り文字だけを区切りとして扱う。
 * honorQuotes=false のときは `"` を普通の文字として扱う（再走査用）。
 */
function scanFragments(
  text: string,
  delimiterSet: Set<string>,
  honorQuotes: boolean,
): { fragments: string[]; unterminatedQuote: boolean } {
  const fragments: string[] = [];
  let buffer = '';
  let depth = 0;
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (honorQuotes && ch === '"') {
      // 引用符の開始・終了。文字自体はここでは残す（後段の unwrapQuotes で外す）
      inQuote = !inQuote;
      buffer += ch;
      continue;
    }
    if (!inQuote) {
      if (OPEN_BRACKETS.has(ch)) {
        depth++;
        buffer += ch;
        continue;
      }
      if (CLOSE_BRACKETS.has(ch)) {
        // 対応の取れない閉じ括弧で深さが負にならないようにする
        if (depth > 0) depth--;
        buffer += ch;
        continue;
      }
      if (depth === 0 && delimiterSet.has(ch)) {
        fragments.push(buffer);
        buffer = '';
        continue;
      }
    }
    buffer += ch;
  }
  fragments.push(buffer);
  return { fragments, unterminatedQuote: inQuote };
}

/**
 * 断片全体を囲っている二重引用符を1組だけ外す。
 *
 * CSV のフィールド引用符は Papa Parse が既に外しているが、
 * TSV では引用符が特別扱いされないため `"ChatGPT"` のまま残ることがある。
 * 引用符が付いたままだと選択肢ラベルが表記ゆれ扱いになり、
 * optionAliases による正規化からも漏れるので、ここで外しておく。
 *
 * 引用符が途中にしか無い場合（`5"モニタ` など）は本文の一部なので触らない。
 */
function unwrapQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  // 「」『』（）は選択肢本文の一部（例:「その他（画像生成）」）なので外さない
  const isPair = (first === '"' && last === '"') || (first === '“' && last === '”');
  if (!isPair) return value;
  const inner = value.slice(1, -1);
  // 内側にさらに引用符が残っている場合（`"A","B"` のような壊れた入力）は触らない
  return inner.includes('"') ? value : inner.trim();
}

/** aliases オブジェクトごとに作った照合表のキャッシュ（毎回作り直さないため） */
const aliasIndexCache = new WeakMap<Record<string, string>, Map<string, string>>();

/**
 * 表記ゆれの対応表を normalizeKey で引ける形に変換する。
 * 同じキーに解決するエイリアスが複数あれば先に定義された方を採用する。
 */
function buildAliasIndex(aliases: Record<string, string>): Map<string, string> {
  const cached = aliasIndexCache.get(aliases);
  if (cached) return cached;
  const index = new Map<string, string>();
  for (const [from, to] of Object.entries(aliases)) {
    const key = normalizeKey(from);
    if (key === '' || index.has(key)) continue;
    index.set(key, to);
  }
  aliasIndexCache.set(aliases, index);
  return index;
}

/**
 * 表記ゆれを正規ラベルに寄せる。
 * 照合は normalizeKey ベースで行い、対応表に無ければ normalizeText した値を返す。
 *
 * @param raw 元の選択肢文字列
 * @param aliases 表記ゆれ → 正規ラベル の対応表
 * @returns 正規化した選択肢ラベル
 */
export function canonicalizeOption(raw: string, aliases?: Record<string, string>): string {
  if (!raw) return '';
  const text = normalizeText(raw);
  if (!aliases) return text;
  const key = normalizeKey(raw);
  if (key === '') return text;
  const hit = buildAliasIndex(aliases).get(key);
  return hit === undefined ? text : hit;
}
