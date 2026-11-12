import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { SkillLoader } from './skill-loader'
import { PromptAssembler } from './prompt-assembler'
import { fileURLToPath } from 'url'

describe('SkillLoader', () => {
  it('会加载根目录通用方法论文件和 guide 文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feicai-skill-loader-'))
    try {
      const skillDir = join(root, 'webtoon-test-skill')
      await mkdir(join(skillDir, 'templates'), { recursive: true })
      await mkdir(join(skillDir, 'examples'), { recursive: true })
      await writeFile(
        join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: webtoon-test-skill',
          'description: 测试 skill',
          '---',
          '',
          '# Skill Body'
        ].join('\n'),
        'utf-8'
      )
      await writeFile(join(skillDir, 'adapt-method.md'), '改编方法论', 'utf-8')
      await writeFile(join(skillDir, 'output-style.md'), '输出风格', 'utf-8')
      await writeFile(join(skillDir, 'custom-guide.md'), '指南内容', 'utf-8')
      await writeFile(
        join(skillDir, 'templates', 'script-template.md'),
        '模板内容',
        'utf-8'
      )
      await writeFile(
        join(skillDir, 'examples', 'script-example.md'),
        '示例内容',
        'utf-8'
      )

      const skill = await new SkillLoader(root).load('webtoon-test-skill')

      expect(skill.methodology).toContain('改编方法论')
      expect(skill.methodology).toContain('输出风格')
      expect(skill.guides?.['custom-guide']).toContain('指南内容')
      expect(skill.templates['script-template']).toBe('模板内容')
      expect(skill.examples['script-example']).toBe('示例内容')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('审核技能的显式跨目录依据会进入最终审核prompt，而非仅出现在manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feicai-review-dependency-'))
    try {
      await mkdir(join(root, 'review'))
      await mkdir(join(root, 'generation'))
      await writeFile(
        join(root, 'review', 'SKILL.md'),
        [
          '---',
          'name: review',
          'description: "审核: 方法论"',
          'dependencies:',
          '  - ../generation/adapt-method.md',
          '---',
          '# 核验规则'
        ].join('\n')
      )
      await writeFile(
        join(root, 'generation', 'adapt-method.md'),
        '真实改编依据'
      )
      const loaded = await new SkillLoader(root).load('review')
      const prompt = new PromptAssembler().assembleReview(
        loaded,
        '严格审核',
        '# 正文'
      )
      expect(loaded.description).toBe('审核: 方法论')
      expect(prompt.system).toContain('真实改编依据')
      expect(prompt.system).toContain('最终输出协议')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('缺失、越界或非法依赖声明不能静默省略', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feicai-review-missing-'))
    try {
      await mkdir(join(root, 'review'))
      for (const dependency of [
        '[missing.md]',
        '[../../outside.md]',
        'bad-type'
      ]) {
        await writeFile(
          join(root, 'review', 'SKILL.md'),
          `---\nname: review\ndependencies: ${dependency}\n---\n# 规则`
        )
        await expect(new SkillLoader(root).load('review')).rejects.toThrow()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('拒绝技能名称越界和符号链接逃逸，同时保留旧缓存与显式reload行为', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feicai-skill-boundary-'))
    const outside = await mkdtemp(join(tmpdir(), 'feicai-skill-outside-'))
    try {
      await mkdir(join(root, 'review'))
      await writeFile(join(root, 'review/SKILL.md'), '# Original')
      const loader = new SkillLoader(root)
      const original = await loader.load('review')
      await writeFile(join(root, 'review/SKILL.md'), '# Updated')
      expect(await loader.load('review')).toBe(original)
      expect((await loader.reload('review')).systemPrompt).toBe('# Updated')
      for (const name of ['../review', '/review', '.', '..', 'a\\\\review'])
        await expect(loader.load(name)).rejects.toThrow('Invalid Skill name')
      await writeFile(join(outside, 'rules.md'), '# Outside')
      await symlink(join(outside, 'rules.md'), join(root, 'review/rules.md'))
      await expect(loader.reload('review')).rejects.toThrow('symlink escapes')
      await symlink(outside, join(root, 'escaped'))
      await expect(loader.load('escaped')).rejects.toThrow('symlink escapes')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it.each([
    'story-breakdown-review-skill',
    'script-review-skill',
    'script-analysis-review-skill',
    'art-direction-review-skill',
    'seedance-prompt-review-skill',
    'compliance-review-skill'
  ])('内置%s的依据可完整装载并提供统一机器审核协议', async (name) => {
    const loader = new SkillLoader(
      fileURLToPath(
        new URL('../../../resources/builtin-skills/', import.meta.url)
      )
    )
    const loaded = await loader.load(name)
    const prompt = new PromptAssembler().assembleReview(
      loaded,
      '严格核验',
      '# 待审正文'
    )
    expect(prompt.system).toContain('仅输出一个 JSON 对象')
    if (name !== 'compliance-review-skill')
      expect(loaded.methodology?.length).toBeGreaterThan(0)
  })
})
