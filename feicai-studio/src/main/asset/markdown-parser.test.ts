import { describe, expect, it } from 'vitest'
import { getAssetIdentity, getAssetMergeKey, normalizeAssetName, parseAssetMarkdown, serializeAssets } from './markdown-parser'

describe('markdown-parser asset naming', () => {
  it('normalizes whitespace and bracket styles consistently', () => {
    expect(normalizeAssetName(' 江伟 （ 夜战版 ） ')).toBe('江伟(夜战版)')
    expect(normalizeAssetName('LIVING ROOM ( Night )')).toBe('living room(night)')
  })

  it('distinguishes base assets from explicit variants', () => {
    expect(getAssetIdentity('江伟')).toMatchObject({
      baseName: '江伟',
      normalizedBaseName: '江伟',
      kind: 'base'
    })

    expect(getAssetIdentity('客厅（夜）')).toMatchObject({
      baseName: '客厅',
      normalizedBaseName: '客厅',
      variantLabel: '夜',
      normalizedVariantLabel: '夜',
      kind: 'variant'
    })
  })

  it('treats episode annotations as provenance instead of variants', () => {
    expect(getAssetIdentity('宝珠（ep01 新增）')).toMatchObject({
      baseName: '宝珠',
      normalizedBaseName: '宝珠',
      kind: 'base'
    })

    expect(getAssetIdentity('上官玉儿 / 鹂妃（ep01 新增）')).toMatchObject({
      baseName: '上官玉儿 / 鹂妃',
      normalizedBaseName: '上官玉儿 / 鹂妃',
      kind: 'base'
    })
  })

  it('keeps episode-tagged variants independent when annotation explicitly marks a variant', () => {
    expect(getAssetIdentity('上官玉儿·幼年版（ep02 新增·变体 char-001）')).toMatchObject({
      baseName: '上官玉儿·幼年版',
      normalizedBaseName: '上官玉儿·幼年版',
      variantLabel: 'char-001',
      normalizedVariantLabel: 'char-001',
      kind: 'variant'
    })

    expect(getAssetIdentity('上官淳儿·幼年版（ep03 新增·变体 12岁版）')).toMatchObject({
      baseName: '上官淳儿·幼年版',
      normalizedBaseName: '上官淳儿·幼年版',
      variantLabel: '12岁版',
      normalizedVariantLabel: '12岁版',
      kind: 'variant'
    })
  })

  it('uses the same merge key for equivalent base and variant titles', () => {
    expect(getAssetMergeKey('客厅（夜）')).toBe(getAssetMergeKey('客厅(夜)'))
    expect(getAssetMergeKey('宝珠（ep01 新增）')).toBe(getAssetMergeKey('宝珠（ep05 新增）'))
    expect(getAssetMergeKey('江伟')).not.toBe(getAssetMergeKey('江伟（受伤版）'))
  })

  it('serializes parsed assets without duplicating separators', () => {
    const parsed = parseAssetMarkdown(`## 江伟\n\n冷峻、克制。\n\n## 客厅（夜）\n\n昏暗暖光。`)

    expect(serializeAssets(parsed)).toBe(`## 江伟\n\n冷峻、克制。\n\n## 客厅（夜）\n\n昏暗暖光。`)
  })

  it('drops trailing rerun markers and stage headers from parsed prompt bodies', () => {
    const parsed = parseAssetMarkdown(`## 宝珠（ep05 新增）\n\n统一设定。\n\n---\n\n<!-- ep01 新增 -->\n# 人物提示词\n\n## 叶三\n\n侍卫设定。`)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      name: '宝珠（ep05 新增）',
      promptText: '统一设定。'
    })
    expect(parsed[1]).toMatchObject({
      name: '叶三',
      promptText: '侍卫设定。'
    })
  })
})
