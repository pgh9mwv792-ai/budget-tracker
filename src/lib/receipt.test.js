import { describe, it, expect } from 'vitest'
import { parseJson } from './receipt'

describe('parseJson', () => {
  it('parses clean JSON', () => {
    expect(parseJson('{"product":"D3","ingredients":[]}')).toEqual({
      product: 'D3',
      ingredients: [],
    })
  })

  it('strips ```json fences', () => {
    const text = '```json\n{"product":"D3"}\n```'
    expect(parseJson(text)).toEqual({ product: 'D3' })
  })

  it('ignores a prose preamble before the object', () => {
    const text = 'Here is the JSON you asked for:\n\n{"product":"Zinc"}'
    expect(parseJson(text)).toEqual({ product: 'Zinc' })
  })

  it('extracts the object when trailing prose follows it', () => {
    const text = '{"product":"Zinc"}\n\nLet me know if you need anything else.'
    expect(parseJson(text)).toEqual({ product: 'Zinc' })
  })

  it('salvages a reply truncated mid-object by closing open braces', () => {
    // The model hit max_tokens partway through the ingredient list.
    const text = '{"product":"Multi","ingredients":[{"name":"Vitamin C","amount":90'
    const parsed = parseJson(text)
    expect(parsed).not.toBeNull()
    expect(parsed.product).toBe('Multi')
    expect(parsed.ingredients[0]).toEqual({ name: 'Vitamin C', amount: 90 })
  })

  it('drops a dangling trailing comma when repairing truncation', () => {
    const text = '{"ingredients":[{"name":"Zinc","amount":15},'
    const parsed = parseJson(text)
    expect(parsed).not.toBeNull()
    expect(parsed.ingredients).toEqual([{ name: 'Zinc', amount: 15 }])
  })

  it('returns null for input with no object', () => {
    expect(parseJson('sorry, I cannot read this image')).toBeNull()
    expect(parseJson('')).toBeNull()
    expect(parseJson(null)).toBeNull()
  })

  it('does not confuse braces inside strings', () => {
    const text = '{"note":"contains { and } characters","ok":true}'
    expect(parseJson(text)).toEqual({ note: 'contains { and } characters', ok: true })
  })
})
