/**
 * 「実際の作業時間」の自由記述から、分析用の派生値を取り出す。
 *
 * 実CSVの Q11 は次のように、1セルへ2つの異なる指標が改行で入っている。
 *
 *   - 作業日数:1日
 *   - 合計作業時間:3時間
 *
 * このモジュールは「確実に読み取れる場合だけ」数値化する。
 * 単位が書かれていない値や、意味が一意に定まらない記述は解析しない。
 * 原文は Dataset 側にそのまま残るので、解析できなかった回答は
 * responses.csv で必ず確認できる。
 */

import { normalizeText } from './text.ts';

/** 解析できなかった回答に付けるラベル。0 や空欄として集計しないための目印 */
export const UNPARSED_LABEL = '解析不能';

/**
 * 合計作業時間の表示用ビン（この順で並べる）。
 *
 * 波ダッシュは半角 `~` で書く。集計時に NFKC 正規化がかかるため、
 * ここを全角 `～` にすると定義と画面表示の文字が食い違ってしまう。
 * 各ビンは下限を含み上限を含まない（3時間ちょうどは "3~5時間未満"）。
 */
export const WORK_MINUTES_BINS = [
  '30分未満',
  '30分~1時間未満',
  '1~2時間未満',
  '2~3時間未満',
  '3~5時間未満',
  '5~10時間未満',
  '10~20時間未満',
  '20時間以上',
] as const;

/** 作業日数の表示順（1日〜31日）。実データに出た値だけが表に載る */
export const WORK_DAYS_PRESET: string[] = Array.from(
  { length: 31 },
  (_, i) => `${i + 1}日`,
);

/** 漢数字1文字 → 数値（「一日」のような明確な表記だけを対象にする） */
const KANJI_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** 「約」「およそ」などの前置き */
const LEADING_APPROX = /^(?:約|およそ|おおよそ|ほぼ)\s*/;

/** 「ほど」「程度」などの後置き */
const TRAILING_APPROX = /(?:ほど|程度|程|くらい|ぐらい|位)$/;

/**
 * ラベル付きの行から値の部分を取り出す。
 *
 * "- 作業日数:1日" の "1日" の部分を返す。
 * 同じラベルが複数行あるときは最初の1つだけを見る。
 * ラベルが無ければ null。
 */
function labelledValue(text: string, label: string): string | null {
  for (const line of text.split('\n')) {
    const index = line.indexOf(label);
    if (index < 0) continue;
    const rest = line.slice(index + label.length);
    // ラベル直後の区切り（: ： 　空白）を取り除く
    const value = rest.replace(/^[\s:：=＝]+/, '').trim();
    return value;
  }
  return null;
}

/** 前後の「約」「ほど」を落として、値そのものにする */
function stripApprox(value: string): string {
  return value.replace(LEADING_APPROX, '').replace(TRAILING_APPROX, '').trim();
}

/**
 * 作業日数を取り出す。読み取れなければ null。
 *
 * 数値化するのは次の形だけ:
 *   "1日" / "１日"（全角）/ "一日"（漢数字1文字）/ "3日"
 *   "作業日数:2" のように、ラベル直後に単位なしの整数だけがある場合
 *
 * 次のような記述は日数が一意に決まらないので解析しない:
 *   "半日以下" / "3週間" / "3ヶ月 週5" / "1日〜2日"
 *
 * @param raw Q11 の原文（改行を含んでよい）
 * @returns 日数。読み取れなければ null
 */
export function parseWorkDays(raw: string): number | null {
  const text = normalizeText(raw);
  if (text === '') return null;

  const labelled = labelledValue(text, '作業日数');
  // ラベルが無い場合は、セル全体が日数そのものを表しているときだけ見る
  const target = labelled !== null ? labelled : text.includes('\n') ? '' : text;
  if (target === '') return null;

  const value = stripApprox(target);

  // "3日" / "１日"（normalizeText の NFKC で半角化済み）
  const digits = /^(\d+)日$/.exec(value);
  if (digits) return toPositiveInt(digits[1]);

  // "一日" のような漢数字1文字 + 日
  const kanji = /^(.)日$/.exec(value);
  if (kanji) {
    const n = KANJI_DIGITS[kanji[1] ?? ''];
    return n ?? null;
  }

  // ラベル直後に単位なしの整数だけがある場合（"作業日数:2"）。
  // ラベルが「作業日数」だと分かっているので単位が無くても日数と確定できる。
  if (labelled !== null) {
    const bare = /^(\d+)$/.exec(value);
    if (bare) return toPositiveInt(bare[1]);
  }

  return null;
}

/** 正の整数として解釈する。0 や桁あふれは解析不能として扱う */
function toPositiveInt(text: string | undefined): number | null {
  if (!text) return null;
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/**
 * 合計作業時間を「分」で取り出す。読み取れなければ null。
 *
 * 数値化するのは次の形だけ（前後の「約」「ほど」は無視する）:
 *   "30分" → 30 / "3時間" → 180 / "5時間30分" → 330 /
 *   "1時間半" → 90 / "1時間半程" → 90 / "約3時間" → 180
 *
 * 次のような記述は解析しない:
 *   "8"（単位が無い）/ "16"（単位が無い）/
 *   "応募に1分、作業に3分"（複数の時間が別々の意味で並ぶ）/
 *   その他、値だけを取り出せない文章
 *
 * @param raw Q11 の原文（改行を含んでよい）
 * @returns 合計作業時間（分）。読み取れなければ null
 */
export function parseWorkMinutes(raw: string): number | null {
  const text = normalizeText(raw);
  if (text === '') return null;

  const labelled = labelledValue(text, '合計作業時間');
  // ラベルが無い場合は、セル全体が時間そのものを表しているときだけ見る
  // （"約8時間" のような1行だけの回答を拾うため）
  const target = labelled !== null ? labelled : text.includes('\n') ? '' : text;
  if (target === '') return null;

  return parseDurationValue(stripApprox(target));
}

/**
 * 「値そのもの」を分に変換する。厳密に一致した形だけを受け付ける。
 * 文章の途中から数字を拾うことはしない（別の意味の数値を拾う事故を防ぐため）。
 */
function parseDurationValue(value: string): number | null {
  // "5時間30分"
  const hm = /^(\d+)時間(\d+)分$/.exec(value);
  if (hm) {
    const h = toNonNegativeInt(hm[1]);
    const m = toNonNegativeInt(hm[2]);
    if (h === null || m === null || m >= 60) return null;
    return h * 60 + m;
  }

  // "1時間半"
  const half = /^(\d+)時間半$/.exec(value);
  if (half) {
    const h = toNonNegativeInt(half[1]);
    return h === null ? null : h * 60 + 30;
  }

  // "3時間"
  const hours = /^(\d+)時間$/.exec(value);
  if (hours) {
    const h = toNonNegativeInt(hours[1]);
    return h === null ? null : h * 60;
  }

  // "30分"
  const minutes = /^(\d+)分$/.exec(value);
  if (minutes) {
    return toNonNegativeInt(minutes[1]);
  }

  // 単位が無い数字（"8" "16"）は時間か分か決められないので解析しない
  return null;
}

/** 0 以上の整数として解釈する */
function toNonNegativeInt(text: string | undefined): number | null {
  if (!text) return null;
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

/**
 * 合計作業時間（分）を表示用のビンに割り当てる。
 * WORK_MINUTES_BINS のいずれかを返す。
 */
export function workMinutesBinLabel(minutes: number): string {
  if (minutes < 30) return WORK_MINUTES_BINS[0];
  if (minutes < 60) return WORK_MINUTES_BINS[1];
  if (minutes < 120) return WORK_MINUTES_BINS[2];
  if (minutes < 180) return WORK_MINUTES_BINS[3];
  if (minutes < 300) return WORK_MINUTES_BINS[4];
  if (minutes < 600) return WORK_MINUTES_BINS[5];
  if (minutes < 1200) return WORK_MINUTES_BINS[6];
  return WORK_MINUTES_BINS[7];
}

/**
 * 派生質問「作業日数」のセル値。
 * 解析できたら "3日"、できなければ UNPARSED_LABEL。
 * 原文が空欄（Q11 未回答）なら空文字を返し、母数から外す。
 */
export function workDaysCell(raw: string): string {
  if (normalizeText(raw) === '') return '';
  const days = parseWorkDays(raw);
  return days === null ? UNPARSED_LABEL : `${days}日`;
}

/**
 * 派生質問「合計作業時間」のセル値。
 * 解析できたらビンのラベル、できなければ UNPARSED_LABEL。
 * 原文が空欄（Q11 未回答）なら空文字を返し、母数から外す。
 */
export function workMinutesCell(raw: string): string {
  if (normalizeText(raw) === '') return '';
  const minutes = parseWorkMinutes(raw);
  return minutes === null ? UNPARSED_LABEL : workMinutesBinLabel(minutes);
}
