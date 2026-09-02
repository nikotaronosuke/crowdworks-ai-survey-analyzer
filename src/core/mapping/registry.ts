/**
 * 生の列名（設問文）と質問プロファイルの照合。
 *
 * 実データの列名は "Q3. 現在の職種を教えてください" のように
 * 番号や敬体が付いて来るため、完全一致だけでなく部分一致でも拾う。
 * 部分一致は「マッチしたパターンが最長のもの」を採用することで、
 * ai-tools / main-ai / ai-usage のような紛らわしい設問の取り違えを防ぐ。
 */

import { normalizeHeader } from '../text.ts';
import { CROWDWORKS_PROFILES, type QuestionProfile } from './profiles.ts';

/**
 * プロファイル1件の照合パターン（label + aliases を normalizeHeader したもの）。
 * 同じプロファイルに対して繰り返し呼ばれるためキャッシュする。
 */
const PATTERN_CACHE = new WeakMap<QuestionProfile, string[]>();

/** label と aliases を正規化した照合パターン一覧を返す（空文字は除く） */
function patternsOf(profile: QuestionProfile): string[] {
  const cached = PATTERN_CACHE.get(profile);
  if (cached) return cached;
  const patterns: string[] = [];
  for (const raw of [profile.label, ...profile.aliases]) {
    const p = normalizeHeader(raw);
    if (p !== '' && !patterns.includes(p)) patterns.push(p);
  }
  PATTERN_CACHE.set(profile, patterns);
  return patterns;
}

/**
 * 生ヘッダー文字列からプロファイルを引く。
 *
 * 1. normalizeHeader 後の完全一致（label / aliases）
 * 2. 無ければ部分一致（ヘッダーがパターンを含む）候補を集め、
 *    マッチしたパターンが最長のものを採用する。
 *    同点なら profiles の定義順で先のものを採用する。
 * 3. どれにも当たらなければ undefined（空ヘッダーも undefined）
 */
export function findProfile(
  header: string,
  profiles: QuestionProfile[] = CROWDWORKS_PROFILES,
): QuestionProfile | undefined {
  if (!header) return undefined;
  const h = normalizeHeader(header);
  if (h === '') return undefined;

  // 1. 完全一致を最優先する
  for (const profile of profiles) {
    for (const pattern of patternsOf(profile)) {
      if (pattern === h) return profile;
    }
  }

  // 2. 部分一致は最長マッチ優先（同点は定義順で先勝ち）
  let best: QuestionProfile | undefined;
  let bestLength = 0;
  for (const profile of profiles) {
    let matched = 0;
    for (const pattern of patternsOf(profile)) {
      if (pattern.length > matched && h.includes(pattern)) matched = pattern.length;
    }
    if (matched > bestLength) {
      best = profile;
      bestLength = matched;
    }
  }
  return best;
}

/** 登録済みプロファイル集合（将来 CrowdWorks 以外を足せるようにする） */
export const PROFILE_SETS: Record<string, QuestionProfile[]> = {
  crowdworks: CROWDWORKS_PROFILES,
};
