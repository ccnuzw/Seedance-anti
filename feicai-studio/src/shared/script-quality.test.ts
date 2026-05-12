import { describe, expect, it } from 'vitest'
import { validateScriptHardRules } from './script-quality'

function buildValidScript(): string {
  const lines: string[] = []
  for (let scene = 1; scene <= 3; scene += 1) {
    lines.push(`※ 场景${scene} 院子 日`)
    lines.push(`Seedance P0${scene}`)
    for (let action = 1; action <= 10; action += 1) {
      lines.push(`△ 陆青青推进事件${scene}-${action}，情绪继续升级。`)
    }
    for (let dialogue = 1; dialogue <= 6; dialogue += 1) {
      lines.push(`陆青青：这是第${scene}场第${dialogue}句短对白。`)
    }
  }
  for (let index = 4; index <= 9; index += 1) {
    lines.push(`Seedance P0${index}`)
  }
  lines.push('【卡黑】')
  return lines.join('\n')
}

describe('script-quality', () => {
  it('会通过符合硬性规格的剧本', () => {
    const result = validateScriptHardRules(buildValidScript(), {
      scriptWordCountMin: 100,
      scriptWordCountMax: 2000
    })

    expect(result.passed).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('会拦截缺少卡黑和动作不足的剧本', () => {
    const result = validateScriptHardRules('※ 场景1\n陆青青：一句话。', {
      scriptWordCountMin: 1,
      scriptWordCountMax: 2000
    })

    expect(result.passed).toBe(false)
    expect(result.issues.map((issue) => issue.description).join('\n')).toContain(
      '最后一行必须是【卡黑】'
    )
    expect(result.issues.map((issue) => issue.description).join('\n')).toContain(
      '动作指示数量不合规'
    )
  })
})
