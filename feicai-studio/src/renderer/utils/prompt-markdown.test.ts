import { storyboard } from '@shared/fixtures/controlled-production'
import { describe, expect, it } from 'vitest'
import { parsePromptsFromMarkdown } from './prompt-markdown'

describe('prompt-markdown', () => {
  it('能解析提示词时长、内容和引用资源', () => {
    const raw = `# EP01 提示词

## 参考图表
@图片1 角色A

## 开场镜头
时长：8秒
角色A走入废墟，抬头看向天空。@图片1 @场景图2

## 对话镜头
5s
角色A和角色B对视。
`

    const prompts = parsePromptsFromMarkdown(raw)

    expect(prompts).toHaveLength(2)
    expect(prompts.map((prompt) => prompt.index)).toEqual([1, 2])
    expect(prompts[0].duration).toBe(8)
    expect(prompts[0].references).toEqual([
      { referenceTag: '@图片1', assetType: 'character' },
      { referenceTag: '@场景图2', assetType: 'scene' }
    ])
    expect(prompts[1].duration).toBe(5)
  })

  it('真实模板的卡片保持索引协议，场景类型、去重和标题时长与主进程一致', () => {
    const prompts = parsePromptsFromMarkdown(storyboard)
    expect(prompts).toHaveLength(2)
    expect(prompts.reduce((sum, prompt) => sum + prompt.duration, 0)).toBe(16.5)
    expect(prompts.map(({ index, duration }) => ({ index, duration }))).toEqual(
      [
        { index: 1, duration: 10 },
        { index: 2, duration: 6.5 }
      ]
    )
    expect(prompts[0].references).toEqual([
      { referenceTag: '@图片1', assetType: 'character' },
      { referenceTag: '@图片3', assetType: 'scene' }
    ])
    expect(prompts[1].references).toEqual([
      { referenceTag: '@图片2', assetType: 'character' },
      { referenceTag: '@图片4', assetType: 'scene' }
    ])
    expect(prompts[0].content).toContain('6-10秒：定格')
  })

  it('不从时间轴猜测时长，标题无效时回退正文时长', () => {
    const prompts = parsePromptsFromMarkdown(`## P01 开场
0-3秒：开场
3-10秒：结束

## P02 【建议时长：-8s】
**时长**：6.5秒
@图片1 @图片1 @场景图2 @音频1 @视频1`)
    expect(prompts.map((prompt) => prompt.duration)).toEqual([5, 6.5])
    expect(prompts[1].references).toEqual([
      { referenceTag: '@图片1', assetType: 'character' },
      { referenceTag: '@场景图2', assetType: 'scene' }
    ])
  })

  it.each(['素材对应表', '**参考图表**：'])(
    '元数据 %s 位于开头、中间、末尾或独立存在均不生成卡片',
    (heading) => {
      const table = `## ${heading}\n| 引用编号 | 素材类型 | 对应素材 |\n| --- | --- | --- |\n| @图片3 | 场景参考 | 院子 |\n`
      const first = '## 开场镜头\n时长：10秒\n场景参考@图片3。\n'
      const last = '## 收尾镜头\n时长：6.5秒\n场景参考@图片3。\n'
      for (const [raw, indices] of [
        [table + first + last, [1, 2]],
        [first + table + last, [0, 2]],
        [first + last + table, [0, 1]],
        [first + last, [0, 1]]
      ] as const) {
        const prompts = parsePromptsFromMarkdown(raw)
        expect(prompts.map((prompt) => prompt.index)).toEqual(indices)
        expect(prompts.map((prompt) => prompt.title)).toEqual([
          '开场镜头',
          '收尾镜头'
        ])
        expect(prompts.reduce((sum, prompt) => sum + prompt.duration, 0)).toBe(
          16.5
        )
        if (raw.includes(table))
          expect(prompts[0].references).toEqual([
            { referenceTag: '@图片3', assetType: 'scene' }
          ])
      }
      const onlyTable = parsePromptsFromMarkdown(table)
      expect(onlyTable).toEqual([])
      expect(onlyTable.reduce((sum, prompt) => sum + prompt.duration, 0)).toBe(
        0
      )
    }
  )

  it('会跳过没有正文内容的分段', () => {
    const raw = `## 空段

## 有内容
镜头描述
`

    const prompts = parsePromptsFromMarkdown(raw)

    expect(prompts).toHaveLength(1)
    expect(prompts[0].title).toBe('有内容')
  })
})
