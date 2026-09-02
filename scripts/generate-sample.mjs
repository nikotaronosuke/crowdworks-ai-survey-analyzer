/**
 * sample/ 配下のサンプルアンケートデータを生成する。
 *
 * 特徴:
 *  - 擬似乱数は mulberry32（seed 固定）。何度実行しても内容は完全に同じになる。
 *  - 実在しそうな氏名・メールアドレス・電話番号などの個人情報は一切含まない。
 *  - 列名は実際のアンケートらしく "Q1. …" の接頭辞付きにしてある。
 *    これは registry.ts の findProfile が「部分一致 + 最長優先」で
 *    正しいプロファイルに解決できるかを兼ねてテストするため。
 *
 * 生成物:
 *   sample/sample-survey.csv        100件 / カンマ区切り / きれいなデータ
 *   sample/sample-survey-small.tsv   12件 / タブ区切り / TSV 読み込み確認用
 *   sample/sample-survey-messy.csv   30件 / 意図的に汚したデータ
 *
 * 依存は Node 標準の fs / path / url のみ。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const SAMPLE_DIR = path.join(ROOT_DIR, 'sample');

// ---------------------------------------------------------------------------
// 決定論的な擬似乱数
// ---------------------------------------------------------------------------

/**
 * mulberry32。32bit の seed から [0,1) の一様乱数を返す関数を作る。
 * seed を固定しているので生成結果は毎回まったく同じになる。
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 重み付きテーブル [[ラベル, 重み], …] から1つ選ぶ */
function weighted(rng, table) {
  const total = table.reduce((sum, entry) => sum + entry[1], 0);
  let r = rng() * total;
  for (const [label, w] of table) {
    r -= w;
    if (r <= 0) return label;
  }
  return table[table.length - 1][0];
}

/** 重み付きテーブルから重複なしで min〜max 個選ぶ（複数回答用） */
function pickSome(rng, table, min, max) {
  const n = min + Math.floor(rng() * (max - min + 1));
  const pool = table.map((entry) => [entry[0], entry[1]]);
  const out = [];
  while (out.length < n && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry[1], 0);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let k = 0; k < pool.length; k++) {
      r -= pool[k][1];
      if (r <= 0) {
        idx = k;
        break;
      }
    }
    out.push(pool[idx][0]);
    pool.splice(idx, 1);
  }
  return out;
}

/** 単純な等確率の1件選択 */
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** 確率 p で true */
function chance(rng, p) {
  return rng() < p;
}

// ---------------------------------------------------------------------------
// 列名（23項目）
//
// findProfile は normalizeHeader（小文字化・空白除去・記号除去）した上で
// エイリアスの部分一致を最長優先で採るため、
// 各設問には「取り違えない特徴語」が入るようにしてある。
// 例: Q12 は "使用したAI・AIツール"、Q13 は "一番使ったAI"、Q14 は "AIを何に"。
// ---------------------------------------------------------------------------

const HEADERS = [
  'Q1. 年齢を教えてください',
  'Q2. 性別を教えてください',
  'Q3. 現在の職種を教えてください',
  'Q4. この仕事を受注したサービス・経路を教えてください（複数回答可）',
  'Q5. その仕事を受注・開始した年を教えてください（西暦）',
  'Q6. その仕事を受注・開始した月を教えてください',
  'Q7. 仕事の主なカテゴリを教えてください',
  'Q8. 具体的に行った仕事内容を教えてください',
  'Q9. 契約・報酬の形式を教えてください',
  'Q10. この仕事で受け取った報酬額を教えてください',
  'Q11. 実際の作業時間を教えてください（合計）',
  'Q12. 使用したAI・AIツールを教えてください（複数回答可）',
  'Q13. その中で一番使ったAIを1つ教えてください',
  'Q14. AIを何に使いましたか（複数回答可）',
  'Q15. 仕事全体のうちAIが担った割合を教えてください',
  'Q16. AIの出力を人間がどれくらい修正しましたか',
  'Q17. もしAIがなければ、この仕事を受けましたか',
  'Q18. クライアント側のAI利用ルールはどうでしたか',
  'Q19. AI利用をクライアントに伝えましたか',
  'Q20. 修正依頼の回数を教えてください（0回を含む）',
  'Q21. その仕事の結果はどうなりましたか',
  'Q22. また同じような仕事を受けたいと思いますか',
  'Q23. 最後に、ご意見・ご感想がありましたらご自由にお書きください',
];

// ---------------------------------------------------------------------------
// 選択肢プール（重みは「それらしい分布」になるよう手で調整したもの）
// ---------------------------------------------------------------------------

const AGE = [
  ['10代', 2],
  ['20代', 15],
  ['30代', 28],
  ['40代', 30],
  ['50代', 17],
  ['60代', 7],
  ['70代以上', 1],
];

const GENDER = [
  ['女性', 56],
  ['男性', 38],
  ['その他', 2],
  ['回答しない', 4],
];

const OCCUPATION = [
  ['フリーランス', 26],
  ['会社員（副業として）', 22],
  ['主婦・主夫', 18],
  ['自営業', 12],
  ['パート・アルバイト', 9],
  ['学生', 6],
  ['会社員（本業として）', 5],
  ['無職・求職中', 2],
];

const CHANNEL = [
  ['クラウドワークス', 60],
  ['ランサーズ', 18],
  ['ココナラ', 12],
  ['直接契約', 8],
  ['知人からの紹介', 6],
  ['SNS経由', 5],
  ['その他のクラウドソーシング', 3],
];

const START_YEAR = [
  ['2023', 12],
  ['2024', 38],
  ['2025', 50],
];

const START_MONTH = [
  ['1月', 8],
  ['2月', 7],
  ['3月', 9],
  ['4月', 10],
  ['5月', 8],
  ['6月', 9],
  ['7月', 9],
  ['8月', 8],
  ['9月', 9],
  ['10月', 8],
  ['11月', 8],
  ['12月', 7],
];

const JOB_CATEGORY = [
  ['ライティング・記事作成', 40],
  ['データ入力・リスト作成', 16],
  ['翻訳', 12],
  ['資料作成', 11],
  ['動画編集', 10],
  ['画像・イラスト制作', 9],
  ['Web制作・コーディング', 8],
  ['プログラミング', 7],
  ['リサーチ・情報収集', 7],
  ['音声の文字起こし', 6],
  ['SNS運用代行', 5],
  ['カスタマーサポート', 3],
];

/** 自由記述（仕事内容）。個人・企業が特定できる情報は入れない */
const JOB_DETAIL = [
  'ECサイトの商品説明文を30本作成しました',
  '企業ブログ用の記事を構成案から執筆しました',
  '英語のマニュアルを日本語に翻訳しました',
  '動画の字幕とテロップ用テキストを作成しました',
  'アンケートの自由記述を分類して集計しました',
  'ランディングページのキャッチコピーを20案出しました',
  'セミナー録音の文字起こしと議事録化を行いました',
  '既存記事のリライトと見出しの調整を行いました',
  '社内マニュアルのたたき台を作成しました',
  'SNS投稿用の短文を50本作成しました',
  '表計算の集計マクロを作成しました',
  'バナー用のラフ画像を生成しました',
  '競合サービスの調査レポートをまとめました',
  'プレスリリースの下書きを作成しました',
  '求人原稿の作成と校正を行いました',
  '問い合わせ対応用のテンプレート文を整備しました',
];

const CONTRACT = [
  ['固定報酬制', 62],
  ['タスク形式', 16],
  ['時間単価制', 14],
  ['コンペ形式', 8],
];

const REWARD = [
  ['〜5,000円', 22],
  ['5,001〜10,000円', 24],
  ['10,001〜30,000円', 28],
  ['30,001〜50,000円', 13],
  ['50,001〜100,000円', 9],
  ['100,001円以上', 4],
];

const WORK_HOURS = [
  ['〜1時間', 9],
  ['1〜3時間', 24],
  ['3〜5時間', 23],
  ['5〜10時間', 22],
  ['10〜20時間', 14],
  ['20時間以上', 8],
];

const AI_TOOLS = [
  ['ChatGPT', 100],
  ['Gemini', 42],
  ['Claude', 34],
  ['Copilot', 18],
  ['NotebookLM', 10],
  ['Perplexity', 9],
  ['Canva AI', 8],
  ['Midjourney', 6],
  ['Stable Diffusion', 4],
  ['Felo', 3],
];

const AI_USAGE = [
  ['文章の下書き作成', 52],
  ['構成案・アウトライン作成', 34],
  ['リサーチ・情報収集', 33],
  ['要約', 24],
  ['校正・推敲', 23],
  ['アイデア出し', 22],
  ['翻訳', 16],
  ['キャッチコピー案の作成', 12],
  ['表・データの整理', 11],
  ['コード生成', 9],
  ['画像生成', 8],
  ['議事録の整理', 7],
  // 括弧内に読点を含む選択肢。splitter.ts が括弧の深さを見て
  // 分割しないことを確認するために、きれいなデータにも意図的に入れてある。
  ['その他（関数の作成、テスト項目の洗い出し）', 4],
];

const AI_RATIO = [
  ['0%', 2],
  ['1〜25%', 14],
  ['26〜50%', 26],
  ['51〜75%', 30],
  ['76〜99%', 22],
  ['100%', 6],
];

const HUMAN_EDIT = [
  ['ほとんど修正していない', 8],
  ['少し修正した', 30],
  ['半分程度修正した', 31],
  ['大幅に修正した', 22],
  ['ほぼ書き直した', 9],
];

const WITHOUT_AI = [
  ['受けなかった', 18],
  ['受けたが時間がかかった', 46],
  ['変わらず受けた', 28],
  ['わからない', 8],
];

const CLIENT_AI_RULE = [
  ['ルールなし・不明', 44],
  ['AI利用可', 26],
  ['AI利用に条件あり', 18],
  ['AI利用禁止', 12],
];

const DISCLOSED_AI = [
  ['伝えていない', 38],
  ['伝えた', 30],
  ['聞かれたら答えた', 24],
  ['わからない', 8],
];

const REVISION = [
  ['0回', 26],
  ['1回', 36],
  ['2回', 20],
  ['3回', 10],
  ['4回以上', 8],
];

const JOB_RESULT = [
  ['問題なく完了した', 52],
  ['高評価だった', 28],
  ['修正が多かった', 16],
  ['契約解除・不採用になった', 4],
];

const REPEAT_INTENT = [
  ['ぜひ受けたい', 30],
  ['受けてもよい', 42],
  ['どちらとも言えない', 16],
  ['あまり受けたくない', 8],
  ['受けたくない', 4],
];

/** 自由記述（感想）。"特になし" "なし" は有効回答として扱われることの確認も兼ねる */
const FREE_COMMENT = [
  'たたき台づくりが速くなり、納期に余裕が持てました',
  '思ったより修正に時間がかかりました',
  '事実確認は結局自分でやる必要があります',
  'AI利用の可否は最初に確認しておくと安心です',
  '単価が下がってきている気がして複雑です',
  '文章の型が単調になりやすいので手を入れています',
  '専門用語の誤りが多く、そのままでは使えませんでした',
  '作業時間は体感で半分くらいになりました',
  'クライアントに伝えたら好意的に受け止められました',
  '使い方を覚えるまでは逆に時間がかかりました',
  '下調べの時間が減った分、推敲に時間を回せました',
  '納品物の最終責任は自分にあると強く感じます',
  '特になし',
  'なし',
];

// ---------------------------------------------------------------------------
// 1件分の回答を作る
// ---------------------------------------------------------------------------

/** 選んだツールの中から「一番使ったAI」を重み付きで決める */
function pickMainAi(rng, tools) {
  const table = AI_TOOLS.filter((entry) => tools.includes(entry[0]));
  return weighted(rng, table.length > 0 ? table : AI_TOOLS);
}

/** 回答1件分の中間表現（複数回答は配列のまま持つ） */
function makeAnswer(rng) {
  const tools = pickSome(rng, AI_TOOLS, 1, 4);
  return {
    age: weighted(rng, AGE),
    gender: weighted(rng, GENDER),
    occupation: weighted(rng, OCCUPATION),
    channel: pickSome(rng, CHANNEL, 1, 2),
    startYear: weighted(rng, START_YEAR),
    startMonth: weighted(rng, START_MONTH),
    // 実CSVの Q7 は単一選択なので、サンプルも1つだけにする
    jobCategory: pickSome(rng, JOB_CATEGORY, 1, 1),
    jobDetail: pick(rng, JOB_DETAIL),
    contract: weighted(rng, CONTRACT),
    reward: weighted(rng, REWARD),
    workHours: weighted(rng, WORK_HOURS),
    aiTools: tools,
    mainAi: pickMainAi(rng, tools),
    aiUsage: pickSome(rng, AI_USAGE, 1, 4),
    aiRatio: weighted(rng, AI_RATIO),
    humanEdit: weighted(rng, HUMAN_EDIT),
    withoutAi: weighted(rng, WITHOUT_AI),
    clientRule: weighted(rng, CLIENT_AI_RULE),
    disclosed: weighted(rng, DISCLOSED_AI),
    revision: weighted(rng, REVISION),
    jobResult: weighted(rng, JOB_RESULT),
    repeatIntent: weighted(rng, REPEAT_INTENT),
    // 自由記述は 3 割ほど未記入（現実のアンケートに近づける）
    comment: chance(rng, 0.7) ? pick(rng, FREE_COMMENT) : '',
  };
}

/** 中間表現を「きれいな」1行（23セル）にする。複数回答は読点で連結 */
function renderClean(a) {
  return [
    a.age,
    a.gender,
    a.occupation,
    a.channel.join('、'),
    a.startYear,
    a.startMonth,
    a.jobCategory.join('、'),
    a.jobDetail,
    a.contract,
    a.reward,
    a.workHours,
    a.aiTools.join('、'),
    a.mainAi,
    a.aiUsage.join('、'),
    a.aiRatio,
    a.humanEdit,
    a.withoutAi,
    a.clientRule,
    a.disclosed,
    a.revision,
    a.jobResult,
    a.repeatIntent,
    a.comment,
  ];
}

// ---------------------------------------------------------------------------
// 汚しデータ用の変換
// ---------------------------------------------------------------------------

/** 行ごとに変える複数回答の区切り（改行 / 読点 / 半角カンマ） */
const MESSY_JOINERS = ['\n', '、', ','];

/** AIツール名の表記ゆれ。optionAliases で吸収できることの確認用 */
const TOOL_VARIANTS = {
  ChatGPT: ['ChatGPT', 'chatgpt', 'Chat GPT', 'ＣｈａｔＧＰＴ'],
  Gemini: ['Gemini', 'gemini', 'ジェミニ', 'Gemini'],
  Claude: ['Claude', 'claude', 'クロード', 'Claude'],
  Copilot: ['Copilot', 'copilot', 'GitHub Copilot', 'Copilot'],
};

/** ツール名を行番号に応じて表記ゆれさせる */
function messyTool(name, i) {
  const variants = TOOL_VARIANTS[name];
  return variants ? variants[i % variants.length] : name;
}

/** 報酬の表記ゆれ。'30,000円' '3万円' '30000' が必ず現れるようにしてある */
const REWARD_AMOUNTS = [3000, 5000, 8000, 12000, 15000, 20000, 30000, 35000, 50000, 55000, 80000, 120000];

function messyReward(i, rng) {
  const n = pick(rng, REWARD_AMOUNTS);
  // 桁区切り・漢数字・素の数値を必ず1件ずつ含める
  if (i === 0) return '30,000円';
  if (i === 1) return '3万円';
  if (i === 2) return '30000';
  if (i === 5) return ''; // 空セル
  if (i === 10) return '　'; // 全角空白だけのセル
  switch (i % 5) {
    case 0:
      return `${n.toLocaleString('en-US')}円`;
    case 1: {
      if (n % 10000 === 0) return `${n / 10000}万円`;
      if (n > 10000) return `${Math.floor(n / 10000)}万${n % 10000}円`;
      return `${n}円`;
    }
    case 2:
      return String(n);
    case 3:
      return `約${n.toLocaleString('en-US')}円`;
    default:
      return `${n}円`;
  }
}

/**
 * 中間表現を「意図的に汚した」1行にする。
 * 汚し方は行番号から決まるので、生成結果は決定論的。
 */
function renderMessy(a, i, rng) {
  const joiner = MESSY_JOINERS[i % MESSY_JOINERS.length];

  const tools = a.aiTools.map((t) => messyTool(t, i));
  const usage = a.aiUsage.slice();
  // 括弧の中に読点／半角カンマを含む選択肢（splitter の括弧判定を壊しにいく）
  if (i === 4) usage.push('その他（画像生成、動画編集）');
  if (i === 9) usage.push('その他（記事作成, 校正）');

  let occupation = a.occupation;
  if (i === 2) occupation = `　${a.occupation}　`; // 前後に全角空白
  if (i === 15) occupation = 'ﾌﾘｰﾗﾝｽ'; // 半角カナ（NFKC で吸収されるはず）

  const row = [
    a.age,
    i === 3 ? '' : a.gender, // 空セル
    occupation,
    a.channel.join(joiner),
    i === 7 ? '24' : i === 12 ? '2025年' : a.startYear, // 2桁年・"年"付き
    i === 7 ? '3' : i === 12 ? '03月' : a.startMonth, // "月"なし・ゼロ埋め
    i === 6 ? '　' : a.jobCategory.join(joiner), // 全角空白だけのセル
    a.jobDetail,
    a.contract,
    messyReward(i, rng),
    i === 8 ? '' : a.workHours, // 空セル
    tools.join(joiner),
    messyTool(a.mainAi, i),
    usage.join(joiner),
    i === 19 ? '' : a.aiRatio, // 空セル
    a.humanEdit,
    a.withoutAi,
    a.clientRule,
    i === 13 ? '' : a.disclosed, // 空セル
    a.revision,
    a.jobResult,
    a.repeatIntent,
    i === 11 ? `　${a.comment}　` : a.comment,
  ];

  // 列数が足りない行を1行だけ混ぜる（parse.ts が "" で埋めて警告を出すはず）
  if (i === 17) return row.slice(0, 15);
  return row;
}

// ---------------------------------------------------------------------------
// CSV / TSV 書き出し
// ---------------------------------------------------------------------------

/** RFC4180 準拠のエスケープ。区切り・改行・二重引用符を含むならクォートする */
function escapeCell(value, delimiter) {
  const s = value === undefined || value === null ? '' : String(value);
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * ヘッダー + 行を1つの文字列にする。
 * trailingBlankLine=true のときは末尾に空行を1つ足す。
 */
function serialize(headers, rows, delimiter, trailingBlankLine = false) {
  const lines = [headers.map((h) => escapeCell(h, delimiter)).join(delimiter)];
  for (const row of rows) {
    lines.push(row.map((c) => escapeCell(c, delimiter)).join(delimiter));
  }
  let out = `${lines.join('\n')}\n`;
  if (trailingBlankLine) out += '\n';
  return out;
}

/** UTF-8（BOM なし）で書き出し、行数を返す */
function writeSample(fileName, content, recordCount) {
  const filePath = path.join(SAMPLE_DIR, fileName);
  fs.writeFileSync(filePath, content, 'utf8');
  const physicalLines = (content.match(/\n/g) ?? []).length;
  return { filePath, physicalLines, recordCount };
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

fs.mkdirSync(SAMPLE_DIR, { recursive: true });

// 3ファイルそれぞれ独立した seed を使う（1つを変えても他が変わらないように）
const cleanRng = mulberry32(20240117);
const smallRng = mulberry32(881903);
const messyRng = mulberry32(4242424);

// --- 1. きれいな 100件 CSV -------------------------------------------------
const cleanRows = [];
for (let i = 0; i < 100; i++) {
  cleanRows.push(renderClean(makeAnswer(cleanRng)));
}
const cleanResult = writeSample(
  'sample-survey.csv',
  serialize(HEADERS, cleanRows, ','),
  cleanRows.length,
);

// --- 2. 12件 TSV -----------------------------------------------------------
// タブ区切りなので、セル内にタブと改行が入らないよう複数回答は読点で連結する。
const smallRows = [];
for (let i = 0; i < 12; i++) {
  smallRows.push(renderClean(makeAnswer(smallRng)));
}
const smallResult = writeSample(
  'sample-survey-small.tsv',
  serialize(HEADERS, smallRows, '\t'),
  smallRows.length,
);

// --- 3. 汚れた 30件 CSV ----------------------------------------------------
const messyRows = [];
for (let i = 0; i < 30; i++) {
  messyRows.push(renderMessy(makeAnswer(messyRng), i, messyRng));
}
const messyResult = writeSample(
  'sample-survey-messy.csv',
  serialize(HEADERS, messyRows, ',', true),
  messyRows.length,
);

// ---------------------------------------------------------------------------
// 結果表示
// ---------------------------------------------------------------------------

console.log('\n[generate-sample] サンプルデータを生成しました（seed 固定・毎回同じ内容）。');
for (const r of [cleanResult, smallResult, messyResult]) {
  console.log(
    `  ${path.relative(ROOT_DIR, r.filePath).replace(/\\/g, '/')} : ` +
      `${r.physicalLines}行（ヘッダー1行 + 回答${r.recordCount}件）`,
  );
}
console.log('  ※ 個人情報（氏名・メールアドレス・電話番号など）は含まれていません。\n');
