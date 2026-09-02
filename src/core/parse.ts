/**
 * CSV / TSV の読み込み。
 *
 * Papa Parse は必ず `header: false`（＝配列として受ける）で使い、
 * ヘッダー名の正規化・空行判定・列数の揃え直しはこのモジュール側で行う。
 * 外部通信・ストレージは一切使わない（完全ローカル処理）。
 */

import Papa from 'papaparse';
import type { RawTable } from '../types.ts';
import { isBlank, normalizeText, uniquifyHeaders } from './text.ts';

/**
 * 区切り文字の候補。
 * 配列の並び順がそのまま同点時の優先順（タブ > カンマ > セミコロン > パイプ）になる。
 */
const DELIMITER_CANDIDATES: string[] = ['\t', ',', ';', '|'];

/** 区切り文字の判定に使う先頭行数の上限 */
const SAMPLE_LINE_LIMIT = 10;

/** テキスト貼り付け時の既定の表示名 */
const DEFAULT_SOURCE_NAME = '貼り付けデータ';

/**
 * 区切り文字を推定する。
 *
 * 先頭最大 10 行（引用符で囲まれた改行は行の区切りとみなさない）について
 * 候補ごとの 1 行あたり出現回数を数え、
 * 「平均出現回数が 1 以上」かつ「行ごとのばらつき（分散）が最小」の候補を選ぶ。
 * 同点なら候補配列の並び順（タブ > カンマ > セミコロン > パイプ）を優先する。
 * どの候補も条件を満たさなければ "," を返す。
 *
 * @param text 判定対象のテキスト全体
 * @returns 推定した区切り文字
 */
export function detectDelimiter(text: string): string {
  // counts[候補index][行index] = その行での出現回数
  const counts: number[][] = DELIMITER_CANDIDATES.map(() => []);
  const lineCounts: number[] = DELIMITER_CANDIDATES.map(() => 0);
  let sampledLines = 0;
  let inQuote = false;
  let hasContent = false;

  /** 現在の行の集計を確定して次の行に備える */
  const flushLine = (): void => {
    if (hasContent) {
      for (let d = 0; d < DELIMITER_CANDIDATES.length; d++) {
        counts[d].push(lineCounts[d]);
      }
      sampledLines++;
    }
    for (let d = 0; d < lineCounts.length; d++) {
      lineCounts[d] = 0;
    }
    hasContent = false;
  };

  for (let i = 0; i < text.length && sampledLines < SAMPLE_LINE_LIMIT; i++) {
    const ch = text[i];
    if (ch === '"') {
      // 引用符の開始・終了。"" によるエスケープも「閉じて開く」で辻褄が合う
      inQuote = !inQuote;
      hasContent = true;
      continue;
    }
    if (inQuote) {
      // 引用符の中は区切り文字も改行も数えない
      hasContent = true;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // CRLF は 1 つの改行として扱う
      if (ch === '\r' && text[i + 1] === '\n') i++;
      flushLine();
      continue;
    }
    const idx = DELIMITER_CANDIDATES.indexOf(ch);
    if (idx >= 0) lineCounts[idx]++;
    // 空白だけの行は判定対象にしない
    if (ch !== ' ' && ch !== '　') hasContent = true;
  }
  if (sampledLines < SAMPLE_LINE_LIMIT) flushLine();

  let bestIndex = -1;
  let bestVariance = Number.POSITIVE_INFINITY;
  for (let d = 0; d < DELIMITER_CANDIDATES.length; d++) {
    const perLine = counts[d];
    if (perLine.length === 0) continue;
    const total = perLine.reduce((a, b) => a + b, 0);
    const mean = total / perLine.length;
    // 1 行あたり 1 個以上出現しない候補は区切り文字とみなさない
    if (mean < 1) continue;
    const variance = perLine.reduce((a, c) => a + (c - mean) * (c - mean), 0) / perLine.length;
    // 差が無ければ先に並んでいる候補（優先順が高い方）を残す
    if (variance < bestVariance - 1e-9) {
      bestVariance = variance;
      bestIndex = d;
    }
  }

  return bestIndex < 0 ? ',' : DELIMITER_CANDIDATES[bestIndex];
}

/**
 * CSV / TSV テキストをパースして {@link RawTable} を作る。
 *
 * - 先頭の BOM を除去する
 * - 1 行目をヘッダーとして扱い、空の列名は "列N"（1 始まり）にする
 * - 重複した列名は uniquifyHeaders で一意化する
 * - データ行は headers と同じ長さに揃える（不足は ""、超過は切り捨て）
 * - 全セルが空欄の行はスキップする
 * - Papa Parse のエラーは種類ごとに件数をまとめて warnings に載せる（例外は投げない）
 *
 * @param text CSV / TSV 本文
 * @param sourceName 表示用のデータ名（省略時は "貼り付けデータ"）
 * @returns パース結果。失敗しても例外は投げず warnings に理由が入る
 */
export function parseText(text: string, sourceName: string = DEFAULT_SOURCE_NAME): RawTable {
  const warnings: string[] = [];
  // 先頭の BOM を落としてから渡す（列名に ﻿ が混ざるのを防ぐ）
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(body);

  const result = Papa.parse<string[]>(body, {
    header: false,
    delimiter,
    skipEmptyLines: false,
  });
  const usedDelimiter = result.meta && result.meta.delimiter ? result.meta.delimiter : delimiter;
  const data: string[][] = Array.isArray(result.data) ? result.data : [];

  /** Papa のエラーを種類ごとにまとめて warnings に積む */
  const collectParseErrors = (): void => {
    const errors = result.errors ?? [];
    if (errors.length === 0) return;
    const summary = new Map<string, { count: number; message: string }>();
    for (const e of errors) {
      const code = e.code || e.type || 'Unknown';
      const found = summary.get(code);
      if (found) {
        found.count++;
      } else {
        summary.set(code, { count: 1, message: e.message || '' });
      }
    }
    for (const [code, info] of summary) {
      const detail = info.message ? `: ${info.message}` : '';
      warnings.push(`CSV解析の警告 [${code}]${detail}（${info.count}件）`);
    }
  };

  const headerRow = data.length > 0 ? data[0] : undefined;
  // ヘッダー行そのものが無い（＝中身が空）ならデータ無しとして返す
  if (!headerRow || headerRow.every((c) => normalizeText(c ?? '') === '')) {
    warnings.push('データが空です');
    collectParseErrors();
    return { headers: [], rows: [], delimiter: usedDelimiter, warnings, sourceName };
  }

  // 空の列名は "列N" で補い、そのうえで重複を一意化する。
  // どの列がもともと空欄だったかは emptyHeaderColumns に残す
  // （CrowdWorks 形式では空ヘッダー列が「選択肢ラベル列」を意味するため）。
  const emptyHeaderColumns: number[] = [];
  const namedHeaders = headerRow.map((c, i) => {
    const label = normalizeText(c ?? '');
    if (label === '') {
      emptyHeaderColumns.push(i);
      return `列${i + 1}`;
    }
    return label;
  });
  const headers = uniquifyHeaders(namedHeaders);
  const renamed: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] !== namedHeaders[i]) {
      renamed.push(`"${namedHeaders[i]}" → "${headers[i]}"`);
    }
  }
  if (renamed.length > 0) {
    warnings.push(`重複した列名を一意化しました（${renamed.join(' / ')}）`);
  }

  const rows: string[][] = [];
  let truncatedRows = 0;
  let blankRows = 0;
  for (let r = 1; r < data.length; r++) {
    const raw = data[r] ?? [];
    if (raw.length > headers.length) truncatedRows++;
    const row: string[] = new Array<string>(headers.length);
    for (let c = 0; c < headers.length; c++) {
      row[c] = raw[c] ?? '';
    }
    if (row.every((v) => isBlank(v))) {
      blankRows++;
      continue;
    }
    rows.push(row);
  }
  if (truncatedRows > 0) {
    warnings.push(
      `列数がヘッダーより多い行が ${truncatedRows} 件ありました。超過した値は読み捨てました`,
    );
  }
  if (blankRows > 0) {
    warnings.push(`空行を ${blankRows} 件スキップしました`);
  }
  collectParseErrors();

  return { headers, rows, delimiter: usedDelimiter, warnings, sourceName, emptyHeaderColumns };
}

/**
 * File を読み込んで {@link parseText} に渡す。
 *
 * まず UTF-8（fatal）でデコードし、不正なバイト列で失敗したら
 * Shift_JIS (cp932) として読み直し、その旨を warnings に追記する。
 *
 * @param file 読み込むファイル
 * @returns パース結果
 */
export async function parseFile(file: File): Promise<RawTable> {
  const buffer = await file.arrayBuffer();
  let text: string;
  let encodingWarning = '';

  try {
    // fatal:true にすることで「UTF-8 として不正」を例外で検出する
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      text = new TextDecoder('shift_jis').decode(buffer);
      encodingWarning = 'UTF-8として読めなかったためShift_JIS(cp932)として読み込みました';
    } catch {
      // shift_jis デコーダ自体が使えない環境向けのフォールバック（不正バイトは置換文字になる）
      text = new TextDecoder('utf-8').decode(buffer);
      encodingWarning =
        'UTF-8として読めず、Shift_JIS(cp932)も利用できない環境のため文字化けしている可能性があります';
    }
  }

  const table = parseText(text, file.name || 'アップロードファイル');
  if (encodingWarning) {
    table.warnings.push(encodingWarning);
  }
  return table;
}
