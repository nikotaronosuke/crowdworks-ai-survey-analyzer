/**
 * CrowdWorks の識別情報・管理列（作業ID / 作業者名 / 作業者ページURL / 承認日時）の扱い。
 *
 * これらはアンケートの設問ではないので、
 * 集計・グラフ・summary.csv・analysis.json・survey-summary.md・survey-free-text.md・
 * cross-tab.csv には一切載せない（列の kind が常に 'ignore' なので構造的に載らない）。
 *
 * 用途は次の2つだけに限定する。
 *   1. 回答一覧での目視確認
 *   2. responses.csv での監査
 *
 * さらに、個人を特定しうる列は既定で非表示にしてある。
 * 表示をONにしたときだけ上記2か所に出る。
 */

import type { Dataset, IdentityKind, QuestionDef } from '../types.ts';

/** 画面に出す順番 */
export const IDENTITY_KINDS: readonly IdentityKind[] = [
  'worker-name',
  'worker-url',
  'worker-id',
  'approved-at',
];

/** チェックボックスの文言 */
export const IDENTITY_LABELS: Record<IdentityKind, string> = {
  'worker-name': '作業者名',
  'worker-url': '作業者ページURL',
  'worker-id': '作業ID',
  'approved-at': '承認日時',
};

/**
 * UI から表示・非表示を切り替えられる識別情報。
 *
 * 承認日時は個人を特定しないうえ、いつの回答かの確認に使うので常に残す
 * （集計・グラフ・AI向け出力に載らない点は他の管理列と同じ）。
 */
export const TOGGLEABLE_IDENTITY_KINDS: readonly IdentityKind[] = [
  'worker-name',
  'worker-url',
  'worker-id',
];

/** 表示状態。既定では個人を特定しうる3列を伏せる */
export type IdentityVisibility = Record<IdentityKind, boolean>;

/** 既定の表示状態（個人情報は OFF から始める） */
export function defaultIdentityVisibility(): IdentityVisibility {
  return {
    'worker-name': false,
    'worker-url': false,
    'worker-id': false,
    'approved-at': true,
  };
}

/** データセットに含まれている識別情報の列（画面に出す順） */
export function identityQuestions(ds: Dataset): QuestionDef[] {
  const found = new Map<IdentityKind, QuestionDef>();
  for (const q of ds.questions) {
    if (q.identity && q.columnIndex >= 0 && !found.has(q.identity)) {
      found.set(q.identity, q);
    }
  }
  return IDENTITY_KINDS.flatMap((kind) => {
    const q = found.get(kind);
    return q ? [q] : [];
  });
}

/**
 * 表示しない識別情報の列 index。
 *
 * 回答一覧と responses.csv はこの集合の列を落とす。
 * 落とすのは表示だけで、Dataset 側の値は保持し続けるため、
 * 集計対象／除外の切り替えには影響しない。
 */
export function hiddenIdentityColumns(ds: Dataset, visibility: IdentityVisibility): Set<number> {
  const hidden = new Set<number>();
  for (const q of ds.questions) {
    if (q.identity && q.columnIndex >= 0 && !visibility[q.identity]) {
      hidden.add(q.columnIndex);
    }
  }
  return hidden;
}

/** 回答一覧・responses.csv に出す列 index（元の並び順のまま） */
export function visibleColumnIndexes(ds: Dataset, visibility: IdentityVisibility): number[] {
  const hidden = hiddenIdentityColumns(ds, visibility);
  const indexes: number[] = [];
  for (let i = 0; i < ds.headers.length; i++) {
    if (!hidden.has(i)) indexes.push(i);
  }
  return indexes;
}
