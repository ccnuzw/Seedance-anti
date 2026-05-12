import type { PipelineSettings, ReviewIssue } from './types'

export interface ScriptHardValidationResult {
  passed: boolean
  issues: ReviewIssue[]
}

export function validateScriptHardRules(
  script: string,
  settings: Partial<PipelineSettings> = {}
): ScriptHardValidationResult {
  const issues: ReviewIssue[] = []
  const normalized = script.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const nonEmptyLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const lastLine = nonEmptyLines[nonEmptyLines.length - 1] || ''
  const wordCount = countCjkAwareWords(normalized)
  const minWords = Math.max(0, Number(settings.scriptWordCountMin) || 1500)
  const maxWords = Math.max(0, Number(settings.scriptWordCountMax) || 2000)
  const sceneCount = countMatches(normalized, /^※/gm)
  const actionCount = countMatches(normalized, /△/g)
  const dialogueCount = countDialogueLines(normalized)
  const seedanceCount = countSeedanceSegments(normalized)

  if (lastLine !== '【卡黑】') {
    issues.push({
      severity: 'critical',
      description: '最后一行必须是【卡黑】，且之后不能有解释、备注或空外内容',
      suggestion: '删除【卡黑】后的内容，并确保最后一个非空行严格等于【卡黑】'
    })
  }

  if (minWords > 0 && wordCount < minWords) {
    issues.push({
      severity: 'major',
      description: `剧本字数不足：当前约 ${wordCount} 字，要求至少 ${minWords} 字`,
      suggestion: '补足场景动作、情绪推进和必要对白'
    })
  }
  if (maxWords > 0 && wordCount > maxWords) {
    issues.push({
      severity: 'major',
      description: `剧本字数超限：当前约 ${wordCount} 字，要求不超过 ${maxWords} 字`,
      suggestion: '压缩解释性描写，保留动作、对白和关键转折'
    })
  }

  if (sceneCount < 3 || sceneCount > 4) {
    issues.push({
      severity: 'major',
      description: `场景数量不合规：当前 ${sceneCount} 个“※”场景，要求 3-4 个`,
      suggestion: '按旧版规格整理为 3-4 个明确场景'
    })
  }

  if (actionCount < 25 || actionCount > 40) {
    issues.push({
      severity: 'major',
      description: `动作指示数量不合规：当前 ${actionCount} 条“△”，要求 25-40 条`,
      suggestion: '补足可拍动作，或合并过细动作'
    })
  }

  if (dialogueCount < 15 || dialogueCount > 25) {
    issues.push({
      severity: 'major',
      description: `对白数量不合规：当前约 ${dialogueCount} 句，要求 15-25 句`,
      suggestion: '调整对白密度，保留短剧推进所需的短对白'
    })
  }

  if (seedanceCount < 9 || seedanceCount > 12) {
    issues.push({
      severity: 'minor',
      description: `Seedance 段落标记数量异常：当前约 ${seedanceCount} 段，建议 9-12 段`,
      suggestion: '在剧本结构中明确 9-12 个可切分的视频段落'
    })
  }

  return {
    passed: issues.length === 0,
    issues
  }
}

function countCjkAwareWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length || 0
  const latin = text.match(/[A-Za-z0-9]+/g)?.length || 0
  return cjk + latin
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length || 0
}

function countDialogueLines(text: string): number {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (/^[△※#\-【]/.test(line)) return false
      return /[：:「」“”]/.test(line)
    }).length
}

function countSeedanceSegments(text: string): number {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /Seedance|分镜段|镜头段|P\d{2}/i.test(line)).length
}
