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
