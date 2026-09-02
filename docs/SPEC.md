# 実装仕様（V1）

このファイルは各モジュールの責務と公開APIの契約を定める。
型は必ず `src/types.ts` から import して使う（再定義しない）。

- 言語: TypeScript (strict, `noUnusedLocals` / `noUnusedParameters` 有効)
- import は必ず拡張子 `.ts` 付きの相対パス（例: `import type { Dataset } from '../types.ts'`）
- 外部通信・localStorage・analytics を一切書かない
- コメントは日本語

---

## src/core/text.ts — 文字列ユーティリティ

```ts
/** NFKC正規化 + 前後空白除去 + 全角空白正規化 + 連続空白の圧縮 */
export function normalizeText(s: string): string;

/** 集計キーとして使う正規化。normalizeText に加えて小文字化・末尾の句読点除去 */
export function normalizeKey(s: string): string;

/** 空欄判定 */
export function isBlank(s: string | undefined | null): boolean;

/** 列名の照合用正規化。normalizeKey に加えて
 *  空白全除去 / 記号（【】（）()「」『』[]・、。,.-_/＼\ など）除去 /
 *  末尾の ? ？ ： : 除去 */
export function normalizeHeader(s: string): string;

/** ラベルの自然順比較（"10代" < "20代", "1万円未満" < "3万円未満"）。
 *  文字列中の数値部分を数値として比較し、同じなら文字列比較にフォールバックする */
export function naturalCompare(a: string, b: string): number;

/** 重複する列名を "名前", "名前 (2)", "名前 (3)" と一意化する */
export function uniquifyHeaders(headers: string[]): string[];
```

`isBlank` が true になる対象: `""`, 空白のみ, `"-"`, `"‐"`, `"—"`, `"N/A"`, `"n/a"`, `"NA"`, `"null"`, `"undefined"`。

**`"なし"` `"特になし"` `"0"` `"ー"` は有効回答なので blank ではない。**
（`"ー"` は長音で「なし」を意味しないため有効扱いにする）

---

## src/core/parse.ts — CSV/TSV 読み込み

Papa Parse を使う。`import Papa from 'papaparse'`。

```ts
import type { RawTable } from '../types.ts';

/** 候補: "\t", ",", ";", "|"。ヘッダー行と先頭数行での出現回数の安定度で判定。
 *  判定不能なら "," を返す */
export function detectDelimiter(text: string): string;

/** テキスト（CSV/TSV）をパースする。
 *  - 1行目をヘッダーとして扱う
 *  - BOM 除去
 *  - 全行を headers.length に揃える（不足は ""、超過分は捨てて warnings に載せる）
 *  - 全セルが空の行はスキップし、その件数を warnings に載せる
 *  - ヘッダーが空の列は "列N"（N は 1 始まり）という名前を付ける
 *  - 重複ヘッダーは uniquifyHeaders で一意化し warnings に載せる
 *  - Papa のエラーは warnings に要約して載せる（例外にしない） */
export function parseText(text: string, sourceName?: string): RawTable;

/** File を UTF-8 として読み、parseText に渡す。
 *  UTF-8 として不正なら Shift_JIS (cp932) で再デコードして再試行し、
 *  その旨を warnings に載せる。
 *  （TextDecoder('shift_jis', {fatal:true}) はブラウザ標準で利用可能） */
export function parseFile(file: File): Promise<RawTable>;
```

パースは常に `header: false`（配列として受ける）で行い、ヘッダー処理は自前で行うこと。
`skipEmptyLines` は使わず自前で判定する（"空行" の定義をこちらで制御するため）。

---

## src/core/splitter.ts — 複数回答セルの分割

```ts
/** 想定しうる全区切り文字 */
export const DEFAULT_DELIMITERS: string[]; // ['\n', ',', '、', ';', '；', '|', '｜', '/', '・']

/** 自由記述の誤爆を避けた既定 */
export const SAFE_DELIMITERS: string[];    // ['\n', ',', '、', ';', '；', '|', '｜']

/** cell を delimiters で分割し、normalizeText した上で空要素を除去し、
 *  同一回答者内の重複を除去して返す。
 *  - 分割前に "\r\n" と "\r" は "\n" に統一する
 *  - 丸括弧 ( ) （ ） 【 】 「 」 の深さを数え、深さ0のときだけ分割する
 *    （"その他（AAA、BBB）" を壊さないため）
 *  - 二重引用符で囲まれた範囲でも分割しない */
export function splitAnswers(cell: string, delimiters: string[]): string[];

/** optionAliases を適用して正規ラベルに寄せる。
 *  照合は normalizeKey ベース。無ければ normalizeText したものを返す */
export function canonicalizeOption(raw: string, aliases?: Record<string, string>): string;
```

---

## src/core/numeric.ts — 数値パースと要約

```ts
import type { NumericSummary } from '../types.ts';

/** 日本語混じりの数値表現を数値へ。パースできなければ null。
 *  対応例:
 *    "12,000円" -> 12000 / "1万円" -> 10000 / "1.5万円" -> 15000
 *    "3万5000円" -> 35000 / "10万" -> 100000 / "約5000円" -> 5000
 *    "3時間" -> 3 / "30分" -> 0.5（unit==='時間' のとき） / "3h" -> 3
 *    "5回" -> 5 / "0" -> 0 / "3〜5" -> 4（範囲は中央値）
 *    "5000円以上" -> 5000 / "1万円未満" -> 10000
 *  全角数字は半角に正規化してから処理する。
 *  数字が1つも無ければ null。 */
export function parseJapaneseNumber(s: string, unit?: string): number | null;

/** 数値配列の要約統計。空配列なら n=0 の要約を返す（min/max/mean/median 等は 0）。
 *  中央値・四分位は線形補間しない（下側の値を採る単純な方式で良いが、
 *  中央値だけは偶数個のとき2値の平均を取る） */
export function summarizeNumeric(
  values: number[], unit: string | undefined, unparsed: number
): NumericSummary;

/** ヒストグラム用のビンを作る。
 *  - 異なり値が10種類以下ならその値そのものをビンにする（回数など離散値向け）
 *  - それ以外は「1/2/5 × 10^n」系のきりの良い幅で 6〜12 個程度のビンを作る
 *  - ラベルは "0〜9,999円" のような日本語表記（3桁区切り、unit を末尾に付ける）
 *  - 最後のビンは最大値を含む（半開区間 [from, to) だが最終ビンのみ閉区間） */
export function makeBins(
  values: number[], unit?: string
): { label: string; count: number; from: number; to: number }[];
```

---

## src/core/mapping/profiles.ts — 質問プロファイル定義

```ts
import type { ChartKind, OptionOrder, QuestionKind } from '../../types.ts';

export interface QuestionProfile {
  /** canonical key（英小文字とハイフン） */
  key: string;
  label: string;
  /** 列名の照合パターン。normalizeHeader 済みの文字列で書く */
  aliases: string[];
  kind: QuestionKind;
  chart: ChartKind;
  order: OptionOrder;
  presetOptions?: string[];
  optionAliases?: Record<string, string>;
  unit?: string;
  /** 複数回答のときの区切り文字（省略時 SAFE_DELIMITERS） */
  delimiters?: string[];
}

/** CrowdWorks 生成AI仕事アンケート用のプロファイル一覧 */
export const CROWDWORKS_PROFILES: QuestionProfile[];
```

**必須プロファイル（23項目）:**

| key | label | kind | chart | order |
|---|---|---|---|---|
| `age` | 年齢 | single | bar | preset |
| `gender` | 性別 | single | pie | preset |
| `occupation` | 現在の職種 | single | hbar | count |
| `channel` | 仕事を受注したサービス・経路 | multiple | hbar | count |
| `start-year` | 仕事を受注・開始した年 | single | bar | natural |
| `start-month` | 仕事を受注・開始した月 | single | bar | preset |
| `job-category` | 仕事の主なカテゴリ | single | hbar | count |
| `job-detail` | 具体的に行った仕事内容 | free | none | count |
| `contract-type` | 契約・報酬形式 | single | hbar | count |
| `reward` | 報酬 | single | bar | preset |
| `work-hours` | 実際の作業時間 | single | bar | preset |
| `ai-tools` | 使用したAI・AIツール | multiple | hbar | count |
| `main-ai` | 一番使ったAI | single | hbar | count |
| `ai-usage` | AIを何に使ったか | multiple | hbar | count |
| `ai-ratio` | AI利用割合 | single | bar | preset |
| `human-edit` | AI出力を人間がどれくらい修正したか | single | bar | preset |
| `without-ai` | AIがなければ仕事を受けたか | single | pie | preset |
| `client-ai-rule` | クライアント側のAI利用ルール | single | hbar | preset |
| `disclosed-ai` | AI利用をクライアントに伝えたか | single | pie | preset |
| `revision-count` | 修正回数 | single | bar | preset |
| `job-result` | 仕事の結果 | single | hbar | preset |
| `repeat-intent` | また同じような仕事を受けたいか | single | hbar | preset |
| `free-comment` | 自由記述 | free | none | count |

`reward` / `work-hours` / `revision-count` は選択肢式（"1万円〜3万円未満" など）でも
数値直接入力でも来うる。プロファイルの kind は `single` にしておき、
実データが数値ばかりなら schema.ts 側の推定で `numeric` に上書きする（後述）。
これらには `unit` を設定する（`reward`→"円" / `work-hours`→"時間" / `revision-count`→"回"）。

`aliases` は日本語の言い回しの揺れを広く拾うこと。各項目につき最低3〜6個。
`normalizeHeader` を通した後の形（空白・記号なし）で書く。
例（`ai-tools`）: `['使用したaiaiツール', '使用したai', '使ったai', '利用したaiツール', 'aiツール', '使用aiツール']`

**エイリアスの衝突に注意**: `ai-tools` と `main-ai` と `ai-usage` は
部分一致で取り違えやすい。`findProfile` は「長いエイリアス優先」で照合し、
`main-ai` には `'一番使ったai'` `'最も使ったai'` `'メインで使ったai'` のように
特徴的な語を含むエイリアスだけを与えること。

`presetOptions` は実CSV（52回答）の選択肢に合わせてある。

- `age`: 18～24 / 25～34 / 35～44 / 45～54 / 55～64 / 65～74 / 75以上
- `gender`: 女性 / 男性 / その他 / 回答しない
- `start-month`: 1月 … 12月（実データには `覚えていない` も現れる。preset の後ろに付く）
- `ai-ratio`: ほとんど使っていない(1～20%程度) / 一部で使った(21～40%程度) /
  半分くらい使った(41～60%程度) / 大部分で使った(61～80%程度) / ほぼAIを使った(81～100%程度)
- `human-edit`: ほぼ修正していない / 少し修正した / かなり修正した / ほぼ作り直した /
  何度も作り直した / AIは完成物の作成には使っていない
- `without-ai`: 受けていた / たぶん受けていた / たぶん受けていなかった / 受けていなかった / わからない
- `client-ai-rule`: AI利用可と明記されていた / 条件付きでAI利用可だった /
  AI利用禁止だった / AIについての記載はなかった
- `disclosed-ai`: 伝えた / 伝えていない / AI利用を伝える必要がなかった / わからない
- `repeat-intent`: ぜひ受けたい / 条件次第で受けたい / 受けてもよい / どちらとも言えない /
  あまり受けたくない / 受けたくない / わからない
- `job-result`: 問題なく完了した / 修正後に完了した / 高評価だった / 修正が多かった /
  契約解除・不採用になった
- `reward`: 200円未満 / 200～499円 / 500～999円 / 1,000～2,999円 / 3,000～4,999円 /
  5,000～9,999円 / 10,000～29,999円 / 30,000～49,999円 / 50,000～99,999円 / 100,000～149,999円
- `work-hours`: 〜1時間 / 1〜3時間 / 3〜5時間 / 5〜10時間 / 10〜20時間 / 20時間以上
  （実CSVでは自由入力だったため、この preset は汎用CSV向け）
- `revision-count`: 0回 / 1回 / 2回 / 3回 / 4回 / 5回 / 6回以上

波ダッシュは `normalizeKey` の NFKC 正規化で半角 `~` になるため、
preset を `～` `~` のどちらで書いても照合できる。

presetOptions に無い選択肢が実データに現れても捨てず、preset の後ろに件数降順で並べる。

## src/core/mapping/registry.ts

```ts
import type { QuestionProfile } from './profiles.ts';

/** 生ヘッダー文字列からプロファイルを引く。
 *  1. normalizeHeader 後の完全一致（label / aliases）
 *  2. aliases のいずれかを含む（長いエイリアス優先）
 *  見つからなければ undefined */
export function findProfile(
  header: string, profiles?: QuestionProfile[]
): QuestionProfile | undefined;

/** 登録済みプロファイル集合（将来 CrowdWorks 以外を足せるようにする） */
export const PROFILE_SETS: Record<string, QuestionProfile[]>;
```

---

## src/core/schema.ts — 質問定義の構築

```ts
import type { ChartKind, Dataset, QuestionDef, QuestionKind, RawTable } from '../types.ts';

export interface InferResult {
  kind: QuestionKind;
  chart: ChartKind;
  delimiters: string[];
}

/** 1列の値から種別を推定する。判定順:
 *  1. 非空セルが0 → 'ignore'
 *  2. 非空セルの90%以上が parseJapaneseNumber で数値化でき、
 *     かつ異なり数 > 12 → 'numeric'
 *     ただし改行を含むセルが30%以上ある列は数値扱いしない。
 *     複数行の自由記述（例: 「作業日数:1日」と「合計作業時間:3時間」が改行で並ぶ）は
 *     最初の数字だけが拾われ、別の意味の値を集計してしまうため。
 *  3. SAFE_DELIMITERS で分割した結果、
 *     「2要素以上に分割される行の割合 >= 15%」かつ「分割後の異なりトークン数 <= 40」
 *     → 'multiple'
 *  4. 異なり値数 <= 30 かつ (異なり値数 / 非空件数) <= 0.6 → 'single'
 *  5. それ以外 → 'free'
 *  chart は kind から: single(異なり<=6)→'pie' / single(>6)→'bar'
 *                      multiple→'hbar' / numeric→'bar' / free→'none' / ignore→'none' */
export function inferKind(values: string[]): InferResult;

/** RawTable から質問定義一覧を作る。
 *  - 各列について findProfile → 見つかればプロファイル採用（inferred=false）
 *  - プロファイルの kind が 'single' でも、実データの推定が 'numeric' なら numeric に上書き
 *    （profile.kind が 'multiple' / 'free' の場合は推定より優先して維持する）
 *  - プロファイルが無ければ inferKind（inferred=true）
 *  - key は profile.key、無ければ "q1","q2"…（列 index 由来で一意）
 *    同じ profile.key が2列に当たったら 2列目以降は "key-2" のように一意化する
 *  - start-year と start-month の両方が見つかったら末尾に派生質問を追加する:
 *      { key:'start-year-month', label:'仕事を受注・開始した年月',
 *        kind:'single', chart:'line', order:'natural', columnIndex:-1,
 *        derived:{ type:'year-month', yearColumn, monthColumn } } */
export function buildQuestions(table: RawTable): QuestionDef[];

/** RawTable から Dataset を作る（全行 included=true） */
export function buildDataset(table: RawTable): Dataset;
```

派生質問 `start-year-month` の値の作り方:
年セル・月セルの両方から `parseJapaneseNumber` で数値を取り、
`YYYY-MM`（月は2桁ゼロ埋め）を返す。どちらか欠ければ空文字。
年が2桁（"24"）なら 2000 を足す。月が 1〜12 の範囲外なら空文字。

---

## src/core/aggregate.ts — 集計

```ts
import type {
  AnalysisResult, Aggregation, Dataset, QuestionDef, ResponseRow
} from '../types.ts';

/** 1回答者・1質問のセル値を取り出す（派生質問にも対応） */
export function cellValue(row: ResponseRow, q: QuestionDef): string;

/** 1回答者がその質問で選んだ選択肢の配列（重複除去済み）。
 *  single/numeric/free は最大1要素。未回答なら空配列 */
export function respondentOptions(row: ResponseRow, q: QuestionDef): string[];

/** 1つの質問を集計する。集計対象は ds.rows のうち included===true のみ。
 *  - validResponses = その質問に非空回答をした人数
 *  - blankResponses = included件数 - validResponses
 *  - totalSelections = 延べ選択数
 *  - percentage = count / validResponses * 100（validResponses===0 なら 0）
 *    小数第2位で四捨五入して保持する
 *  - items の並びは q.order に従う
 *      'preset' → presetOptions の順、その後に残りを件数降順
 *      'count'  → 件数降順（同数はラベル自然順）
 *      'natural'→ ラベル自然順
 *  - numeric のときは makeBins の結果を items に入れ、numeric に summarizeNumeric を入れる
 *  - free のときは items=[] とし freeTextSamples に最大20件（各200字で切る） */
export function aggregateQuestion(ds: Dataset, q: QuestionDef): Aggregation;

/** kind==='ignore' 以外の全質問を集計して AnalysisResult を返す。
 *  generator は "crowdworks-ai-survey-analyzer v1.0.0" */
export function aggregateAll(ds: Dataset): AnalysisResult;
// 対象は kind!=='ignore' かつ selected===true の質問だけ。
// これにより 基本集計・グラフ・summary.csv・analysis.json・survey-summary.md が
// 「7. 出力する項目」の選択に一括で追随する。
```

---

## src/core/crosstab.ts — クロス集計

```ts
import type { CrossTabMode, CrossTabResult, Dataset } from '../types.ts';

/** 行質問 × 列質問のクロス集計。
 *  - 対象は included かつ「行・列の両方に有効回答がある」回答者
 *  - 複数回答は該当する全セルに 1 を加算する（1人が複数セルに現れる）
 *  - rowTotals[i] = 行ラベル i に該当した回答者の実人数
 *  - colTotals[j] = 列ラベル j に該当した回答者の実人数
 *  - grandTotal = 両方に有効回答した回答者の実人数
 *  - rowLabels / colLabels の順は aggregateQuestion と同じ並び規則
 *  - ラベルは実際に出現したものだけ（件数0の選択肢は含めない）
 *  - free / ignore の質問は対象外（呼び出し側で弾くが、来たら空の結果を返す） */
export function crossTabulate(
  ds: Dataset, rowKey: string, colKey: string, mode: CrossTabMode
): CrossTabResult;

/** 表示用のセル値を文字列にする。
 *  count → "12"
 *  row   → "12 (30.0%)"  分母は rowTotals[r]
 *  col   → "12 (24.5%)"  分母は colTotals[c]
 *  total → "12 (12.8%)"  分母は grandTotal */
export function formatCell(ct: CrossTabResult, r: number, c: number): string;
```

---

## src/export/csv.ts

```ts
import type { AnalysisResult, CrossTabResult, Dataset } from '../types.ts';

/** RFC4180 準拠のエスケープ（" を "" に、区切り/改行/" を含むならクォート） */
export function csvEscape(v: string | number): string;
export function toCsv(rows: (string | number)[][]): string;

/** summary.csv
 *  ヘッダー: question,option,count,percentage,valid_responses,multiple_choice
 *  percentage は小数第2位まで、multiple_choice は "true"/"false" */
export function toSummaryCsv(a: AnalysisResult): string;

/** cross-tab.csv
 *  1行目: "# 行: X / 列: Y / 有効回答者数: N / 表示: mode" のコメント行
 *  2行目: 行質問名, 列ラベル…, "合計(実人数)"
 *  3行目以降: 行ラベル, 各セル件数…, rowTotals
 *  最終行: "合計(実人数)", colTotals…, grandTotal */
export function toCrossTabCsv(c: CrossTabResult): string;

/** responses.csv: 先頭に "No" 列 + 元データ全列 + 末尾に "included"（"true"/"false"）。
 *  監査・再確認用なので、除外した回答も削除せず全件残すこと。
 *  他のエクスポート（summary / cross-tab / analysis.json / 各 Markdown）は
 *  集計対象のみを使うが、このファイルだけは例外。
 *  設問の出力選択（QuestionDef.selected）の影響も受けない。
 *  hiddenColumns には「表示OFFにした識別情報の列 index」だけを渡す
 *  （core/identity.ts の hiddenIdentityColumns の戻り値）。
 *  列を落としても No 列は ResponseRow.id 由来なので、行の対応は崩れない。 */
export function toResponsesCsv(ds: Dataset, hiddenColumns?: Iterable<number>): string;
```

CSV文字列に BOM は付けない（BOM 付与は download 側の責務）。

## src/export/json.ts

```ts
import type { AnalysisResult } from '../types.ts';
export function toAnalysisJson(a: AnalysisResult): string; // JSON.stringify(a, null, 2)
```

## src/export/markdown.ts

```ts
import type { AnalysisResult, CrossTabResult } from '../types.ts';

/** ChatGPT / Claude にそのまま渡せる Markdown。
 *  構成:
 *    # 生成AI仕事利用アンケート 集計結果
 *    - データ名 / 生成日時 / 出力元
 *    - 全回答数 / 有効回答数(集計対象) / 除外回答数
 *    ## <質問ラベル>
 *    （複数回答なら "※複数回答（合計が100%を超えることがあります）"）
 *    有効回答数: N件（未回答 M件 / 集計対象 K件）
 *    | 選択肢 | 人数 | 割合 |
 *    |---|---:|---:|
 *    数値項目は要約統計（件数/平均/中央値/最小/最大/第1四分位/第3四分位）も併記。
 *    自由記述は件数のみ（本文は載せない＝個人情報配慮）。
 *  割合は小数第1位まで表示（例 83.0%）。丸めすぎない。 */
export function toMarkdown(a: AnalysisResult): string;

/** クロス集計を Markdown 表にする */
export function crossTabToMarkdown(c: CrossTabResult): string;

/** survey-free-text.md: 集計対象の自由記述の本文だけを集めた Markdown。
 *  ChatGPT / Claude にそのまま渡して定性分析させるためのファイル。
 *  構成:
 *    # 自由記述回答
 *    集計対象回答数: N件
 *    自由記述あり: M件
 *    対象の設問: <ラベル> / <ラベル>
 *    ## 回答 <No>        ← responses.csv の No 列と同じ通し番号
 *    本文（元データのまま。要約・切り詰め・個人情報の付加をしない）
 *  - included === true の回答だけを対象にする（除外回答は含めない）
 *  - 本文が空の回答は見出しごと出さない
 *  - kind==='free' の設問が2つ以上あるときだけ、本文の前に **設問ラベル** を置く */
export function toFreeTextMarkdown(ds: Dataset): string;
```

## src/export/download.ts

```ts
/** Blob を a[download] でダウンロードさせる。ObjectURL は解放する */
export function downloadBlob(filename: string, blob: Blob): void;
/** テキストを UTF-8 でダウンロード。withBom=true なら先頭に BOM を付ける */
export function downloadText(
  filename: string, text: string, mime: string, withBom?: boolean
): void;
```

## src/export/png.ts

```ts
import type { Chart } from 'chart.js';

/** Chart のキャンバスを scale 倍・背景色付きの PNG Blob にする。
 *  Chart.js のキャンバスは透過なので、白背景に描き直してから出力する。
 *  scale 既定 2、background 既定 "#ffffff"。 */
export function chartToPngBlob(
  chart: Chart, scale?: number, background?: string
): Promise<Blob>;
```

---

## UI

- `src/state/store.ts`: 依存なしの最小ストア。`createStore<T>(initial)` → `{ get, set, update, subscribe }`
- `src/ui/components/dom.ts`: `el(tag, props, children)` ヘルパー、`clear(node)`
- `src/ui/components/table.ts`: 集計表・クロス集計表の描画
- `src/ui/charts/chart.ts`: Chart.js の必要コンポーネントのみ register し、Aggregation から Chart を作る
- `src/ui/sections/*.ts`: 各セクションの描画
- `src/ui/app.ts`: 全体の組み立て

**UI要件（上から順）**

1. データ読み込み（D&D / ファイル選択 / テキスト貼り付け / サンプル読み込み）
2. 回答数・集計対象・除外数のサマリー + 認識した列一覧
3. 回答一覧（表、各行にチェックボックスで集計対象/除外、全選択/全解除、検索）
4. 基本集計（質問ごとの表。質問の種別をUIから変更できる）
5. グラフ（自動生成。数値表を必ず併記。PNG保存ボタン）
6. クロス集計（縦軸/横軸を選択、表示モード切替）
7. エクスポート（summary.csv / cross-tab.csv / analysis.json / survey-summary.md / responses.csv / 全グラフPNG）

日本語UI。PC想定。派手な装飾は不要だが、余白・境界・整列は整えること。

---

## 禁止事項（プライバシー）

- `fetch` / `XMLHttpRequest` / `WebSocket` / `navigator.sendBeacon` を書かない
- `localStorage` / `sessionStorage` / `IndexedDB` / `document.cookie` を書かない
- CDN からのスクリプト・フォント・画像の読み込みを書かない
- analytics / telemetry を入れない

---

## src/core/identity.ts — 識別情報・管理列

CrowdWorks の管理列（作業ID / 作業者名 / 作業者ページURL / 承認日時）の扱い。
`QuestionProfile.identity` が設定された列は必ず `kind: 'ignore'` なので、
集計・グラフ・summary.csv・analysis.json・survey-summary.md・survey-free-text.md・
cross-tab.csv には構造的に載らない。出るのは回答一覧と responses.csv だけ。

```ts
import type { Dataset, IdentityKind, QuestionDef } from '../types.ts';

/** 画面に出す順番 */
export const IDENTITY_KINDS: readonly IdentityKind[];

/** チェックボックスの文言 */
export const IDENTITY_LABELS: Record<IdentityKind, string>;

/** UI からON/OFFできる識別情報。承認日時は個人を特定しないため常に表示する */
export const TOGGLEABLE_IDENTITY_KINDS: readonly IdentityKind[];

export type IdentityVisibility = Record<IdentityKind, boolean>;

/** 既定は worker-name / worker-url / worker-id が false、approved-at が true */
export function defaultIdentityVisibility(): IdentityVisibility;

/** データセットに含まれている識別情報の列（IDENTITY_KINDS の順） */
export function identityQuestions(ds: Dataset): QuestionDef[];

/** 表示しない識別情報の列 index。回答一覧と responses.csv がこれを落とす */
export function hiddenIdentityColumns(ds: Dataset, visibility: IdentityVisibility): Set<number>;

/** 回答一覧・responses.csv に出す列 index（元の並び順のまま） */
export function visibleColumnIndexes(ds: Dataset, visibility: IdentityVisibility): number[];
```

新しい管理列を足すときは
`types.ts` の `IdentityKind` にキーを追加し、
`profiles.ts` に `kind: 'ignore'` + `identity: <キー>` のプロファイルを足し、
`identity.ts` の `IDENTITY_KINDS` / `IDENTITY_LABELS` / `defaultIdentityVisibility` を更新する。
個人を特定しうる列なら `TOGGLEABLE_IDENTITY_KINDS` にも足して既定を false にする。

---

## src/core/adapters/crowdworks.ts — CrowdWorks 実CSVアダプター

CrowdWorks のアンケートCSVは、選択式設問を
「選択肢番号の列 + ヘッダーが空欄のラベル列」の2列セットで出力する。
複数選択は選択肢ごとに2列セットが並ぶ（`12-1.` `12-2.` …）。
実ファイルはこの形で 321 列になる。

このモジュールはその構造を「1設問=1列」へ畳み込む。
`buildDataset` が読み込み時に自動で呼ぶので、
schema 以降（aggregate / chart / crosstab / export）は CrowdWorks 固有の構造を知らない。

```ts
import type { RawTable } from '../../types.ts';

/** 実ファイルの管理列名（この4つが揃っていることが判定の必須条件） */
export const CROWDWORKS_MANAGEMENT_HEADERS: readonly string[];
// ['作業ID', '作業者', '作業者ページURL', '承認日時']

/** CrowdWorks 形式か判定する。
 *  条件: 管理列4つが揃っている かつ
 *        枝番付きヘッダー（"12-1."）または番号付きヘッダーの直後が空ヘッダー列 */
export function isCrowdWorksTable(table: RawTable): boolean;

/** 2列セットを畳み込んだ RawTable を返す。
 *  - 管理列はそのまま残す
 *  - 単一選択は右のラベル列の値を採る（選択肢番号は捨てる）
 *  - 枝番付きは1設問へ統合し、選択されたラベルを改行区切りで結合する
 *  - 自由入力（番号付きで空ヘッダー列が続かない）は値をそのまま保持する
 *  - 空ヘッダー列は単独の設問にしない
 *  - 行数は変えない
 *  - forcedKinds に種別を載せる:
 *      枝番付きの2列セット群 → 'multiple'
 *      枝番なしの2列セット   → 'single'
 *      ペアにならない1列     → 載せない（自由入力なのでプロファイル／推定に任せる）
 *  - sourceFormat='crowdworks'、warnings に検出メッセージを追加する */
export function normalizeCrowdWorksTable(table: RawTable): RawTable;
```

**設問のグループキー**
枝番付き（`12-1`, `12-2`）は `"12#multi"`、枝番なし（`1.`）は `"1#single"` にする。
番号は文字列のまま比較するので `3` と `13` が混ざらず、
`1.` と `1-1.` が同居しても取り違えない。

**2列セットは選択式として種別を固定する**
ラベル列とペアになっている時点で「用意された選択肢から選ぶ設問」だと構造的に確定する。
値からの推定より優先することで、`覚えていない` のような選択肢が混じった月の設問が
「ほぼ数値・異なり13種」と判定されて数値集計に化けるのを防ぐ。

**単一選択セルの値は正規化しない**
`45～54` のような値はそのまま残す（表記の正規化は集計時に `canonicalizeOption` が行う）。
自由入力列の改行・記号を読み込み層で壊さないための設計。
複数選択の結合時だけは、空欄判定と重複除去のために `normalizeText` を通す。

## RawTable の読み込み層ヒント

```ts
/** 元のヘッダーが空欄だった列の index（parseText が "列N" を補った列） */
emptyHeaderColumns?: number[];
/** 列 index → 強制する質問種別。プロファイルの kind や自動推定より優先される */
forcedKinds?: Record<number, QuestionKind>;
/** 読み込み層が判定した入力形式 */
sourceFormat?: SourceFormat; // 'generic' | 'crowdworks'
```

`forcedKinds` は「データ構造から確実に分かる」場合だけ設定する。
CrowdWorks の複数選択グループがこれに当たる
（プロファイル上 `occupation` は single、`job-detail` は free だが、
実データが枝番付きの複数選択なので multiple に矯正される）。
種別が矯正されたときは `chartForKind` でグラフ種別も種別側へ寄せる。

---

## src/core/worktime.ts — 「実際の作業時間」の派生値

Q11 は自由入力で、1セルに「作業日数」と「合計作業時間」が改行で並ぶ。
原文は一切変更せず、確実に読み取れる場合だけ派生質問の値を作る。

```ts
/** 解析できなかった回答に付けるラベル（0 や空欄として集計しないための目印） */
export const UNPARSED_LABEL: string; // '解析不能'

/** 合計作業時間の表示用ビン。波ダッシュは半角 ~（NFKC 正規化と揃えるため） */
export const WORK_MINUTES_BINS: readonly string[];

/** 作業日数の表示順（1日〜31日）。実データに出た値だけが表に載る */
export const WORK_DAYS_PRESET: string[];

/** 作業日数を取り出す。読み取れなければ null */
export function parseWorkDays(raw: string): number | null;

/** 合計作業時間を「分」で取り出す。読み取れなければ null */
export function parseWorkMinutes(raw: string): number | null;

/** 分をビンのラベルへ（下限を含み上限を含まない） */
export function workMinutesBinLabel(minutes: number): string;

/** 派生セルの値。原文が空欄なら ''、解析不能なら UNPARSED_LABEL */
export function workDaysCell(raw: string): string;
export function workMinutesCell(raw: string): string;
```

**読み取る形**

- 作業日数: `1日` / `１日` / `一日` / `3日` / ラベル直後の単独整数（`作業日数：2`）
- 合計作業時間: `30分` / `3時間` / `5時間30分` / `1時間半` / `約3時間` /
  前後の `約` `ほど` `程度` `程` `くらい` は無視する

**読み取らない形（解析不能にする）**

- 作業日数: `半日以下` / `3週間` / `3ヶ月 週5` など、日数が一意に決まらない記述
- 合計作業時間: `8` `１６` のように単位が無い値、
  `応募に1分、作業に3分` のように複数の時間が別々の意味で並ぶ文章
- 文章の途中から数字を拾うことはしない（値そのものと厳密一致した形だけを受け付ける）

**派生質問の作り方（schema.ts）**

`work-hours` プロファイルの列があるときだけ、末尾に2つ追加する。

```ts
{ key: 'work-days',    kind: 'single', order: 'preset',
  presetOptions: [...WORK_DAYS_PRESET, UNPARSED_LABEL],
  derived: { type: 'work-days', sourceColumn } }
{ key: 'work-minutes', kind: 'single', order: 'preset',
  presetOptions: [...WORK_MINUTES_BINS, UNPARSED_LABEL],
  derived: { type: 'work-minutes', sourceColumn } }
```

`single` にしているのは、解析不能を1つの選択肢として数え、
summary.csv / analysis.json / survey-summary.md のどれでも
「分布」と「解析不能件数」が同じ表に出るようにするため。
派生質問は列を増やさないので、responses.csv には原文だけが残る。
