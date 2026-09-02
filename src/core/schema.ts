/**
 * 質問定義（QuestionDef）の構築。
 *
 * RawTable の各列について
 *   1. マッピングプロファイル（列名からの照合）
 *   2. 見つからなければ実データからの種別推定
 * の順で質問の性質を決め、Dataset を組み立てる。
 */

import type {
  ChartKind,
  Dataset,
  QuestionDef,
  QuestionKind,
  RawTable,
  ResponseRow,
} from '../types.ts';
import { isBlank, normalizeKey, normalizeText } from './text.ts';
import { SAFE_DELIMITERS, splitAnswers } from './splitter.ts';
import { parseJapaneseNumber } from './numeric.ts';
import { findProfile } from './mapping/registry.ts';
import { isCrowdWorksTable, normalizeCrowdWorksTable } from './adapters/crowdworks.ts';
import {
  UNPARSED_LABEL,
  WORK_DAYS_PRESET,
  WORK_MINUTES_BINS,
} from './worktime.ts';
import type { QuestionProfile } from './mapping/profiles.ts';

/** 1列を推定した結果 */
export interface InferResult {
  kind: QuestionKind;
  chart: ChartKind;
  delimiters: string[];
}

// --- 推定のしきい値（SPEC 準拠。マジックナンバーに名前を付けておく） ---

/** numeric 判定: 非空セルのうち数値化できた割合の下限 */
const NUMERIC_MIN_RATIO = 0.9;
/** 改行を含むセルがこの割合以上なら、複数行の自由記述とみなして数値集計しない */
const MULTILINE_MAX_RATIO_FOR_NUMERIC = 0.3;
/** numeric 判定: 異なり値数がこれを「超える」こと（<=12 は選択肢式とみなす） */
const NUMERIC_MIN_DISTINCT_EXCLUSIVE = 12;
/** multiple 判定: 2要素以上に分割された行の割合の下限 */
const MULTIPLE_MIN_SPLIT_RATIO = 0.15;
/** multiple 判定: 分割後の異なりトークン数の上限 */
const MULTIPLE_MAX_TOKENS = 40;
/** single 判定: 異なり値数の上限 */
const SINGLE_MAX_DISTINCT = 30;
/** single 判定: 異なり値数 / 非空件数 の上限 */
const SINGLE_MAX_DISTINCT_RATIO = 0.6;
/** single のうち円グラフにする異なり値数の上限 */
const PIE_MAX_DISTINCT = 6;

/**
 * 1列の値から質問の種別を推定する。
 *
 * 判定順（先に成立したものを採用する）:
 *  1. 非空セルが0 → 'ignore'
 *  2. 非空セルの90%以上が数値化でき、かつ異なり値数 > 12 → 'numeric'
 *  3. SAFE_DELIMITERS で分割したとき
 *     「2要素以上に分割される行の割合 >= 15%」かつ「分割後の異なりトークン数 <= 40」→ 'multiple'
 *  4. 異なり値数 <= 30 かつ（異なり値数 / 非空件数）<= 0.6 → 'single'
 *  5. それ以外 → 'free'
 *
 * 異なり値数は normalizeKey ベース（表記ゆれを吸収した上）で数える。
 */
export function inferKind(values: string[]): InferResult {
  // 空欄は判定材料から外す（未回答の多い列で母数がぶれないようにする）
  const filled = values.filter((v) => !isBlank(v));

  // 1. 全部空欄なら集計対象外
  if (filled.length === 0) {
    return { kind: 'ignore', chart: 'none', delimiters: [] };
  }

  const distinct = new Set<string>();
  for (const v of filled) distinct.add(normalizeKey(v));

  // 2. 数値列か（"12,000円" のような日本語混じりも数値として数える）
  //
  // ただし改行を含むセルが多い列は数値扱いしない。
  // 複数行の自由記述（例: 「作業日数:1日」と「合計作業時間:3時間」が改行で並ぶセル）は
  // 最初に出てきた数字だけが拾われ、まったく別の意味の値を
  // 集計してしまうため（この例だと「作業日数の1」を時間として数えてしまう）。
  let multilineCount = 0;
  for (const v of filled) {
    if (v.includes('\n')) multilineCount++;
  }
  const multilineRatio = multilineCount / filled.length;

  let parsedCount = 0;
  for (const v of filled) {
    if (parseJapaneseNumber(normalizeText(v)) !== null) parsedCount++;
  }
  const numericRatio = parsedCount / filled.length;
  if (
    multilineRatio < MULTILINE_MAX_RATIO_FOR_NUMERIC &&
    numericRatio >= NUMERIC_MIN_RATIO &&
    distinct.size > NUMERIC_MIN_DISTINCT_EXCLUSIVE
  ) {
    return { kind: 'numeric', chart: 'bar', delimiters: [] };
  }

  // 3. 複数回答か（区切り文字で実際に割れる行がまとまった割合あるか）
  let splitRows = 0;
  const tokens = new Set<string>();
  for (const v of filled) {
    const parts = splitAnswers(v, SAFE_DELIMITERS);
    if (parts.length >= 2) splitRows++;
    for (const p of parts) tokens.add(normalizeKey(p));
  }
  const splitRatio = splitRows / filled.length;
  if (splitRatio >= MULTIPLE_MIN_SPLIT_RATIO && tokens.size <= MULTIPLE_MAX_TOKENS) {
    return { kind: 'multiple', chart: 'hbar', delimiters: [...SAFE_DELIMITERS] };
  }

  // 4. 単一選択か（値の種類が少なく、回答者数に比べて十分収束している）
  if (
    distinct.size <= SINGLE_MAX_DISTINCT &&
    distinct.size / filled.length <= SINGLE_MAX_DISTINCT_RATIO
  ) {
    return {
      kind: 'single',
      chart: distinct.size <= PIE_MAX_DISTINCT ? 'pie' : 'bar',
      delimiters: [],
    };
  }

  // 5. 自由記述
  return { kind: 'free', chart: 'none', delimiters: [] };
}

/**
 * プロファイルの kind と推定結果から実際に採用する kind を決める。
 * 'multiple' / 'free' / 'ignore' は推定より優先して維持し、
 * 'single' のときだけ、実データが数値ばかりなら 'numeric' に上書きする。
 */
/**
 * 強制種別に合わせてグラフ種別を決める。
 *
 * 読み込み層が種別を確定させた（CrowdWorks の複数選択など）とき、
 * プロファイルの chart が食い違っていると
 * 「複数選択なのにグラフ無し」のような不整合になるため、種別側に寄せる。
 *
 * @param kind 確定した質問種別
 * @param fallback プロファイル／推定が持っていたグラフ種別
 */
function chartForKind(kind: QuestionKind, fallback: ChartKind): ChartKind {
  switch (kind) {
    case 'multiple':
      return 'hbar';
    case 'numeric':
      return 'bar';
    case 'free':
    case 'ignore':
      return 'none';
    case 'single':
      // 単一選択はプロファイルの指定（円／棒／横棒）を尊重する
      return fallback === 'none' ? 'bar' : fallback;
  }
}

function resolveKind(profile: QuestionProfile, inferredKind: QuestionKind): QuestionKind {
  switch (profile.kind) {
    case 'multiple':
      return 'multiple';
    case 'free':
      return 'free';
    case 'ignore':
      return 'ignore';
    case 'numeric':
      return 'numeric';
    case 'single':
      return inferredKind === 'numeric' ? 'numeric' : 'single';
  }
}

/**
 * key を一意化する。既出なら "key-2", "key-3" … と連番を付ける。
 * used は呼び出し側が持ち回る使用済みキー集合で、この関数が確定したキーを追加する。
 */
function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix++;
  const key = `${base}-${suffix}`;
  used.add(key);
  return key;
}

/**
 * RawTable から質問定義一覧を作る。
 *
 * - 列ごとに findProfile で列名を照合し、見つかればプロファイル採用（inferred=false）。
 *   kind は resolveKind、chart は profile.chart（numeric に上書きされた場合のみ 'bar'）、
 *   delimiters は kind==='multiple' のときだけ profile.delimiters ?? SAFE_DELIMITERS。
 * - プロファイルが無ければ inferKind の結果を使い、key="q1","q2"…、label=列名、
 *   order='count'、inferred=true とする。
 * - key が衝突したら "-2" 以降の連番で一意化する。
 * - start-year と start-month の両方が揃ったときだけ、末尾に派生質問
 *   'start-year-month'（columnIndex=-1）を追加する。
 */
export function buildQuestions(table: RawTable): QuestionDef[] {
  const questions: QuestionDef[] = [];
  const usedKeys = new Set<string>();

  for (let i = 0; i < table.headers.length; i++) {
    const header = table.headers[i] ?? '';
    // 欠けたセルは空文字として扱う（RawTable は正規化済みだが念のため）
    const values = table.rows.map((row) => row[i] ?? '');
    const inferred = inferKind(values);
    const profile = findProfile(header);
    const forced = table.forcedKinds?.[i];

    if (profile) {
      // 読み込み層が構造から確定させた種別があれば、それを最優先で使う
      // （CrowdWorks の複数選択グループなど。プロファイルの kind より確実）。
      const kind = forced ?? resolveKind(profile, inferred.kind);
      // 推定によって numeric へ上書きされたときだけ、グラフを棒グラフに寄せる
      const overriddenToNumeric = kind === 'numeric' && profile.kind !== 'numeric';
      let chart: ChartKind = overriddenToNumeric ? 'bar' : profile.chart;
      // 強制種別でプロファイルと食い違ったときは、グラフも種別に合わせる
      if (forced && forced !== profile.kind) {
        chart = chartForKind(forced, profile.chart);
      }

      questions.push({
        key: uniqueKey(profile.key, usedKeys),
        columnIndex: i,
        header,
        label: profile.label,
        kind,
        chart,
        // 複数回答以外でセルを分割すると自由記述などを壊すので空にする
        delimiters: kind === 'multiple' ? [...(profile.delimiters ?? SAFE_DELIMITERS)] : [],
        order: profile.order,
        // プロファイル側の配列・辞書を共有しないよう複製する
        presetOptions: profile.presetOptions ? [...profile.presetOptions] : undefined,
        optionAliases: profile.optionAliases ? { ...profile.optionAliases } : undefined,
        unit: profile.unit,
        // 既定は全設問を出力対象にする（UI の「出力する項目」で外せる）
        selected: true,
        identity: profile.identity,
        inferred: false,
        profileKey: profile.key,
      });
      continue;
    }

    const kind = forced ?? inferred.kind;
    questions.push({
      key: uniqueKey(`q${i + 1}`, usedKeys),
      columnIndex: i,
      header,
      label: header,
      kind,
      chart: forced ? chartForKind(forced, inferred.chart) : inferred.chart,
      delimiters: kind === 'multiple' ? [...SAFE_DELIMITERS] : [],
      order: 'count',
      selected: true,
      inferred: true,
    });
  }

  // 年列と月列が両方認識できたときだけ、時系列グラフ用の派生質問を足す。
  // 値の生成規則（実際の生成は aggregate.ts の cellValue が担当する）:
  //   年セル・月セルの両方を parseJapaneseNumber で数値化し "YYYY-MM"（月は2桁ゼロ埋め）を返す。
  //   どちらか欠ければ空文字。年が2桁（"24"）なら 2000 を足す。月が 1〜12 の範囲外なら空文字。
  const yearQuestion = questions.find((q) => q.profileKey === 'start-year');
  const monthQuestion = questions.find((q) => q.profileKey === 'start-month');
  if (yearQuestion && monthQuestion) {
    questions.push({
      key: uniqueKey('start-year-month', usedKeys),
      columnIndex: -1,
      header: '(派生) 年 + 月',
      label: '仕事を受注・開始した年月',
      kind: 'single',
      chart: 'line',
      delimiters: [],
      order: 'natural',
      selected: true,
      inferred: false,
      profileKey: 'start-year-month',
      derived: {
        type: 'year-month',
        yearColumn: yearQuestion.columnIndex,
        monthColumn: monthQuestion.columnIndex,
      },
    });
  }

  // 「実際の作業時間」は自由記述で、1セルに作業日数と合計作業時間が
  // まとめて書かれていることがある。原文はそのまま残したうえで、
  // 確実に読み取れる場合だけ分析用の派生質問を足す。
  // 読み取れなかった回答は 0 や空欄にせず「解析不能」として数える。
  const workHoursQuestion = questions.find((q) => q.profileKey === 'work-hours');
  if (workHoursQuestion && workHoursQuestion.columnIndex >= 0) {
    questions.push({
      key: uniqueKey('work-days', usedKeys),
      columnIndex: -1,
      header: '(派生) 実際の作業時間 → 作業日数',
      label: '作業日数（派生）',
      kind: 'single',
      chart: 'bar',
      delimiters: [],
      order: 'preset',
      presetOptions: [...WORK_DAYS_PRESET, UNPARSED_LABEL],
      selected: true,
      inferred: false,
      profileKey: 'work-days',
      derived: { type: 'work-days', sourceColumn: workHoursQuestion.columnIndex },
    });
    questions.push({
      key: uniqueKey('work-minutes', usedKeys),
      columnIndex: -1,
      header: '(派生) 実際の作業時間 → 合計作業時間',
      label: '合計作業時間（派生）',
      kind: 'single',
      chart: 'bar',
      delimiters: [],
      order: 'preset',
      presetOptions: [...WORK_MINUTES_BINS, UNPARSED_LABEL],
      selected: true,
      inferred: false,
      profileKey: 'work-minutes',
      derived: { type: 'work-minutes', sourceColumn: workHoursQuestion.columnIndex },
    });
  }

  return questions;
}

/**
 * RawTable から Dataset を作る。
 * 行はすべて included=true（＝集計対象）で初期化し、
 * headers / delimiter / warnings / sourceName は RawTable をそのまま引き継ぐ。
 */
export function buildDataset(table: RawTable): Dataset {
  // CrowdWorks のアンケートCSV なら、ここで通常の「1設問=1列」へ畳み込む。
  // これ以降（buildQuestions / aggregate / chart / crosstab / export）は
  // CrowdWorks 固有の 2列セット構造を一切知らなくてよい。
  const source = isCrowdWorksTable(table) ? normalizeCrowdWorksTable(table) : table;

  const rows: ResponseRow[] = source.rows.map((row, index) => ({
    id: index,
    values: row,
    included: true,
  }));

  return {
    headers: source.headers,
    rows,
    questions: buildQuestions(source),
    delimiter: source.delimiter,
    warnings: source.warnings,
    sourceName: source.sourceName,
    sourceFormat: source.sourceFormat ?? 'generic',
  };
}
