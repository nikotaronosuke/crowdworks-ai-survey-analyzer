/**
 * 依存ゼロの最小ストア。
 * アプリ全体の状態（Dataset / 選択中のクロス軸など）を1か所に持ち、
 * 変更時に購読者へ通知するためだけの薄い仕組み。
 * 外部ライブラリもブラウザ保存領域も一切使わない（完全にメモリ上のみ）。
 */

/** 値を1つ保持し、変更を購読できるストア */
export interface Store<T> {
  /** 現在値を取得する */
  get(): T;
  /** 値を置き換えて全購読者へ通知する */
  set(v: T): void;
  /** 現在値から次の値を計算して set する */
  update(fn: (v: T) => T): void;
  /**
   * 変更を購読する。登録時点では呼ばれず、以降の set のたびに呼ばれる。
   * @returns 購読を解除する関数（何度呼んでも安全）
   */
  subscribe(fn: (v: T) => void): () => void;
}

/**
 * ストアを作る。
 * @param initial 初期値
 */
export function createStore<T>(initial: T): Store<T> {
  let value: T = initial;
  const subscribers = new Set<(v: T) => void>();

  const store: Store<T> = {
    get(): T {
      return value;
    },

    set(v: T): void {
      value = v;
      // 通知中に subscribe / 解除が起きても壊れないよう、スナップショットに対して回す。
      for (const fn of Array.from(subscribers)) {
        fn(value);
      }
    },

    update(fn: (v: T) => T): void {
      store.set(fn(value));
    },

    subscribe(fn: (v: T) => void): () => void {
      subscribers.add(fn);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscribers.delete(fn);
      };
    },
  };

  return store;
}
