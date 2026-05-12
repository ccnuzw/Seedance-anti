import { describe, expect, it } from 'vitest'
import { PromptAssembler } from './prompt-assembler'
import type { Skill } from '@shared/types'

const skill: Skill = {
  name: 'test-skill',
  description: '测试技能',
  systemPrompt: '核心系统提示',
  methodology: '方法论说明',
  templates: {
    markdown: '# 模板'
  },
  examples: {
    exampleA: '示例 A'
  },
  guides: {
    guideA: '指南 A'
  },
  skillPath: '/tmp/skill',
  fileManifest: []
}

describe('prompt-assembler', () => {
  it('assemble 会按既定顺序拼装 system 和 user 内容', () => {
    const assembler = new PromptAssembler()

    const prompt = assembler.assemble(
      skill,
      '角色声明',
      {
        sourceNovel: '# source',
        plotBreakdown: '# plot breakdown',
        storyBeat: '# story beat',
        previousScript: '# previous script',
        nextScript: '# next script',
        script: '# script',
        directorAnalysis: '# director',
        characterPrompts: '# characters',
        scenePrompts: '# scenes'
      },
      {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 2,
        totalEpisodes: 30,
        chaptersPerEpisode: 4,
        durationMin: 90,
        durationMax: 120,
        singlePromptMax: 10,
        scriptWordCountMin: 1200,
        scriptWordCountMax: 1800
      },
      'script_generation',
      '请修正节奏问题'
    )

    expect(prompt.system).toContain('角色声明')
    expect(prompt.system).toContain('# 技能规范')
    expect(prompt.system).toContain('# 方法论')
    expect(prompt.system).toContain('# 参考示例：exampleA')
    expect(prompt.system).toContain('# 指南：guideA')
    expect(prompt.system).toContain('# 输出格式模板：markdown')

    expect(prompt.user).toContain('# 项目信息')
    expect(prompt.user).toContain('- 项目名称：项目')
    expect(prompt.user).toContain('- 目标总集数：30 集')
    expect(prompt.user).toContain('- 章节-集数分配：每 4 章对应 1 集')
    expect(prompt.user).toContain('小说处理上限：第 1-120 章')
    expect(prompt.user).toContain('- 每集总时长：90-120 秒')
    expect(prompt.user).toContain('- 单条提示词时长上限：10 秒')
    expect(prompt.user).toContain('- 每集剧本字数：1200-1800 字')
    expect(prompt.user).toContain('# 已有角色素材')
    expect(prompt.user).toContain('# 已有场景素材')
    expect(prompt.user).toContain('# 本集剧本')
    expect(prompt.user).toContain('# 上一集剧本')
    expect(prompt.user).toContain('# previous script')
    expect(prompt.user).toContain('# 下一集剧本')
    expect(prompt.user).toContain('# next script')
    expect(prompt.user).toContain('# 小说原文与设定')
    expect(prompt.user).toContain('# 当前集剧情库存')
    expect(prompt.user).toContain('# 本集剧情拆解')
    expect(prompt.user).toContain('# 导演讲戏本')
    expect(prompt.user).toContain(
      '请根据以上剧情库存、剧情拆解和小说原文，直接输出当前集的完整漫剧剧本'
    )
    expect(prompt.user).toContain('剧本规格必须接近项目配置：1200-1800 字')
    expect(prompt.user).toContain('25-40 条“△”动作指示')
    expect(prompt.user).toContain('【卡黑】必须是剧本最后一行')
    expect(prompt.user).toContain('必须承接上一集结尾悬念')
    expect(prompt.user).toContain('反向校验当前集结尾与下一集开场')
    expect(prompt.user).toContain('# ⚠️ 上次审核未通过，请根据以下反馈修改')
  })

  it('assemble 在 art 阶段会把已有素材标为风格参考，并附加 art 专用指令', () => {
    const assembler = new PromptAssembler()

    const prompt = assembler.assemble(
      skill,
      '角色声明',
      {
        script: '# script',
        directorAnalysis: '# director',
        characterPrompts: '# characters',
        scenePrompts: '# scenes'
      },
      {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 3
      },
      'art'
    )

    expect(prompt.user).toContain('# 风格参考：已有角色素材')
    expect(prompt.user).toContain('# 风格参考：已有场景素材')
    expect(prompt.user).toContain('不要回复“复用”或“无新增”，必须输出完整内容')
    expect(prompt.user).toContain('1. 先输出 # 人物提示词 部分')
  })

  it('assemble 在 story 阶段会注入完整剧情库存并要求剧情编号连续', () => {
    const assembler = new PromptAssembler()

    const prompt = assembler.assemble(
      skill,
      '角色声明',
      {
        sourceNovel: '# source',
        fullPlotBreakdown:
          '# 剧情拆解\n\n【剧情12】院子，主角救人，危机反转，第4集，状态：已用\n'
      },
      {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 5
      },
      'story'
    )

    expect(prompt.user).toContain('# 完整剧情库存')
    expect(prompt.user).toContain('【剧情12】院子，主角救人')
    expect(prompt.user).toContain('新的剧情点编号必须连续递增')
    expect(prompt.user).toContain('不得从【剧情1】重新开始')
    expect(prompt.user).toContain('只提取 7 分以上的核心冲突和情绪钩子')
    expect(prompt.user).toContain('不得改编超出项目信息中“小说处理上限”的章节内容')
  })

  it('assemble 在默认阶段会使用通用执行指令', () => {
    const assembler = new PromptAssembler()

    const prompt = assembler.assemble(
      skill,
      '角色声明',
      {},
      {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      },
      'director'
    )

    expect(prompt.user).toContain(
      '请按照以上技能规范和输出格式模板，对本集内容执行分析并输出完整结果'
    )
  })

  it('assembleReview 会拼入待审核内容、原始剧本和导演讲戏本', () => {
    const assembler = new PromptAssembler()

    const prompt = assembler.assembleReview(
      skill,
      '对抗性审核立场',
      '# output',
      '# script',
      '# director',
      '# plot-breakdown'
    )

    expect(prompt.system).toContain('对抗性审核立场')
    expect(prompt.system).toContain('# 审核规范')
    expect(prompt.user).toContain('# 待审核内容')
    expect(prompt.user).toContain('# 原始剧本（对照用）')
    expect(prompt.user).toContain('# 导演讲戏本（对照用）')
    expect(prompt.user).toContain('# 剧情库存（对照用）')
    expect(prompt.user).toContain('最终给出 PASS 或 FAIL 结论')
  })
})
