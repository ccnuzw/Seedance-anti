import { readFileSync } from 'node:fs'

// Fill the shipped template rather than maintaining a second format in tests.
const template = readFileSync(
  new URL(
    '../../../resources/builtin-skills/seedance-storyboard-skill/templates/seedance-prompts-template.md',
    import.meta.url
  ),
  'utf8'
)
export const storyboard = template
  .match(/```markdown\n([\s\S]*?)\n```/)![1]
  .replace('[根据01讲戏本填入]', '10')
  .replace('[X]', '6.5')
  .replaceAll(
    '[人物名，参见 character-prompts.md]',
    '[林舟，参见 character-prompts.md]'
  )
  .replaceAll(
    '[场景名，参见 scene-prompts.md]',
    '[院子，参见 scene-prompts.md]'
  )
  .replace(
    /\[完整的[\s\S]*?视频。\]/,
    '以@图片1中的林舟为主角，场景参考@图片3。\n0-3秒：进入院子。\n3-6秒：环绕@图片1。\n6-10秒：定格，配乐参考@音频1。'
  )
  .replace('[...]', '参考@图片2和@图片4，@视频1提供运镜参考。')

export const script = [
  '※ 场景1 院子 日',
  ...Array.from(
    { length: 9 },
    (_, i) => `Seedance P${String(i + 1).padStart(2, '0')}`
  ),
  ...Array.from({ length: 25 }, (_, i) => `△ 动作${i + 1}，推进冲突。`),
  '※ 场景2 大厅 日',
  '※ 场景3 街道 夜',
  ...Array.from({ length: 15 }, (_, i) => `林舟：第${i + 1}句对白。`),
  '【卡黑】'
].join('\n')
export const art =
  '# 人物提示词\n\n## 林舟\n\n灰色外套。\n\n# 场景道具提示词\n\n## 院子\n\n白日院落。'
export const pass = JSON.stringify({
  result: 'PASS',
  score: 9,
  feedback: '受控审核通过',
  issues: []
})
