// ============================================================
// 常量定义
// ============================================================

/** 阶段 → 执行 Skill 的映射 */
export const STAGE_SKILL_MAP = {
  director: 'director-skill',
  art: 'art-design-skill',
  storyboard: 'seedance-storyboard-skill'
} as const

/** 阶段 → 审核 Skill 的映射 */
export const REVIEW_SKILL_MAP = {
  director: 'script-analysis-review-skill',
  art: 'art-direction-review-skill',
  storyboard: 'seedance-prompt-review-skill'
} as const

/** 阶段 → 角色声明 */
export const ROLE_DECLARATIONS = {
  director: `🎬 **切换到导演角色**
我现在是一名资深影视导演。我的核心任务是剧本分析与讲戏——像给演员讲戏一样，把脑海中的影像完整描述出来。我精通叙事结构、镜头语言、视觉叙事、节奏控制。`,

  art: `🎨 **切换到服化道设计师角色**
我现在是一名专业的影视美术设定师。我擅长将文字描述转化为精确的视觉设计。我的输出是中文叙事描述式提示词，直接输出完整提示词，不逐条解释设计理由。`,

  storyboard: `📐 **切换到分镜师角色**
我现在是一名专业的影视分镜师。我擅长将导演的视觉构想转化为可执行的视频脚本。我的核心能力是将导演的"讲戏"内容翻译为 Seedance 2.0 动态提示词。我的输出是中文叙事描述式提示词，含 @引用语法，直接输出完整提示词，不逐条解释设计理由。`
} as const

/** 阶段 → 产出文件名 */
export const STAGE_OUTPUT_FILES = {
  director: '01-director-analysis.md',
  art: null, // 写入 assets/ 目录
  storyboard: '02-seedance-prompts.md'
} as const

/** 审核防偏 — 对抗性立场提示 */
export const ANTIBIAS_PROMPT = `⚠️ 审核立场切换：我现在是严格的质控审核员。
我的目标是找出问题，而非确认通过。
假设产出中一定存在至少 2 个需要改进的地方，我的任务是找到它们。
评分起点为 7 分（基本合格但有改进空间），只有在逐项验证确实无问题后才上调至 8+。
不因为"看起来还行"而给 9-10 分。`

/** 最大重试次数 */
export const MAX_RETRY_COUNT = 3

/** 每集时长约束 */
export const DURATION_MIN = 90
export const DURATION_MAX = 120
export const SINGLE_PROMPT_MAX = 10

/** 视觉风格预设 — 来自 seedance-prompt-methodology.md [氛围与风格词汇] */
export const VISUAL_STYLES = [
  '电影感',
  '影片质感',
  '大片风格',
  '纪录片风格',
  '电影级质感，胶片颗粒，浅景深',
  '黑白水墨风格',
  '动漫风格',
  '超写实',
  '高饱和霓虹色调，冷暖对比'
] as const

/** 目标媒介预设 — 来自 seedance-prompt-methodology.md 及 examples */
export const TARGET_MEDIUMS = [
  '电影质感短剧',
  '广告片',
  '叙事短片',
  '产品展示视频'
] as const
