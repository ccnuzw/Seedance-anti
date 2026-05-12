import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { SkillLoader } from './skill-loader'

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
})
