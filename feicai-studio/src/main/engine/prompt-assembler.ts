// ============================================================
// Prompt Assembler — 组装 LLM 调用的完整 Prompt
// ============================================================
//
// 组装顺序（遵循 FEICAI "高优先级内容靠近生成" 原则）：
//
// System Message:
//   1. 角色声明（来自 producer-skill）
//   2. Skill 核心方法论（SKILL.md body）
//   3. 扩展方法论（如 seedance-prompt-methodology.md）
//   4. 示例参考
//   5. 指南（如 gemini-image-prompt-guide.md）
//   6. 输出模板
//
// User Message:
//   7. 项目配置
//   8. 已有素材上下文
//   9. 上游输入（剧本/讲戏本）  ← 离 LLM 生成最近
//  10. 执行指令
//

import type { Skill, AssembledPrompt } from '@shared/types'

export interface UpstreamInputs {
  /** 小说原文/设定 */
  sourceNovel?: string
  /** 全局剧情库存中当前集的剧情点 */
  plotBreakdown?: string
  /** 完整剧情库存，用于剧情拆解延续编号、批次和分集规划 */
  fullPlotBreakdown?: string
  /** 单集剧情拆解 */
  storyBeat?: string
  /** 上一集剧本，用于跨集承接 */
  previousScript?: string
  /** 下一集剧本，用于指定集重写时保护后续连续性 */
  nextScript?: string
  /** 原始剧本内容 */
  script?: string
  /** 导演分析讲戏本 */
  directorAnalysis?: string
  /** 已有角色素材 */
  characterPrompts?: string
  /** 已有场景素材 */
  scenePrompts?: string
}

export interface ProjectContext {
  projectName: string
  visualStyle: string
  targetMedium: string
  episodeNumber: number
  totalEpisodes?: number
  chaptersPerEpisode?: number
  /** 流水线参数（可选，由项目配置提供） */
  durationMin?: number
  durationMax?: number
  singlePromptMax?: number
  scriptWordCountMin?: number
  scriptWordCountMax?: number
}

export class PromptAssembler {
  /**
   * 组装完整的 Prompt
   */
  assemble(
    skill: Skill,
    roleDeclaration: string,
    inputs: UpstreamInputs,
    projectContext: ProjectContext,
    stage?: string,
    reviewFeedback?: string
  ): AssembledPrompt {
    const systemParts: string[] = []
    const userParts: string[] = []

    // ============ System Message ============

    // 1. 角色声明
    systemParts.push(roleDeclaration)

    // 2. Skill 核心方法论（SKILL.md body）
    systemParts.push(`\n---\n\n# 技能规范\n\n${skill.systemPrompt}`)

    // 3. 扩展方法论
    if (skill.methodology) {
      systemParts.push(`\n---\n\n# 方法论\n\n${skill.methodology}`)
    }

    // 4. 示例参考
    if (skill.examples && Object.keys(skill.examples).length > 0) {
      for (const [name, content] of Object.entries(skill.examples)) {
        systemParts.push(`\n---\n\n# 参考示例：${name}\n\n${content}`)
      }
    }

    // 5. 指南
    if (skill.guides) {
      for (const [name, content] of Object.entries(skill.guides)) {
        systemParts.push(`\n---\n\n# 指南：${name}\n\n${content}`)
      }
    }

    // 6. 输出模板
    if (skill.templates && Object.keys(skill.templates).length > 0) {
      for (const [name, content] of Object.entries(skill.templates)) {
        systemParts.push(
          `\n---\n\n# 输出格式模板：${name}\n\n请严格按照以下模板格式输出：\n\n${content}`
        )
      }
    }

    // ============ User Message ============

    // 7. 项目配置
    const projectInfo = [
      `# 项目信息`,
      ``,
      `- 项目名称：${projectContext.projectName}`,
      `- 视觉风格：${projectContext.visualStyle}`,
      `- 目标媒介：${projectContext.targetMedium}`,
      `- 当前集数：第 ${projectContext.episodeNumber} 集`
    ]
    if (projectContext.totalEpisodes) {
      projectInfo.push(`- 目标总集数：${projectContext.totalEpisodes} 集`)
    }
    if (projectContext.chaptersPerEpisode) {
      projectInfo.push(
        `- 章节-集数分配：每 ${projectContext.chaptersPerEpisode} 章对应 1 集`
      )
      if (projectContext.totalEpisodes) {
        projectInfo.push(
          `- 小说处理上限：第 1-${projectContext.totalEpisodes * projectContext.chaptersPerEpisode} 章，超出部分本轮项目不得改编`
        )
      }
    }
    if (projectContext.durationMin || projectContext.durationMax) {
      projectInfo.push(
        `- 每集总时长：${projectContext.durationMin || 90}-${projectContext.durationMax || 120} 秒`
      )
    }
    if (projectContext.singlePromptMax) {
      projectInfo.push(
        `- 单条提示词时长上限：${projectContext.singlePromptMax} 秒`
      )
    }
    if (projectContext.scriptWordCountMin || projectContext.scriptWordCountMax) {
      projectInfo.push(
        `- 每集剧本字数：${projectContext.scriptWordCountMin || 1500}-${projectContext.scriptWordCountMax || 2000} 字`
      )
    }
    userParts.push(projectInfo.join('\n'))

    // 8. 已有素材上下文
    if (inputs.characterPrompts) {
      if (stage === 'art') {
        userParts.push(
          `\n---\n\n# 风格参考：已有角色素材（保持风格一致，但必须重新生成本集完整内容）\n\n${inputs.characterPrompts}`
        )
      } else {
        userParts.push(`\n---\n\n# 已有角色素材\n\n${inputs.characterPrompts}`)
      }
    }
    if (inputs.scenePrompts) {
      if (stage === 'art') {
        userParts.push(
          `\n---\n\n# 风格参考：已有场景素材（保持风格一致，但必须重新生成本集完整内容）\n\n${inputs.scenePrompts}`
        )
      } else {
        userParts.push(`\n---\n\n# 已有场景素材\n\n${inputs.scenePrompts}`)
      }
    }

    // 9. 上游输入
    if (inputs.script) {
      userParts.push(`\n---\n\n# 本集剧本\n\n${inputs.script}`)
    }
    if (inputs.previousScript && stage === 'script_generation') {
      userParts.push(
        `\n---\n\n# 上一集剧本（必须承接其结尾悬念、人物状态和场景逻辑）\n\n${inputs.previousScript}`
      )
    }
    if (inputs.nextScript && stage === 'script_generation') {
      userParts.push(
        `\n---\n\n# 下一集剧本（重写当前集时必须保护后续连续性，不能破坏下一集已建立的人物状态、地点和悬念承接）\n\n${inputs.nextScript}`
      )
    }
    if (inputs.sourceNovel) {
      userParts.push(`\n---\n\n# 小说原文与设定\n\n${inputs.sourceNovel}`)
    }
    if (inputs.fullPlotBreakdown && stage === 'story') {
      userParts.push(
        `\n---\n\n# 完整剧情库存（用于延续编号、批次、分集规划和状态管理）\n\n${inputs.fullPlotBreakdown}`
      )
    }
    if (inputs.plotBreakdown) {
      userParts.push(`\n---\n\n# 当前集剧情库存\n\n${inputs.plotBreakdown}`)
    }
    if (inputs.storyBeat) {
      userParts.push(`\n---\n\n# 本集剧情拆解\n\n${inputs.storyBeat}`)
    }
    if (inputs.directorAnalysis) {
      userParts.push(`\n---\n\n# 导演讲戏本\n\n${inputs.directorAnalysis}`)
    }

    // 10. 执行指令（根据阶段区分）
    if (stage === 'story') {
      const scriptWordCountRange = `${projectContext.scriptWordCountMin || 1500}-${projectContext.scriptWordCountMax || 2000}`
      userParts.push(
        `\n---\n\n请根据以上上游材料，输出当前 6 章批次的剧情拆解结果。\n\n硬性要求：\n1. 必须先参考“完整剧情库存”中已有最大剧情编号、已有批次和分集规划，新的剧情点编号必须连续递增，不得从【剧情1】重新开始，不得重复已有编号。\n2. 只提取 7 分以上的核心冲突和情绪钩子；低强度过渡、环境描写、心理铺垫、无关支线不得作为独立剧情点。\n3. 输出必须包含可追加到剧情库存的剧情点行，格式必须为：【剧情n】[场景]，[角色A]对[角色B][做了什么]，[情绪钩子类型]，第X集，状态：未用。\n4. 拆解时直接标注分集，每集通常 3-4 个剧情点，可按爆点密度灵活调整，但必须能支撑每集 ${scriptWordCountRange} 字剧本。\n5. 必须覆盖当前批次的核心冲突、关键转折和结尾钩子，不能只输出摘要、分析过程或章节梗概。\n6. 不得改编超出项目信息中“小说处理上限”的章节内容。`
      )
    } else if (stage === 'script_generation') {
      const scriptWordCountRange = `${projectContext.scriptWordCountMin || 1500}-${projectContext.scriptWordCountMax || 2000}`
      userParts.push(
        `\n---\n\n请根据以上剧情库存、剧情拆解和小说原文，直接输出当前集的完整漫剧剧本。\n\n硬性要求：\n1. 必须优先覆盖当前集分配到的全部未用剧情点，不能跳用其他集剧情点，不能遗漏高强度钩子，不能重复使用已用剧情点。\n2. 剧本规格必须接近项目配置：${scriptWordCountRange} 字，3-4 个场景，9-12 个 Seedance 段，25-40 条“△”动作指示，15-25 句短对白。\n3. 必须使用“※”标注场景/环境，使用“△”标注动作/变化，可使用【特效】【系统面板】【文字】【音效】【独白】【闪回】【卡黑】等视觉符号。\n4. 开场必须快速进入冲突，中段持续升级，结尾必须设置强悬念。\n5. 【卡黑】必须是剧本最后一行，之后不得有任何解释、备注、总结或 Markdown 注释。\n6. 如提供上一集剧本，必须承接上一集结尾悬念、人物状态、关系变化和场景逻辑，不能让人物位置、伤势、目标或情绪突然重置。\n7. 如提供下一集剧本，必须反向校验当前集结尾与下一集开场/人物状态/地点/悬念一致，不能改断后续连续性。\n8. 不要输出额外解释，只输出完整剧本正文。`
      )
    } else if (stage === 'art') {
      userParts.push(
        `\n---\n\n❗重要指令：请根据本集剧本和导演讲戏本，为本集所有在场角色生成完整的人物设定提示词，以及为本集所有场景生成完整的场景环境提示词。\n\n不要回复“复用”或“无新增”，必须输出完整内容。已有素材仅作为风格参考。\n\n输出格式：\n1. 先输出 # 人物提示词 部分\n2. 再输出 # 场景道具提示词 部分\n\n每个角色/场景都必须有完整的中文叙事描述式提示词。`
      )
    } else {
      userParts.push(
        `\n---\n\n请按照以上技能规范和输出格式模板，对本集内容执行分析并输出完整结果。输出时直接给出完整内容，不要添加额外解释。`
      )
    }

    // 11. 审核反馈（重试时注入）
    if (reviewFeedback) {
      userParts.push(
        `\n---\n\n# ⚠️ 上次审核未通过，请根据以下反馈修改\n\n${reviewFeedback}\n\n请着重改进上述问题，重新生成完整输出。不要省略任何内容。`
      )
    }

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n')
    }
  }

  /**
   * 为审核组装 Prompt
   */
  assembleReview(
    reviewSkill: Skill,
    antibiasPrompt: string,
    outputToReview: string,
    originalScript?: string,
    directorAnalysis?: string,
    plotBreakdown?: string
  ): AssembledPrompt {
    const systemParts: string[] = []
    const userParts: string[] = []

    // System: 对抗性立场 + 审核 Skill
    systemParts.push(antibiasPrompt)
    systemParts.push(`\n---\n\n# 审核规范\n\n${reviewSkill.systemPrompt}`)

    // User: 待审核内容 + 原始对照
    userParts.push(`# 待审核内容\n\n${outputToReview}`)

    if (originalScript) {
      userParts.push(`\n---\n\n# 原始剧本（对照用）\n\n${originalScript}`)
    }

    if (directorAnalysis) {
      userParts.push(`\n---\n\n# 导演讲戏本（对照用）\n\n${directorAnalysis}`)
    }

    if (plotBreakdown) {
      userParts.push(`\n---\n\n# 剧情库存（对照用）\n\n${plotBreakdown}`)
    }

    userParts.push(
      `\n---\n\n请按照审核规范逐项检查，输出评分和具体审核意见。如发现问题，明确指出问题位置、违反规则、修改方向。最终给出 PASS 或 FAIL 结论。`
    )

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n')
    }
  }
}
