/**
 * DOM 生成の小さなヘルパー群。
 * テンプレート文字列で HTML を組み立てると XSS の温床になるため、
 * 原則としてこの el() でノードを組み立てる。
 */

/** el() が特別扱いするプロパティ */
export interface ElExtraProps {
  /** className に入れる */
  class?: string;
  /** data-* 属性 */
  dataset?: Record<string, string>;
  /** イベント名 → ハンドラ（addEventListener で登録） */
  on?: Record<string, (e: Event) => void>;
  /** innerHTML に入れる。呼び出し側の責任でユーザーデータには使わない */
  html?: string;
}

/**
 * 要素を作る。
 * - `class` → className、`on` → addEventListener、`dataset` → data-*
 * - `html` は innerHTML（信頼できる固定文字列のみ）
 * - それ以外のキーは要素のプロパティへ直接代入する（id / type / checked など）
 * - children の string は textContent としてノード化するのでエスケープ不要
 *
 * @param tag 生成するタグ名
 * @param props プロパティ（省略可）
 * @param children 子ノード。string はテキストノードになる。null/undefined は無視
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]> & ElExtraProps,
  children?: (Node | string | null | undefined)[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  // タグごとの具体型のままだと汎用的な代入が書きづらいので、共通の基底型で操作する。
  const base: HTMLElement = node;

  if (props) {
    const entries = Object.entries(props as unknown as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (value === undefined || value === null) continue;

      if (key === 'class') {
        base.className = String(value);
        continue;
      }

      if (key === 'dataset') {
        for (const [dataKey, dataValue] of Object.entries(value as Record<string, string>)) {
          base.dataset[dataKey] = dataValue;
        }
        continue;
      }

      if (key === 'on') {
        const handlers = value as Record<string, (e: Event) => void>;
        for (const [type, handler] of Object.entries(handlers)) {
          base.addEventListener(type, handler);
        }
        continue;
      }

      if (key === 'html') {
        base.innerHTML = String(value);
        continue;
      }

      // style は文字列でもオブジェクトでも受け付けられるようにしておく。
      if (key === 'style') {
        if (typeof value === 'string') {
          base.setAttribute('style', value);
        } else {
          Object.assign(base.style, value as Partial<CSSStyleDeclaration>);
        }
        continue;
      }

      (base as unknown as Record<string, unknown>)[key] = value;
    }
  }

  if (children) {
    for (const child of children) {
      if (child === undefined || child === null) continue;
      base.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }

  return node;
}

/** 子ノードを全て取り除く */
export function clear(node: Element): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/** 整数を3桁区切りにする（小数は四捨五入）。有限でなければ "-" */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return Math.round(n).toLocaleString('ja-JP', { maximumFractionDigits: 0 });
}

/**
 * 小数桁を固定した3桁区切り。
 * @param digits 小数桁数（既定 1）
 */
export function fmtNum(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '-';
  const d = Math.max(0, Math.min(20, Math.trunc(digits)));
  return n.toLocaleString('ja-JP', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/**
 * 割合（0-100 のパーセント値）を "83.0%" のように整形する。
 * @param digits 小数桁数（既定 1）
 */
export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '-';
  return `${fmtNum(n, digits)}%`;
}
