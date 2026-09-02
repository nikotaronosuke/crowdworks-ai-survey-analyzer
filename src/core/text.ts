/**
 * 文字列ユーティリティ。
 *
 * 集計キーの正規化・列名の照合・ラベルの並び替えに使う純関数だけを置く。
 * 外部依存なし / 副作用なし（ネットワーク・ストレージ一切なし）。
 */

/**
 * 空欄とみなす値。
 * normalizeText を通した後、小文字化した形で保持する。
 * "なし" "特になし" "0" "ー"（長音）は有効回答なので含めない。
 */
const BLANK_TOKENS: ReadonlySet<string> = new Set([
  '-', // ハイフンマイナス（全角 '－' は NFKC でここに寄る）
  '‐', // ‐ HYPHEN
  '—', // — EM DASH
  'n/a',
  'na',
  'null',
  'undefined',
]);

/** 列名照合で落とす記号（全角形は NFKC 後に半角へ寄るが、念のため両方並べる） */
const HEADER_SYMBOLS =
  /[【】（）()「」『』［］[\]・、。，．,.\-_/＼\\？?：:＊*※]/g;

/** 自然順比較で使うトークン分割（数値部分 / 非数値部分） */
const NATURAL_TOKEN = /\d+(?:\.\d+)?|\D+/g;

/** 数値トークンかどうか */
function isNumberToken(token: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(token);
}

/**
 * 自然順比較のためにトークン列へ分解する。
 * 全角数字を半角へ寄せ、桁区切りカンマ（"5,000"）は数値として読めるよう除去する。
 */
function tokenizeNatural(s: string): string[] {
  let t = s.normalize('NFKC');
  // "1,234,567" → "1234567"（数字に挟まれたカンマだけを繰り返し除去する）
  while (/\d,\d/.test(t)) {
    t = t.replace(/(\d),(\d)/g, '$1$2');
  }
  NATURAL_TOKEN.lastIndex = 0;
  return t.match(NATURAL_TOKEN) ?? [];
}

/**
 * 表示・集計の基本となる正規化。
 * NFKC正規化 → 全角空白を半角化 → 行内の連続空白を1つに圧縮 → 前後空白除去。
 * 改行は splitAnswers が区切りに使うため保持する（行頭・行末の空白のみ落とす）。
 */
export function normalizeText(s: string): string {
  if (!s) return '';
  let t = s.normalize('NFKC');
  // NFKC で大半は半角化されるが、取りこぼす空白類を明示的に潰す
  t = t.replace(/[　   ﻿]/g, ' ');
  // 改行コードを "\n" に統一
  t = t.replace(/\r\n?/g, '\n');
  // 改行以外の連続空白を1つに圧縮
  t = t.replace(/[^\S\n]+/g, ' ');
  // 改行まわりの空白を除去（改行そのものは残す）
  t = t.replace(/ *\n */g, '\n');
  return t.trim();
}

/**
 * 集計キー・照合用の正規化。
 * normalizeText に加えて小文字化と、末尾の句読点（。、．，.,）除去を行う。
 */
export function normalizeKey(s: string): string {
  const t = normalizeText(s).toLowerCase();
  return t.replace(/[。、．，.,]+$/, '').trim();
}

/**
 * 空欄判定。
 * 空文字・空白のみ・ハイフン類・N/A・NA・null・undefined を空欄とみなす。
 * "なし" "特になし" "0" "ー" は有効回答として false を返す。
 */
export function isBlank(s: string | undefined | null): boolean {
  if (s === undefined || s === null) return true;
  const t = normalizeText(s);
  if (t === '') return true;
  return BLANK_TOKENS.has(t.toLowerCase());
}

/**
 * 列名の照合用正規化。
 * normalizeKey に加えて空白を全除去し、括弧・区切り記号・?・:・*・※ を除去する。
 * 日本語の文字と英数字だけが残り、英字は小文字化される。
 */
export function normalizeHeader(s: string): string {
  return normalizeKey(s).replace(/\s+/g, '').replace(HEADER_SYMBOLS, '');
}

/**
 * ラベルの自然順比較。
 * 文字列を「非数値部分」と「数値部分」に分解し、先頭から順に比較する。
 * 例: "10代" < "20代" / "1万円未満" < "3万円未満" / "2024-01" < "2024-02"。
 * 数値部分が無い（または全て同値の）場合は localeCompare('ja') にフォールバックする。
 */
export function naturalCompare(a: string, b: string): number {
  const ta = tokenizeNatural(a);
  const tb = tokenizeNatural(b);
  const len = Math.min(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const xa = ta[i];
    const xb = tb[i];
    const aIsNum = isNumberToken(xa);
    const bIsNum = isNumberToken(xb);
    if (aIsNum && bIsNum) {
      const na = Number(xa);
      const nb = Number(xb);
      if (na !== nb) return na < nb ? -1 : 1;
      // 数値として同値（"01" と "1" など）なら次のトークンへ
      continue;
    }
    const c = xa.localeCompare(xb, 'ja');
    if (c !== 0) return c;
  }
  if (ta.length !== tb.length) return ta.length - tb.length;
  return a.localeCompare(b, 'ja');
}

/**
 * 重複する列名を "名前", "名前 (2)", "名前 (3)" と一意化する。
 * 空文字はそのまま返す（空ヘッダーの命名は parse.ts の責務）。
 * 付与した連番が既存の名前と衝突する場合は、衝突しなくなるまで番号を進める。
 */
export function uniquifyHeaders(headers: string[]): string[] {
  const used = new Set<string>();
  const result: string[] = [];
  for (const header of headers) {
    if (header === '') {
      result.push('');
      continue;
    }
    if (!used.has(header)) {
      used.add(header);
      result.push(header);
      continue;
    }
    let n = 2;
    let candidate = `${header} (${n})`;
    while (used.has(candidate)) {
      n += 1;
      candidate = `${header} (${n})`;
    }
    used.add(candidate);
    result.push(candidate);
  }
  return result;
}
