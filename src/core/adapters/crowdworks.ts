/**
 * CrowdWorks アンケートCSV のアダプター。
 *
 * CrowdWorks は選択式の設問を「1設問=1列」では出力せず、
 * 選択肢番号の列と、ヘッダーが空欄のラベル列の2列セットで出す。
 *
 *   ヘッダー: "1. 年齢"        , ""
 *   データ  : "4"              , "45～54"
 *
 * 複数選択では、選択肢ごとに2列セットが並ぶ。
 *
 *   ヘッダー: "12-1. 使用したAI…", "" , "12-2. 使用したAI…", "" , …
 *   データ  : "1", "ChatGPT"      , ""  , ""                 , "" , …
 *
 * 実ファイルはこの形で 321 列になる。
 * このモジュールは、その 321 列を
 *
 *   管理列4列 + アンケート23設問
 *
 * の通常の RawTable へ畳み込む。以降の schema / aggregate / chart /
 * crosstab / export は CrowdWorks 固有の構造を一切知らなくてよい。
 *
 * 分析に使うのは常に「右側の人間可読なラベル」で、選択肢番号は捨てる。
 */

import type { QuestionKind, RawTable } from '../../types.ts';
import { isBlank, normalizeText } from '../text.ts';

/** CrowdWorks CSV の先頭にある管理列（実ファイルの列名そのまま） */
export const CROWDWORKS_MANAGEMENT_HEADERS = [
  '作業ID',
  '作業者',
  '作業者ページURL',
  '承認日時',
] as const;

/**
 * 設問ヘッダーの形。
 *  "1. 年齢"                          → number='1',  branch=undefined
 *  "12-1. 使用したAI・AIツール（複数選択可）" → number='12', branch='1'
 */
const QUESTION_HEADER = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*[.．]\s*(.*)$/;

/** 1つの設問ヘッダーを分解した結果 */
interface ParsedHeader {
  /** 設問番号（"12"） */
  number: string;
  /** 複数選択の枝番（"1"）。単一設問なら undefined */
  branch: string | undefined;
  /** 設問文（番号を除いた部分） */
  text: string;
}

/** ヘッダー文字列を設問番号・枝番・設問文に分解する。設問形式でなければ null */
function parseQuestionHeader(header: string): ParsedHeader | null {
  const matched = QUESTION_HEADER.exec(normalizeText(header));
  if (!matched) return null;
  const number = matched[1];
  const text = normalizeText(matched[3] ?? '');
  if (!number || text === '') return null;
  return { number, branch: matched[2], text };
}

/** 管理列かどうか（前後の空白と全角半角の揺れだけ吸収して照合する） */
function isManagementHeader(header: string): boolean {
  const h = normalizeText(header);
  return CROWDWORKS_MANAGEMENT_HEADERS.some((name) => h === name);
}

/**
 * CrowdWorks のアンケートCSV かどうかを判定する。
 *
 * 条件は次の2つを両方満たすこと。
 *  1. 管理列（作業ID / 作業者 / 作業者ページURL / 承認日時）が4つとも揃っている
 *  2. CrowdWorks 特有の設問ヘッダーがある
 *     （"12-1." のような枝番付き、または "1." のような番号付きの直後が空ヘッダー列）
 *
 * 通常の CSV / TSV を誤検出しないよう、管理列4つを必須にしている。
 */
export function isCrowdWorksTable(table: RawTable): boolean {
  if (table.headers.length === 0) return false;

  const present = new Set(table.headers.map((h) => normalizeText(h)));
  const hasManagement = CROWDWORKS_MANAGEMENT_HEADERS.every((name) => present.has(name));
  if (!hasManagement) return false;

  const emptyHeaders = new Set(table.emptyHeaderColumns ?? []);
  for (let i = 0; i < table.headers.length; i++) {
    const parsed = parseQuestionHeader(table.headers[i] ?? '');
    if (!parsed) continue;
    // 枝番付き（複数選択）か、番号付きの直後が空ヘッダー列（選択肢ラベル列）なら CrowdWorks 形式
    if (parsed.branch !== undefined) return true;
    if (emptyHeaders.has(i + 1)) return true;
  }
  return false;
}

/** 正規化後の1設問 */
interface NormalizedQuestion {
  /** 正規化後のヘッダー（"12. 使用したAI・AIツール（複数選択可）"） */
  header: string;
  /** 値を取り出す列 index の並び（複数選択なら選択肢の数だけ並ぶ） */
  sourceColumns: number[];
  /** true なら複数選択として結合する */
  multiple: boolean;
  /**
   * 選択式の設問か（＝選択肢ラベル列とペアになっていたか）。
   *
   * ペアになっている時点で「用意された選択肢から選ぶ設問」だと構造的に確定するので、
   * 自由入力（ペアにならない1列だけの設問）と区別して種別を固定する。
   */
  choice: boolean;
}

/**
 * 設問のグループキー。
 *
 * 枝番付き（"12-1", "12-2"）は同じ設問として束ねたいので "12#multi"、
 * 枝番なし（"1."）は独立した設問なので "1#single" にする。
 * こうしておくと、万一 "1." と "1-1." が同居しても取り違えない。
 * 番号は文字列そのままで比較するので "3" と "13" が混ざることもない。
 */
function groupKeyOf(parsed: ParsedHeader): string {
  return parsed.branch === undefined ? `${parsed.number}#single` : `${parsed.number}#multi`;
}

/**
 * CrowdWorks の RawTable を、通常の「1設問=1列」の RawTable へ正規化する。
 *
 * - 管理列はそのまま残す（値も列名も変えない）
 * - 単一選択（番号付き + 空ヘッダー列）は、右のラベル列の値を採用する
 * - 複数選択（枝番付き）は、選択されたラベルだけを改行区切りで1セルに結合する
 * - 自由入力（番号付きで空ヘッダー列が続かない）は値をそのまま保持する
 * - 空ヘッダー列は単独の設問にしない（必ず直前の設問のラベル列として消費する）
 * - 行数は一切変えない
 *
 * @param table parseText の結果（CrowdWorks 形式であること）
 * @returns 正規化した RawTable。sourceFormat は 'crowdworks'
 */
export function normalizeCrowdWorksTable(table: RawTable): RawTable {
  const emptyHeaders = new Set(table.emptyHeaderColumns ?? []);
  const questions: NormalizedQuestion[] = [];
  const byGroup = new Map<string, NormalizedQuestion>();
  /** 直前の設問のラベル列として消費済みの列 */
  const consumed = new Set<number>();

  for (let i = 0; i < table.headers.length; i++) {
    if (consumed.has(i)) continue;
    const header = table.headers[i] ?? '';

    if (isManagementHeader(header)) {
      questions.push({
        header: normalizeText(header),
        sourceColumns: [i],
        multiple: false,
        choice: false,
      });
      continue;
    }

    const parsed = parseQuestionHeader(header);
    if (!parsed) {
      // 番号なしの列。空ヘッダー列（＝どの設問にも属さない余り）は捨て、
      // それ以外は通常の列として残す。
      if (emptyHeaders.has(i)) continue;
      questions.push({
        header: normalizeText(header),
        sourceColumns: [i],
        multiple: false,
        choice: false,
      });
      continue;
    }

    // 直後が空ヘッダー列なら、そこが人間可読なラベル列。選択肢番号の列は捨てる。
    const labelColumn = emptyHeaders.has(i + 1) ? i + 1 : i;
    if (labelColumn !== i) consumed.add(labelColumn);

    const key = groupKeyOf(parsed);
    const existing = byGroup.get(key);
    if (existing) {
      // 同じ設問番号の枝番なので、同じ設問へ束ねる
      existing.sourceColumns.push(labelColumn);
      existing.multiple = true;
      continue;
    }

    const question: NormalizedQuestion = {
      header: `${parsed.number}. ${parsed.text}`,
      sourceColumns: [labelColumn],
      // 枝番付きは選択肢が1つしか無くても複数選択として扱う
      multiple: parsed.branch !== undefined,
      // ラベル列とペアなら選択式。ペアにならない1列だけの設問は自由入力
      choice: labelColumn !== i,
    };
    byGroup.set(key, question);
    questions.push(question);
  }

  const headers = questions.map((q) => q.header);
  const rows = table.rows.map((row) =>
    questions.map((q) => {
      if (!q.multiple) {
        return row[q.sourceColumns[0] ?? -1] ?? '';
      }
      // 選択されたラベルだけを集める。未選択のセルは両方空なので落ちる。
      const picked: string[] = [];
      const seen = new Set<string>();
      for (const column of q.sourceColumns) {
        const value = normalizeText(row[column] ?? '');
        if (isBlank(value) || seen.has(value)) continue;
        seen.add(value);
        picked.push(value);
      }
      // 改行区切りにする。選択肢ラベルに読点やカンマが入っていても壊れない。
      return picked.join('\n');
    }),
  );

  // 設問の種別は CrowdWorks の列構造から確実に分かるので固定する
  // （プロファイルの kind や値からの推定より、実データの形を優先する）。
  //   枝番付きの2列セット群 → 複数選択
  //   枝番なしの2列セット   → 単一選択
  //     ここを固定しないと、"覚えていない" のような選択肢が混じった月の設問が
  //     「ほぼ数値・異なり13」と見なされて数値集計に化けてしまう。
  //   ペアにならない1列    → 自由入力なので固定しない（プロファイルと推定に任せる）
  const forcedKinds: Record<number, QuestionKind> = {};
  questions.forEach((q, index) => {
    if (q.multiple) {
      forcedKinds[index] = 'multiple';
    } else if (q.choice) {
      forcedKinds[index] = 'single';
    }
  });

  const droppedColumns = table.headers.length - headers.length;
  const warnings = [
    ...table.warnings,
    `CrowdWorks形式を検出しました（${table.headers.length}列 → ${headers.length}列に正規化）。` +
      `選択肢番号の列 ${droppedColumns}列 を畳み込み、人間可読なラベルを分析値として使います。`,
  ];

  return {
    headers,
    rows,
    delimiter: table.delimiter,
    warnings,
    sourceName: table.sourceName,
    forcedKinds,
    sourceFormat: 'crowdworks',
  };
}
