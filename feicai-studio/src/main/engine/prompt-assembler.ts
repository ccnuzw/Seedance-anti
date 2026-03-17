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
  /** 流水线参数（可选，由项目配置提供） */
  durationMin?: number
  durationMax?: number
  singlePromptMax?: number
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
        systemParts.push(`\n---\n\n# 输出格式模板：${name}\n\n请严格按照以下模板格式输出：\n\n${content}`)
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
    if (projectContext.durationMin || projectContext.durationMax) {
      projectInfo.push(`- 每集总时长：${projectContext.durationMin || 90}-${projectContext.durationMax || 120} 秒`)
    }
    if (projectContext.singlePromptMax) {
      projectInfo.push(`- 单条提示词时长上限：${projectContext.singlePromptMax} 秒`)
    }
    userParts.push(projectInfo.join('\n'))

    // 8. 已有素材上下文
    if (inputs.characterPrompts) {
      if (stage === 'art') {
        userParts.push(`\n---\n\n# 风格参考：已有角色素材（保持风格一致，但必须重新生成本集完整内容）\n\n${inputs.characterPrompts}`)
      } else {
        userParts.push(`\n---\n\n# 已有角色素材\n\n${inputs.characterPrompts}`)
      }
    }
    if (inputs.scenePrompts) {
      if (stage === 'art') {
        userParts.push(`\n---\n\n# 风格参考：已有场景素材（保持风格一致，但必须重新生成本集完整内容）\n\n${inputs.scenePrompts}`)
      } else {
        userParts.push(`\n---\n\n# 已有场景素材\n\n${inputs.scenePrompts}`)
      }
    }

    // 9. 上游输入
    if (inputs.script) {
      userParts.push(`\n---\n\n# 本集剧本\n\n${inputs.script}`)
    }
    if (inputs.directorAnalysis) {
      userParts.push(`\n---\n\n# 导演讲戏本\n\n${inputs.directorAnalysis}`)
    }

    // 10. 执行指令（根据阶段区分）
    if (stage === 'art') {
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
    directorAnalysis?: string
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

    userParts.push(
      `\n---\n\n请按照审核规范逐项检查，输出评分和具体审核意见。如发现问题，明确指出问题位置、违反规则、修改方向。最终给出 PASS 或 FAIL 结论。`
    )

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n')
    }
  }
}
