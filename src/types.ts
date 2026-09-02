/**
 * アプリ全体で共有するドメイン型。
 * ここが各モジュール間の契約になる。実装追加時はまずこのファイルを見る。
 */

/** 質問の種類 */
export type QuestionKind =
  /** 単一選択（1セル＝1つの選択肢） */
  | 'single'
  /** 複数選択（1セルに複数の選択肢が入りうる） */
  | 'multiple'
  /** 数値（金額・時間・回数など。自動ビン分割して集計する） */
  | 'numeric'
  /** 自由記述（度数集計しない。件数と抜粋のみ） */
  | 'free'
  /** 集計対象外（氏名・タイムスタンプなど） */
  | 'ignore';

/** グラフの種類 */
export type ChartKind = 'bar' | 'hbar' | 'pie' | 'line' | 'none';

/** 選択肢の並び順 */
export type OptionOrder =
  /** プロファイル定義順 → 残りは件数降順 */
  | 'preset'
  /** 件数降順 */
  | 'count'
  /** ラベルの自然順（数値を含む文字列を数値として比較） */
  | 'natural';

/**
 * 入力ファイルの形式。
 * 'crowdworks' は CrowdWorks のアンケートCSV（選択肢が2列セットで出る形式）を
 * 読み込み層で通常の1設問=1列へ正規化したもの。
 */
export type SourceFormat = 'generic' | 'crowdworks';

/** パース直後の生テーブル */
export interface RawTable {
  /** 1行目から取り出した列名（重複時は末尾に (2) 等を付けて一意化済み） */
  headers: string[];
  /** データ行。各行は headers と同じ長さに正規化済み */
  rows: string[][];
  /** 実際に使われた区切り文字 */
  delimiter: string;
  /** 読み込み時の注意・警告メッセージ */
  warnings: string[];
  /** 元データの表示名（ファイル名など） */
  sourceName: string;
  /**
   * 元のヘッダーが空欄だった列の index。
   * parseText が "列N" という名前を補った列がここに入る。
   * CrowdWorks 形式の判定（選択肢ラベル列の検出）に使う。
   */
  emptyHeaderColumns?: number[];
  /**
   * 列 index → 強制する質問種別。
   * 読み込み層が「データ構造から確実に分かる」場合だけ設定する
   * （例: CrowdWorks の複数選択グループは必ず 'multiple'）。
   * プロファイルの kind や自動推定より優先される。
   */
  forcedKinds?: Record<number, QuestionKind>;
  /** 読み込み層が判定した入力形式。省略時は 'generic' 扱い */
  sourceFormat?: SourceFormat;
}

/** 1件の回答 */
export interface ResponseRow {
  /** 0始まりの通し番号（表示は +1） */
  id: number;
  /** headers と同じ長さのセル値 */
  values: string[];
  /** true = 集計対象、false = 除外 */
  included: boolean;
}

/**
 * CrowdWorks の識別情報・管理列。
 *
 * アンケートの設問ではないので集計・グラフ・AI向け出力には一切載せない。
 * 用途は回答一覧での目視確認と responses.csv での監査に限る。
 */
export type IdentityKind =
  /** 作業ID */
  | 'worker-id'
  /** 作業者名（個人情報） */
  | 'worker-name'
  /** 作業者ページURL（個人情報） */
  | 'worker-url'
  /** 承認日時（個人を特定しない管理列） */
  | 'approved-at';

/**
 * 派生質問（既存の列から合成する質問）の定義。
 *
 * 派生質問は元の列を書き換えない。元の回答は Dataset にそのまま残り、
 * responses.csv では常に原文が出る。
 */
export type DerivedSpec =
  /** 年列 + 月列 → "YYYY-MM" */
  | { type: 'year-month'; yearColumn: number; monthColumn: number }
  /** 作業時間の自由記述 → 作業日数（"3日" / 解析不能） */
  | { type: 'work-days'; sourceColumn: number }
  /** 作業時間の自由記述 → 合計作業時間のビン（"1～2時間未満" / 解析不能） */
  | { type: 'work-minutes'; sourceColumn: number };

/** 1つの質問（＝1列、または派生列）の定義 */
export interface QuestionDef {
  /** 一意キー（英数字。エクスポートの識別子にも使う） */
  key: string;
  /** RawTable の列 index。派生質問は -1 */
  columnIndex: number;
  /** 元の列名（生ヘッダー） */
  header: string;
  /** 表示ラベル（プロファイルがあれば正規化名、無ければ header） */
  label: string;
  /** 質問の種類 */
  kind: QuestionKind;
  /** 既定のグラフ種別 */
  chart: ChartKind;
  /** multiple のときにセルを分割する区切り文字 */
  delimiters: string[];
  /** 選択肢の並び方 */
  order: OptionOrder;
  /** preset 用の推奨表示順 */
  presetOptions?: string[];
  /** 表記ゆれ → 正規ラベル の対応 */
  optionAliases?: Record<string, string>;
  /** numeric のときの単位（"円" など） */
  unit?: string;
  /**
   * 出力対象にするか。
   *
   * true  = 基本集計・グラフ・summary.csv・analysis.json・survey-summary.md に載せる
   * false = 上記から外す（回答データそのものは保持したまま）
   *
   * 回答単位の `ResponseRow.included`（集計対象／除外）とは別の概念。
   * included は「どの回答者を数えるか」、selected は「どの設問を出すか」。
   * responses.csv / survey-free-text.md / cross-tab.csv はこの値の影響を受けない。
   */
  selected: boolean;
  /**
   * 識別情報・管理列のときだけ設定される。
   * 設定されている列は常に kind='ignore' で、集計・グラフ・AI向け出力に載らない。
   */
  identity?: IdentityKind;
  /** true = 自動推定、false = マッピングプロファイル由来 */
  inferred: boolean;
  /** 対応したプロファイルの canonical key（あれば） */
  profileKey?: string;
  /** 派生質問の場合の生成規則 */
  derived?: DerivedSpec;
}

/** 読み込み済みデータセット */
export interface Dataset {
  headers: string[];
  rows: ResponseRow[];
  questions: QuestionDef[];
  delimiter: string;
  warnings: string[];
  sourceName: string;
  /** 読み込み層が判定した入力形式。省略時は 'generic' 扱い */
  sourceFormat?: SourceFormat;
}

/** 集計された1つの選択肢 */
export interface OptionCount {
  label: string;
  count: number;
  /** 有効回答数に対する割合 (0-100)。小数第2位まで保持する */
  percentage: number;
}

/** 数値項目の要約 */
export interface NumericSummary {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  sum: number;
  unit?: string;
  /** パースできなかったセルの数 */
  unparsed: number;
}

/** 1つの質問の集計結果 */
export interface Aggregation {
  key: string;
  /** 表示ラベル */
  question: string;
  kind: QuestionKind;
  /** 複数回答かどうか */
  multiple: boolean;
  /** 集計対象（＝除外されていない）回答のうち、この質問に回答した人数 */
  validResponses: number;
  /** 集計対象のうち、この質問が未回答だった人数 */
  blankResponses: number;
  /** multiple のときの延べ選択数。single は validResponses と同じ */
  totalSelections: number;
  /** 選択肢ごとの集計（表示順にソート済み） */
  items: OptionCount[];
  /** numeric のときのみ */
  numeric?: NumericSummary;
  /** free のときのみ。最大 20 件の抜粋 */
  freeTextSamples?: string[];
}

/** クロス集計の表示モード */
export type CrossTabMode = 'count' | 'row' | 'col' | 'total';

/** クロス集計結果 */
export interface CrossTabResult {
  rowKey: string;
  colKey: string;
  rowQuestion: string;
  colQuestion: string;
  rowMultiple: boolean;
  colMultiple: boolean;
  rowLabels: string[];
  colLabels: string[];
  /** counts[rowIndex][colIndex] = 該当する回答者数 */
  counts: number[][];
  /** 各行に該当した回答者数（行内のセル合計とは一致しないことがある: 列が複数回答の場合） */
  rowTotals: number[];
  /** 各列に該当した回答者数 */
  colTotals: number[];
  /** 行・列の両方に有効回答した人数 */
  grandTotal: number;
  mode: CrossTabMode;
}

/** analysis.json の中身 */
export interface AnalysisResult {
  /** 生成日時 (ISO 8601, ローカルタイムゾーンオフセット付き) */
  generatedAt: string;
  /** 出力元アプリ名とバージョン */
  generator: string;
  sourceName: string;
  /** 読み込んだ全回答数 */
  totalResponses: number;
  /** 集計対象の回答数 */
  includedResponses: number;
  /** 除外された回答数 */
  excludedResponses: number;
  questions: Aggregation[];
}
