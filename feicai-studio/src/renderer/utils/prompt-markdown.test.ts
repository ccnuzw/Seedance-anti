import { readFileSync } from 'node:fs'
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

    expect(prompts).toHaveLength(3)
    expect(prompts[1].duration).toBe(8)
    expect(prompts[1].references).toEqual([
      { referenceTag: '@图片1', assetType: 'character' },
      { referenceTag: '@场景图2', assetType: 'scene' }
    ])
    expect(prompts[2].duration).toBe(5)
  })

  it('真实模板的卡片保持索引协议，场景类型、去重和标题时长与主进程一致', () => {
    const template = readFileSync(
      new URL(
        '../../../resources/builtin-skills/seedance-storyboard-skill/templates/seedance-prompts-template.md',
        import.meta.url
      ),
      'utf8'
    )
    const raw = template
      .match(/```markdown\n([\s\S]*?)\n```/)![1]
      .replace('[根据01讲戏本填入]', '10')
      .replace('[X]', '6.5')
      .replace(
        /\[完整的[\s\S]*?视频。\]/,
        '以@图片1为主角，场景参考@图片3。\n0-3秒：开场@图片1。\n3-6秒：@图片3。\n6-10秒：收尾，@音频1。'
      )
      .replace('[...]', '参考@图片2与@图片4，@视频1。')
    const prompts = parsePromptsFromMarkdown(raw)
    expect(prompts.map(({ index, duration }) => ({ index, duration }))).toEqual(
      [
        { index: 0, duration: 5 },
        { index: 1, duration: 10 },
        { index: 2, duration: 6.5 }
      ]
    )
    expect(prompts[1].references).toEqual([
      { referenceTag: '@图片1', assetType: 'character' },
      { referenceTag: '@图片3', assetType: 'scene' }
    ])
    expect(prompts[2].references).toEqual([
      { referenceTag: '@图片2', assetType: 'character' },
      { referenceTag: '@图片4', assetType: 'scene' }
    ])
    expect(prompts[1].content).toContain('6-10秒：收尾，@音频1。')
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
