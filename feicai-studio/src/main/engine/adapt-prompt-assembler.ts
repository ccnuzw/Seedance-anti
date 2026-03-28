// ============================================================
// Adapt Prompt Assembler — 编剧管线 Prompt 组装器
// ============================================================
//
// 区别于现有 PromptAssembler（面向导演/服化道/分镜），
// 此组装器专为编剧管线（breakdown/script）设计。
//
// 组装顺序遵循 "高优先级内容靠近生成" 原则：
//
// System:
//   1. 角色声明
//   2. adapt-method.md（改编方法论）
//   3. output-style.md（写作风格）
//   4. 示例
//   5. 输出模板
//
// User:
//   6. 项目/小说信息
//   7. 已有 plot-breakdown（拆解上下文）
//   8. 小说原文（6章）         ← 离 LLM 生成最近
//   9. 执行指令
//  10. 审核反馈（重试时注入）

import type { Skill, AssembledPrompt, AdaptStage, VolumePlan } from '@shared/types'

export interface AdaptUpstreamInputs {
  /** 小说原文（多章） */
  novelChapters?: Array<{ chapter: number; content: string }>
  /** 已有剧情拆解内容 */
  plotBreakdown?: string
  /** 上一集剧本（确保连贯） */
  previousScript?: string
  /** 当前批次对应的剧情点描述 */
  plotPointsForBatch?: string
}

export interface AdaptProjectContext {
  novelTitle: string
  novelGenre: string
  totalChapters: number
  processedChapters: number
  currentBatch: number
}

export class AdaptPromptAssembler {
  private extractLatestPlanSection(plotBreakdown: string): string {
    const matches = [...plotBreakdown.matchAll(/##\s*(?:改编规划|改编方向|改编策略|改编计划|Adaptation Plan)\s*\n[\s\S]*?(?=\n##\s*第|\n#\s*第|\n---\n|$)/gim)]
    return matches.length > 0 ? matches[matches.length - 1][0].trim() : ''
  }

  private stripPlanSections(plotBreakdown: string): string {
    return plotBreakdown
      .replace(/##\s*(?:改编规划|改编方向|改编策略|改编计划|Adaptation Plan)\s*\n[\s\S]*?(?=\n##\s*第|\n#\s*第|\n---\n|$)/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /**
   * 组装拆解 (breakdown) 的 Prompt
   */
  assembleBreakdown(
    skill: Skill,
    roleDeclaration: string,
    inputs: AdaptUpstreamInputs,
    projectContext: AdaptProjectContext,
    reviewFeedback?: string,
    volumePlan?: VolumePlan | null,
    userNotes?: string
  ): AssembledPrompt {
    const systemParts: string[] = []
    const userParts: string[] = []

    // ============ System ============

    // 1. 角色声明
    systemParts.push(roleDeclaration)

    // 2. 改编方法论（adapt-method.md）
    if (skill.methodology) {
      systemParts.push(`\n---\n\n# 改编方法论\n\n${skill.methodology}`)
    }

    // 3. 核心规范（SKILL.md body）
    systemParts.push(`\n---\n\n# 技能规范\n\n${skill.systemPrompt}`)

    // 4. 写作风格（output-style.md）
    if (skill.guides?.['output-style']) {
      systemParts.push(`\n---\n\n# 写作风格\n\n${skill.guides['output-style']}`)
    }

    // 5. 拆解示例
    if (skill.examples?.['plot-breakdown-example']) {
      systemParts.push(`\n---\n\n# 拆解示例\n\n${skill.examples['plot-breakdown-example']}`)
    }

    // 6. 拆解模板
    if (skill.templates?.['plot-breakdown-template']) {
      systemParts.push(`\n---\n\n# 输出格式模板\n\n请严格按照以下模板格式输出：\n\n${skill.templates['plot-breakdown-template']}`)
    }

    // ============ User ============

    // 7. 项目/小说信息
    userParts.push([
      `# 小说信息`,
      ``,
      `- 小说名称：《${projectContext.novelTitle}》`,
      `- 小说类型：${projectContext.novelGenre}`,
      `- 总章节：${projectContext.totalChapters} 章`,
      `- 已拆解：${projectContext.processedChapters} 章`,
      `- 当前批次：第 ${projectContext.currentBatch} 批`
    ].join('\n'))

    // 8. 已有拆解内容（上下文参考）
    let extractedPlan = ''
    if (inputs.plotBreakdown) {
      extractedPlan = this.extractLatestPlanSection(inputs.plotBreakdown)
      const sanitizedBreakdown = this.stripPlanSections(inputs.plotBreakdown)
      userParts.push(`\n---\n\n# 已有剧情拆解（上下文参考，确保编号连续、集数不冲突）\n\n${sanitizedBreakdown}`)
    }

    // 8.5. 用户指导笔记（最高优先级）
    if (userNotes) {
      userParts.push(
        `\n---\n\n# 📝 用户指导笔记（必须严格遵守，优先级最高）\n\n${userNotes}`
      )
    }

    // 9. 全卷改编规划大纲与节奏指导（核心骨架）
    if (volumePlan && (volumePlan.chapterAllocation || volumePlan.additionalNotes || volumePlan.llmPlan)) {
      const planParts = []
      if (volumePlan.llmPlan) planParts.push(`【全局改编大纲】：\n${volumePlan.llmPlan}`)
      if (volumePlan.chapterAllocation) planParts.push(`【章集分配原则】：\n${volumePlan.chapterAllocation}`)
      if (volumePlan.additionalNotes) planParts.push(`【其他特殊要求】：\n${volumePlan.additionalNotes}`)
      userParts.push(
        `\n---\n\n# 🗺️ 顶层改编规划与战略大纲（拆解时必须严格贯彻，不可偏离）\n\n` +
        `在进行本批次的拆解时，必须要时刻参照以下全卷宏观规划，决定当前章节中哪些应该着重保留，哪些属于注水应被抛弃，以确保全卷节奏的连贯度：\n\n` +
        planParts.join('\n\n')
      )
    } else if (extractedPlan) {
      userParts.push(
        `\n---\n\n# 🗺️ 顶层改编规划与战略大纲（拆解时必须严格贯彻，不可偏离）\n\n` +
        `在进行本批次的拆解时，必须要时刻参照以下全卷宏观规划大纲。所有提取的剧情点、爽点反馈、以及集数分配都必须与该规划强一致，不得任性发挥：\n\n` +
        extractedPlan
      )
    }

    // 10. 小说原文（核心输入）
    if (inputs.novelChapters && inputs.novelChapters.length > 0) {
      const chapterTexts = inputs.novelChapters
        .map(ch => `## 第${ch.chapter}章\n\n${ch.content}`)
        .join('\n\n---\n\n')
      userParts.push(`\n---\n\n# 本批次小说原文（请逐章阅读后拆解）\n\n${chapterTexts}`)
    }

    // 11. 执行指令（从 volumePlan 动态读取参数）
    let plotRange = '3-4'
    let wordRange = '1500-2000'
    let rangeRule = `- 每集 ${plotRange} 个剧情点，${wordRange} 字\n`
    
    if (volumePlan) {
      plotRange = `${volumePlan.plotsPerEpisode[0]}-${volumePlan.plotsPerEpisode[1]}`
      wordRange = `${volumePlan.episodeWordCount[0]}-${volumePlan.episodeWordCount[1]}`
      rangeRule = `- 每集 ${plotRange} 个剧情点，${wordRange} 字\n`
    } else if (extractedPlan) {
      rangeRule = `- 💡 智能自适应参数：请根据以上的《改编规划》中设定的切割方案灵活决定每集提取几个核心剧情点（通常 4-8 个），**不必**拘泥于固定的数量或死板字数限制。\n`
    }

    userParts.push(
      `\n---\n\n❗执行指令：请阅读以上 ${inputs.novelChapters?.length || 6} 章小说原文，按照改编方法论和拆解模板格式，提取核心冲突和情绪钩子（≥7分才提取），生成剧情点列表并标注分集。\n\n` +
      `要求：\n` +
      `- 编号必须紧接已有剧情点（如已有到【剧情30】则从【剧情31】开始）\n` +
      `- 集数必须紧接已有集数\n` +
      rangeRule +
      `- 状态默认为"未用"\n` +
      `- 输出格式：### 第X批（第X-X章）然后【剧情n】...`
    )

    // 11. 审核反馈
    if (reviewFeedback) {
      userParts.push(
        `\n---\n\n# ⚠️ 上次拆解质检未通过，请根据以下反馈修改\n\n${reviewFeedback}\n\n请着重改进上述问题，重新生成完整的拆解输出。`
      )
    }

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n')
    }
  }

  /**
   * 组装剧本创作 (script) 的 Prompt
   */
  assembleScript(
    skill: Skill,
    roleDeclaration: string,
    inputs: AdaptUpstreamInputs,
    projectContext: AdaptProjectContext,
    targetEpisodes: number[],
    reviewFeedback?: string,
    volumePlan?: VolumePlan | null,
    userNotes?: string
  ): AssembledPrompt {
    const systemParts: string[] = []
    const userParts: string[] = []

    // ============ System ============

    // 1. 角色声明
    systemParts.push(roleDeclaration)

    // 2. 改编方法论
    if (skill.methodology) {
      systemParts.push(`\n---\n\n# 改编方法论\n\n${skill.methodology}`)
    }

    // 3. 核心规范
    systemParts.push(`\n---\n\n# 技能规范\n\n${skill.systemPrompt}`)

    // 4. 写作风格
    if (skill.guides?.['output-style']) {
      systemParts.push(`\n---\n\n# 视觉化快节奏写作风格\n\n${skill.guides['output-style']}`)
    }

    // 5. 剧本示例
    if (skill.examples?.['script-example']) {
      systemParts.push(`\n---\n\n# 剧本格式示例\n\n${skill.examples['script-example']}`)
    }

    // 6. 剧本模板
    if (skill.templates?.['script-template']) {
      systemParts.push(`\n---\n\n# 输出格式模板\n\n请严格按照以下模板格式输出：\n\n${skill.templates['script-template']}`)
    }

    // ============ User ============

    // 7. 项目信息
    userParts.push([
      `# 小说信息`,
      ``,
      `- 小说名称：《${projectContext.novelTitle}》`,
      `- 小说类型：${projectContext.novelGenre}`,
      `- 本次创作集数：第 ${targetEpisodes.join('、')} 集`
    ].join('\n'))

    // 8. 剧情点
    if (inputs.plotPointsForBatch) {
      userParts.push(`\n---\n\n# 本批次剧情点（基于这些剧情点创作剧本）\n\n${inputs.plotPointsForBatch}`)
    }

    // 9. 上一集剧本（确保连贯）
    if (inputs.previousScript) {
      userParts.push(`\n---\n\n# 上一集剧本（参考以确保连贯）\n\n${inputs.previousScript}`)
    }

    // 9.5. 用户指导笔记（最高优先级）
    if (userNotes) {
      userParts.push(
        `\n---\n\n# 📝 用户指导笔记（必须严格遵守，优先级最高）\n\n${userNotes}`
      )
    }

    // 10. 全卷改编规划大纲与节奏指导（核心骨架）
    let extractedPlan = ''
    if (inputs.plotBreakdown) {
      extractedPlan = this.extractLatestPlanSection(inputs.plotBreakdown)
    }

    if (volumePlan && (volumePlan.chapterAllocation || volumePlan.additionalNotes || volumePlan.llmPlan)) {
      const planParts = []
      if (volumePlan.llmPlan) planParts.push(`【全局改编大纲】：\n${volumePlan.llmPlan}`)
      if (volumePlan.chapterAllocation) planParts.push(`【章集分配原则】：\n${volumePlan.chapterAllocation}`)
      if (volumePlan.additionalNotes) planParts.push(`【其他特殊要求】：\n${volumePlan.additionalNotes}`)
      userParts.push(
        `\n---\n\n# 🗺️ 顶层改编规划与战略大纲（创作必然要参考的核心航标）\n\n` +
        `在创作这几集剧本时，你需要让故事走向、铺垫和打脸的爽点分布符合以下总体规划的要求（若本批次拆解与规划有冲突以规划纲要的节奏为准）：\n\n` +
        planParts.join('\n\n')
      )
    } else if (extractedPlan) {
      userParts.push(
        `\n---\n\n# 🗺️ 顶层改编规划与战略大纲（创作必然要参考的核心航标）\n\n` +
        `在创作这几集剧本时，你需要让故事走向、铺垫和打脸的爽点分布符合以下总体规划的要求（若本批次拆解与规划有冲突以规划纲要的节奏为准）：\n\n` +
        extractedPlan
      )
    }

    // 11. 小说原文
    if (inputs.novelChapters && inputs.novelChapters.length > 0) {
      const chapterTexts = inputs.novelChapters
        .map(ch => `## 第${ch.chapter}章\n\n${ch.content}`)
        .join('\n\n---\n\n')
      userParts.push(`\n---\n\n# 对应章节小说原文（创作参考）\n\n${chapterTexts}`)
    }

    // 12. 执行指令（从 volumePlan 动态读取参数）
    let wordRange = '1500-2000'
    let sceneRange = '3-4'
    let seedanceRange = '9-12'
    let rangeRule = `- 每集 ${wordRange} 字，${sceneRange} 个场景，${seedanceRange} 个 Seedance 段\n`

    if (volumePlan) {
      wordRange = `${volumePlan.episodeWordCount[0]}-${volumePlan.episodeWordCount[1]}`
      sceneRange = `${volumePlan.scenesPerEpisode[0]}-${volumePlan.scenesPerEpisode[1]}`
      seedanceRange = `${volumePlan.seedancePerEpisode[0]}-${volumePlan.seedancePerEpisode[1]}`
      rangeRule = `- 每集 ${wordRange} 字，${sceneRange} 个场景，${seedanceRange} 个 Seedance 段\n`
    } else if (extractedPlan) {
       rangeRule = `- 💡 智能自适应参数：不要拘泥于固定死板的字数和场景数，请根据《改编规划》的纲要充分燃烧情绪与爽点！\n`
    }

    const epList = targetEpisodes.map(e => `第${e}集`).join('、')
    userParts.push(
      `\n---\n\n❗执行指令：请基于以上剧情点和小说原文，创作 ${epList} 的完整剧本。\n\n` +
      `要求：\n` +
      rangeRule +
      `- 使用视觉描述符号：※场景、△动作、【特效】【音效】【系统面板】【独白】【闪回】\n` +
      `- 对话不超过 20 字/句\n` +
      `- 每集必须以【卡黑】结尾\n` +
      `- 节奏公式：起承转钩\n` +
      `- 每集输出为独立的 markdown 文件内容，以 # 第N集：标题 开头`
    )

    // 12. 审核反馈
    if (reviewFeedback) {
      userParts.push(
        `\n---\n\n# ⚠️ 上次剧本质检未通过，请根据以下反馈修改\n\n${reviewFeedback}\n\n请着重改进上述问题，重新生成完整剧本。`
      )
    }

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n')
    }
  }

  /**
   * 组装拆解质检 (breakdown review) 的 Prompt
   * [DA-1] 完整 8 维度子项 + 基准引用
   */
  assembleBreakdownReview(
    antibiasPrompt: string,
    breakdownOutput: string,
    novelChaptersText: string,
    adaptMethodContent: string,
    globalPlan?: string
  ): AssembledPrompt {
    const BREAKDOWN_REVIEW_CHECKLIST = `
# 拆解质检清单（8维度 · breakdown-aligner）

> ⚠️ 你必须逐条对比小说原文和拆解内容，不可凭记忆判断。

**【维度1】冲突强度评估**
- ⭐⭐⭐核心冲突是否真的改变主角命运/大幅改变格局
- 是否把⭐⭐次级冲突或⭐过渡冲突误标为核心冲突
- 冲突类型标注是否准确（人物对立/力量对比/身份矛盾/情感纠葛/生存危机/真相悬念）
- 基准：adapt-method.md → 三、冲突点识别与提取

**【维度2】情绪钩子识别准确性**
- 钩子类型是否准确（打脸/碾压/金手指/虐心/真相揭露等）
- 强度评分是否合理（10分=卧槽，8-9分=爽/虐/急，7分=保留门槛，＜7分不提取）
- 是否遗漏了原文中的高强度钩子
- 是否把低强度误标为高强度
- 基准：adapt-method.md → 四、情绪钩子提取与标注

**【维度3】冲突密度达标性**
- 核心冲突（⭐⭐⭐）数量：高密度≥5个✓ / 中密度2-4个✓ / 低密度0-1个✗
- 高强度钩子（10-8分）数量：高密度6-8个✓ / 中密度3-5个✓ / 低密度1-2个✗
- 密度不足时需判断是原文确实没有，还是拆解遗漏
- 基准：adapt-method.md → 三+四

**【维度4】分集标注合理性**
- 如果存在项目《改编规划》，集数容量（几章为1集）必须完全服从规划设定的节奏！
- 如果没有特殊强调，依据内容密度灵活决定（通常4-8个剧情点一集）。
- 巅峰钩子（10-9分）2-3个/集；核心钩子（8-7分）3-4个/集
- 基准：adapt-method.md → 五、剧情拆解与分集标注

**【维度5】压缩策略正确性**
- 必删内容：环境描写、心理独白、过渡情节、无关支线、重复内容
- 必留内容：冲突对话、动作场景、情绪爆点、悬念设置、关系展示
- 5种压缩策略正确运用：冲突合并法/时间跳跃法/信息前置法/删繁就简法/支线取舍法
- 基准：adapt-method.md → 五 → 压缩策略（通用）

**【维度6】剧情点描述规范性**
- 格式：【剧情n】[场景]，[事件描述]，[情绪钩子类型]，第X集，状态：未用
- 场景明确、角色明确、事件具体、钩子类型标注、集数标注、状态标记
- 编号连续，字段完整

**【维度7】原文还原准确性** ⭐关键维度
- **必须对比小说原文**，验证拆解是否准确反映原文
- 是否遗漏关键冲突和爆点
- 是否曲解原文（把A理解成B）
- 角色关系、事件因果是否与原文一致
- 是否过度脑补原文中没有的内容
- 关键台词、数值等细节是否与原文一致

**【维度8】类型特性符合度**
- 根据小说类型检查类型专属要求
- 是否删除了该类型的必删内容，强化了必强化内容
- 基准：adapt-method.md → 九、类型化适配策略

**判定**：8维全过 → ✅ PASS；任一不过 → ❌ FAIL → 列出问题清单
**输出格式**：每个维度给出 ✓/✗ + 具体评价，最终给出总评分（1-10）和结论：PASS 或 FAIL
`

    return {
      system: [
        antibiasPrompt,
        `\n---\n\n# 质检方法论参考\n\n${adaptMethodContent}`
      ].join('\n\n'),
      user: [
        `# 待审核的剧情拆解\n\n${breakdownOutput}`,
        `\n---\n\n# 对应章节小说原文（必须逐条对比）\n\n${novelChaptersText}`,
        globalPlan ? `\n---\n\n# 🗺️ 项目顶层改编规划（必须验证拆解结果是否符合该战略定调与集数节奏控制！）\n\n${globalPlan}` : '',
        `\n---\n\n${BREAKDOWN_REVIEW_CHECKLIST}`
      ].filter(Boolean).join('\n\n')
    }
  }

  /**
   * 组装剧本质检 (script review) 的 Prompt
   * [DA-1] 完整 11 维度子项
   * [DA-2] system 注入 adapt-method
   * [DA-3] 新增 previousScript 参数
   * [DA-5] 第20集特殊检查
   */
  assembleScriptReview(
    antibiasPrompt: string,
    scriptOutput: string,
    plotBreakdown: string,
    novelChaptersText: string,
    adaptMethodContent?: string,
    previousScript?: string,
    targetEpisodes?: number[],
    globalPlan?: string
  ): AssembledPrompt {
    const SCRIPT_REVIEW_CHECKLIST = `
# 剧本质检清单（11维度 · webtoon-aligner）

**【维度1】剧情点还原一致性**
- 是否按 plot-breakdown 分配的剧情点创作
- 剧情点核心事件是否完整呈现

**【维度2】剧情点使用一致性**
- 编号正确、无用错/重复使用
- 使用的剧情点编号与 plot-breakdown 对应

**【维度3】跨集连贯性**（非首集）
- 接续上集悬念、人物状态连续
- 时间/空间/情节逻辑衔接

**【维度4】节奏控制一致性**
- 如果存在顶层《改编规划》，剧本容量、爆点频率和节奏分配必须优先服从战略节奏！
- （若无全局规划限制）参考标准：每集1500-2000字，3-4个场景，9-12个Seedance段
- 25-40条△动作描写
- 15-25句台词
- 起承转钩结构

**【维度5】视觉化风格一致性**
- ※△【】符号正确使用
- 对话≤20字/句
- 无过多心理描写（应转化为动作/表情）

**【维度6】人物行为一致性**
- 性格/能力/对话风格前后统一
- 不出现"性格突变"

**【维度7】时间线逻辑一致性**
- 事件顺序合理
- 时间跨度/位置移动合理

**【维度8】格式规范一致性**
- 符合 script-template.md 格式
- 场景标记、特效标记等完整

**【维度9】悬念设置一致性**
- 每集结尾必须有【卡黑】
- 悬念强度足够

**【维度10】类型特性一致性**
- 符合小说类型专属要求

**【维度11】改编禁忌检查**
- 无节奏禁忌（拖沓/跳跃过大）
- 无内容禁忌（过度暴力等）
- 无结构禁忌（场景过多/过少）
- 无改编禁忌（脱离原作）
- 无视觉禁忌（无法可视化的描写）

**判定**：11维全过 → ✅ PASS；任一不过 → ❌ FAIL → 列出问题清单
**输出格式**：每个维度给出 ✓/✗ + 具体评价，最终给出总评分（1-10）和结论：PASS 或 FAIL
`

    // [DA-5] 第20集特殊检查
    const ep20Check = targetEpisodes?.includes(20)
      ? `\n\n> ⚠️ **特殊集数重点检查**：第20集为付费节点——结尾悬念必须达到顶级强度，【卡黑】必须让读者产生强烈的"必须付费看下去"冲动。`
      : ''

    // [DA-2] system 注入 adapt-method
    const systemParts = [antibiasPrompt]
    if (adaptMethodContent) {
      systemParts.push(`\n---\n\n# 质检方法论参考\n\n${adaptMethodContent}`)
    }

    const userParts = [
      `# 待审核的剧本\n\n${scriptOutput}`,
      `\n---\n\n# 剧情拆解（对照用）\n\n${plotBreakdown}`,
      globalPlan ? `\n---\n\n# 🗺️ 项目顶层改编规划（质检必须严查剧本是否兑现了这些核心卖点、冲突与节奏设定！）\n\n${globalPlan}` : '',
      `\n---\n\n# 对应章节小说原文（对照用）\n\n${novelChaptersText}`
    ].filter(Boolean)

    // [DA-3] 上一集剧本（跨集连贯性）
    if (previousScript) {
      userParts.push(`\n---\n\n# 上一集剧本（跨集连贯性对照）\n\n${previousScript}`)
    }

    userParts.push(`\n---\n\n${SCRIPT_REVIEW_CHECKLIST}${ep20Check}`)

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n')
    }
  }

  /**
   * 组装拆解修订 (breakdown repair) 的 Prompt
   * 用于在质检 FAIL 后，根据问题清单进行有约束的自修
   */
  assembleBreakdownRepair(
    skill: Skill,
    roleDeclaration: string,
    breakdownOutput: string,
    novelChaptersText: string,
    reviewFeedback: string,
    projectContext: AdaptProjectContext,
    volumePlan?: VolumePlan | null,
    userNotes?: string
  ): AssembledPrompt {
    const systemParts: string[] = []
    const userParts: string[] = []

    // 1. 角色 + 方法论 + 规范
    systemParts.push(roleDeclaration)
    if (skill.methodology) {
      systemParts.push(`\n---\n\n# 改编方法论\n\n${skill.methodology}`)
    }
    systemParts.push(`\n---\n\n# 技能规范\n\n${skill.systemPrompt}`)
    if (skill.guides?.['output-style']) {
      systemParts.push(`\n---\n\n# 写作风格\n\n${skill.guides['output-style']}`)
    }

    // 2. 项目信息
    userParts.push([
      `# 小说信息`,
      ``,
      `- 小说名称：《${projectContext.novelTitle}》`,
      `- 小说类型：${projectContext.novelGenre}`,
      `- 总章节：${projectContext.totalChapters} 章`,
      `- 已拆解：${projectContext.processedChapters} 章`,
      `- 当前批次：第 ${projectContext.currentBatch} 批`
    ].join('\n'))

    // 3. 用户指导笔记
    if (userNotes) {
      userParts.push(`\n---\n\n# 📝 用户指导笔记（必须严格遵守，优先级最高）\n\n${userNotes}`)
    }

    // 4. 上一轮拆解输出
    userParts.push(`\n---\n\n# 上一轮拆解输出（待修订）\n\n${breakdownOutput}`)

    // 5. 对应章节原文
    userParts.push(`\n---\n\n# 对应章节小说原文（请逐条对比修订）\n\n${novelChaptersText}`)

    // 6. 质检问题反馈
    userParts.push(
      `\n---\n\n# 上一轮质检问题反馈（必须全部解决）\n\n${reviewFeedback}`
    )

    // 7. 修订指令
    const wordRange = volumePlan ? `${volumePlan.episodeWordCount[0]}-${volumePlan.episodeWordCount[1]}` : '1500-2000'
    const plotRange = volumePlan ? `${volumePlan.plotsPerEpisode[0]}-${volumePlan.plotsPerEpisode[1]}` : '3-4'
    userParts.push(
      `\n---\n\n❗修订指令：在尽量保留上一版拆解中已正确的结构和编号的前提下，仅针对质检反馈指出的问题进行精确修订。\n\n` +
      `要求：\n` +
      `- 必须逐条解决反馈中提到的所有问题，不得遗漏\n` +
      `- 不能随意丢弃已有的高质量剧情点，只在必要时合并或重写\n` +
      `- 保持编号连续性和分集规划稳定，每集仍保持 ${plotRange} 个剧情点，${wordRange} 字左右\n` +
      `- 避免引入新的逻辑错误或类型不匹配问题（以改编方法论和质检清单为基准）`
    )

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n')
    }
  }

  /**
   * 组装剧本修订 (script repair) 的 Prompt
   * 用于在剧本质检 FAIL 后执行有约束的自修
   */
  assembleScriptRepair(
    skill: Skill,
    roleDeclaration: string,
    scriptOutput: string,
    plotBreakdown: string,
    novelChaptersText: string,
    reviewFeedback: string,
    projectContext: AdaptProjectContext,
    targetEpisodes: number[],
    previousScript?: string,
    volumePlan?: VolumePlan | null,
    userNotes?: string
  ): AssembledPrompt {
    const systemParts: string[] = []
    const userParts: string[] = []

    // 1. 角色 + 方法论 + 规范 + 风格
    systemParts.push(roleDeclaration)
    if (skill.methodology) {
      systemParts.push(`\n---\n\n# 改编方法论\n\n${skill.methodology}`)
    }
    systemParts.push(`\n---\n\n# 技能规范\n\n${skill.systemPrompt}`)
    if (skill.guides?.['output-style']) {
      systemParts.push(`\n---\n\n# 视觉化快节奏写作风格\n\n${skill.guides['output-style']}`)
    }

    // 2. 项目信息
    const epList = targetEpisodes.map(e => `第${e}集`).join('、')
    userParts.push([
      `# 小说信息`,
      ``,
      `- 小说名称：《${projectContext.novelTitle}》`,
      `- 小说类型：${projectContext.novelGenre}`,
      `- 本次修订集数：${epList}`
    ].join('\n'))

    // 3. 用户指导笔记
    if (userNotes) {
      userParts.push(`\n---\n\n# 📝 用户指导笔记（必须严格遵守，优先级最高）\n\n${userNotes}`)
    }

    // 4. 上一版剧本
    userParts.push(`\n---\n\n# 上一版剧本输出（待修订）\n\n${scriptOutput}`)

    // 5. 剧情拆解
    userParts.push(`\n---\n\n# 对应剧情拆解（对照用）\n\n${plotBreakdown}`)

    // 6. 小说原文
    userParts.push(`\n---\n\n# 对应章节小说原文（对照用）\n\n${novelChaptersText}`)

    // 7. 上一集剧本（跨集连贯性）
    if (previousScript) {
      userParts.push(`\n---\n\n# 上一集剧本（跨集连贯性对照）\n\n${previousScript}`)
    }

    // 8. 质检问题反馈
    userParts.push(`\n---\n\n# 上一轮质检问题反馈（必须全部解决）\n\n${reviewFeedback}`)

    // 9. 修订指令
    const wordRange = volumePlan ? `${volumePlan.episodeWordCount[0]}-${volumePlan.episodeWordCount[1]}` : '1500-2000'
    const sceneRange = volumePlan ? `${volumePlan.scenesPerEpisode[0]}-${volumePlan.scenesPerEpisode[1]}` : '3-4'
    const seedanceRange = volumePlan ? `${volumePlan.seedancePerEpisode[0]}-${volumePlan.seedancePerEpisode[1]}` : '9-12'
    userParts.push(
      `\n---\n\n❗修订指令：在保留上一版剧本中已正确的结构、节奏和高质量桥段的前提下，仅针对质检反馈指出的问题进行精准修订。\n\n` +
      `要求：\n` +
      `- 必须逐条解决反馈中的所有问题，不得只做表面修改\n` +
      `- 尽量保持场景数量、Seedance 段数量和字数与规划一致（每集 ${wordRange} 字，${sceneRange} 个场景，${seedanceRange} 个 Seedance 段）\n` +
      `- 保持人物行为和时间线逻辑稳定，只在必要时重写局部以修复问题\n` +
      `- 继续使用※△【】等视觉化符号，确保每集以【卡黑】结尾\n` +
      `- 修订完成后请直接给出新的完整剧本正文，不要输出质检报告`
    )

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n')
    }
  }
}
