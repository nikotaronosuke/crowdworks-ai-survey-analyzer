/**
 * CrowdWorks 実CSV形式を模した fixture。
 *
 * 実ファイルの構造をそのまま縮小したもの:
 *  - 先頭に管理列4列（作業ID / 作業者 / 作業者ページURL / 承認日時）
 *  - 単一選択は「番号列 + 空ヘッダーのラベル列」の2列セット
 *  - 複数選択は「12-1.」「12-2.」… と枝番付きの2列セットが並ぶ
 *  - 自由入力は通常の1列
 *
 * 個人情報にあたる値は入れない（作業者名はダミー、URLは example.invalid）。
 */

/** CSV の1行を組み立てる（全セルをクォートする＝CrowdWorks の実出力に合わせる） */
function csvRow(cells: string[]): string {
  return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
}

/**
 * ヘッダー定義。
 * label が '' の列は CrowdWorks の「選択肢ラベル列」（ヘッダーが空欄）。
 */
const HEADERS: string[] = [
  '作業ID',
  '作業者',
  '作業者ページURL',
  '承認日時',
  // 単一選択: 年齢
  '1. 年齢',
  '',
  // 単一選択: 性別
  '2. 性別',
  '',
  // 複数選択: 現在の職種（3-1 / 3-2）
  '3-1. 現在の職種（複数選択可）',
  '',
  '3-2. 現在の職種（複数選択可）',
  '',
  // 複数選択: 仕事を受注したサービス・経路（4-1 / 4-2）
  '4-1. 仕事を受注したサービス・経路（複数選択可）',
  '',
  '4-2. 仕事を受注したサービス・経路（複数選択可）',
  '',
  // 単一選択: 受注年 / 受注月
  '5. 仕事を受注・開始した年',
  '',
  '6. 仕事を受注・開始した月',
  '',
  // 単一選択: 仕事の主なカテゴリ
  '7. 仕事の主なカテゴリ',
  '',
  // 複数選択: 具体的に行った仕事内容（8-1 / 8-2）
  '8-1. 具体的に行った仕事内容（複数選択可）',
  '',
  '8-2. 具体的に行った仕事内容（複数選択可）',
  '',
  // 単一選択: 契約・報酬形式 / 報酬
  '9. 契約・報酬形式',
  '',
  '10. 報酬',
  '',
  // 自由入力: 実際の作業時間（1列だけ。空ヘッダー列が続かない）
  '11. 実際の作業時間',
  // 複数選択: 使用したAI・AIツール（12-1 / 12-2 / 12-3）
  '12-1. 使用したAI・AIツール（複数選択可）',
  '',
  '12-2. 使用したAI・AIツール（複数選択可）',
  '',
  '12-3. 使用したAI・AIツール（複数選択可）',
  '',
  // 自由入力: 一番使ったAI
  '13. 上記の中で一番使ったAIは何ですか？',
  // 複数選択: AIを何に使いましたか？（14-1 / 14-2）
  '14-1. AIを何に使いましたか？（複数選択可）',
  '',
  '14-2. AIを何に使いましたか？（複数選択可）',
  '',
  // 単一選択群
  '15. AI利用割合',
  '',
  '16. AI出力を人間がどれくらい修正したか',
  '',
  '17. AIがなければ仕事を受けたか',
  '',
  '18. クライアント側のAI利用ルール',
  '',
  '19. AI利用をクライアントに伝えたか',
  '',
  '20. 修正回数',
  '',
  '21. 仕事の結果',
  '',
  '22. また同じような仕事を受けたいか',
  '',
  // 自由入力: 自由記述
  '23. 何かあればこちらへ',
];

/**
 * 1回答分のセル。HEADERS と同じ並び。
 * 選択されていない選択肢は「番号もラベルも空」にする。
 */
interface Answer {
  workerId: string;
  worker: string;
  workerUrl: string;
  approvedAt: string;
  age: [string, string];
  gender: [string, string];
  /** 職種（最大2つ）。未選択は ['', ''] */
  occupation: [[string, string], [string, string]];
  channel: [[string, string], [string, string]];
  year: [string, string];
  month: [string, string];
  category: [string, string];
  jobDetail: [[string, string], [string, string]];
  contract: [string, string];
  reward: [string, string];
  /** 自由入力（改行を含みうる） */
  workHours: string;
  aiTools: [[string, string], [string, string], [string, string]];
  /** 自由入力（表記ゆれあり） */
  mainAi: string;
  aiUsage: [[string, string], [string, string]];
  aiRatio: [string, string];
  humanEdit: [string, string];
  withoutAi: [string, string];
  clientRule: [string, string];
  disclosed: [string, string];
  revisions: [string, string];
  result: [string, string];
  repeat: [string, string];
  /** 自由記述（改行を含みうる） */
  comment: string;
}

/** Answer を HEADERS と同じ並びのセル配列にする */
function toCells(a: Answer): string[] {
  return [
    a.workerId,
    a.worker,
    a.workerUrl,
    a.approvedAt,
    ...a.age,
    ...a.gender,
    ...a.occupation[0],
    ...a.occupation[1],
    ...a.channel[0],
    ...a.channel[1],
    ...a.year,
    ...a.month,
    ...a.category,
    ...a.jobDetail[0],
    ...a.jobDetail[1],
    ...a.contract,
    ...a.reward,
    a.workHours,
    ...a.aiTools[0],
    ...a.aiTools[1],
    ...a.aiTools[2],
    a.mainAi,
    ...a.aiUsage[0],
    ...a.aiUsage[1],
    ...a.aiRatio,
    ...a.humanEdit,
    ...a.withoutAi,
    ...a.clientRule,
    ...a.disclosed,
    ...a.revisions,
    ...a.result,
    ...a.repeat,
    a.comment,
  ];
}

const AGES: [string, string][] = [
  ['1', '18～24'],
  ['2', '25～34'],
  ['3', '35～44'],
  ['4', '45～54'],
  ['5', '55～64'],
];
const GENDERS: [string, string][] = [
  ['1', '男性'],
  ['2', '女性'],
];
const OCCUPATIONS: [string, string][] = [
  ['1', '会社員'],
  ['2', '主婦・主夫'],
  ['3', 'フリーランス'],
  ['4', 'その他'],
];
const CHANNELS: [string, string][] = [
  ['1', 'クラウドワークス'],
  ['2', 'ランサーズ'],
  ['3', '直接契約'],
];
const CATEGORIES: [string, string][] = [
  ['1', 'ライティング'],
  ['2', 'デザイン'],
  ['3', 'システム開発'],
];
const JOB_DETAILS: [string, string][] = [
  ['1', '記事作成'],
  ['2', '校正・リライト'],
  ['3', '資料作成'],
];
const AI_TOOLS: [string, string][] = [
  ['1', 'ChatGPT'],
  ['2', 'Claude'],
  ['3', 'Gemini'],
  ['4', 'Canva AI'],
];
const AI_USAGES: [string, string][] = [
  ['1', '文章の下書き作成'],
  ['2', 'リサーチ・情報収集'],
  ['3', '校正・推敲'],
];
/** 実データにある「一番使ったAI」の表記ゆれ */
const MAIN_AI_RAW = [
  'ChatGPT',
  'chatGPT',
  'Chat GPT',
  'チャットGPT',
  'chat gpt',
  'Gemini',
  'gemini',
  'Claude',
  'claude',
  'canva ai',
];

/** 決定論的な擬似乱数（mulberry32）。fixture が毎回同じになるようにする */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EMPTY_PAIR: [string, string] = ['', ''];

/**
 * CrowdWorks 実CSV形式を模した CSV 文字列を作る。
 *
 * @param count 回答件数（既定 52 = 実ファイルと同じ件数）
 * @returns ヘッダー1行 + count 行の CSV
 */
export function makeCrowdWorksCsv(count = 52): string {
  const rand = makeRandom(20260902);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!;

  const lines = [csvRow(HEADERS)];

  for (let i = 0; i < count; i++) {
    const occupations = [pick(OCCUPATIONS), rand() < 0.35 ? pick(OCCUPATIONS) : EMPTY_PAIR];
    const channels = [pick(CHANNELS), rand() < 0.3 ? pick(CHANNELS) : EMPTY_PAIR];
    const details = [pick(JOB_DETAILS), rand() < 0.4 ? pick(JOB_DETAILS) : EMPTY_PAIR];
    const usages = [pick(AI_USAGES), rand() < 0.5 ? pick(AI_USAGES) : EMPTY_PAIR];
    // ChatGPT が最多になるよう、1つ目は高確率で ChatGPT にする
    const tools = [
      rand() < 0.8 ? AI_TOOLS[0]! : pick(AI_TOOLS),
      rand() < 0.5 ? pick(AI_TOOLS) : EMPTY_PAIR,
      rand() < 0.2 ? pick(AI_TOOLS) : EMPTY_PAIR,
    ];

    const answer: Answer = {
      workerId: `W-${String(i + 1).padStart(4, '0')}`,
      worker: `ダミー作業者${i + 1}`,
      workerUrl: `https://example.invalid/public/employees/${i + 1}`,
      approvedAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`,
      age: pick(AGES),
      gender: pick(GENDERS),
      occupation: [occupations[0]!, occupations[1]!],
      channel: [channels[0]!, channels[1]!],
      year: [String((i % 3) + 1), String(2023 + (i % 3))],
      month: [String((i % 12) + 1), `${(i % 12) + 1}月`],
      category: pick(CATEGORIES),
      jobDetail: [details[0]!, details[1]!],
      contract: rand() < 0.7 ? ['1', '固定報酬'] : ['2', '時間単価'],
      reward: pick([
        ['1', '5,000円以下'],
        ['2', '5,001～10,000円'],
        ['3', '10,001～30,000円'],
        ['4', '30,001円以上'],
      ] as [string, string][]),
      // 改行を含む自由入力（壊れないことを確認するため）
      workHours: i % 5 === 0 ? '約3時間\n（調査含む）' : `${(i % 8) + 1}時間`,
      aiTools: [tools[0]!, tools[1]!, tools[2]!],
      mainAi: MAIN_AI_RAW[i % MAIN_AI_RAW.length]!,
      aiUsage: [usages[0]!, usages[1]!],
      aiRatio: pick([
        ['1', '25%未満'],
        ['2', '25～50%'],
        ['3', '50～75%'],
        ['4', '75%以上'],
      ] as [string, string][]),
      humanEdit: pick([
        ['1', 'ほとんど修正していない'],
        ['2', '少し修正した'],
        ['3', '大幅に修正した'],
      ] as [string, string][]),
      withoutAi: pick([
        ['1', '受けなかった'],
        ['2', '受けたが時間がかかった'],
        ['3', '変わらず受けた'],
      ] as [string, string][]),
      clientRule: pick([
        ['1', 'AI利用禁止'],
        ['2', 'AI利用可'],
        ['3', 'ルールなし・不明'],
      ] as [string, string][]),
      disclosed: pick([
        ['1', '伝えた'],
        ['2', '伝えていない'],
      ] as [string, string][]),
      revisions: pick([
        ['1', '0回'],
        ['2', '1回'],
        ['3', '2回'],
      ] as [string, string][]),
      result: pick([
        ['1', '問題なく完了した'],
        ['2', '高評価だった'],
      ] as [string, string][]),
      repeat: pick([
        ['1', 'ぜひ受けたい'],
        ['2', '受けてもよい'],
      ] as [string, string][]),
      // 改行・カンマ・読点を含む自由記述（壊れないことを確認するため）
      comment:
        i % 4 === 0
          ? `AIのおかげで時短になった。\nただし事実確認は必須です、と感じました。`
          : i % 4 === 1
            ? '特になし'
            : '',
    };

    lines.push(csvRow(toCells(answer)));
  }

  return lines.join('\n');
}

/** fixture のヘッダー列数（正規化前） */
export const CROWDWORKS_FIXTURE_COLUMNS = HEADERS.length;

/** 管理列を除いた設問数（正規化後に期待される設問列数） */
export const CROWDWORKS_FIXTURE_QUESTIONS = 23;
