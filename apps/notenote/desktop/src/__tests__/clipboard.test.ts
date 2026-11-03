import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext, type MockContext } from './mockContext'
import { initApi, api } from '../api'

describe('clipboard integration', () => {
  let mock: MockContext

  beforeEach(() => {
    mock = createMockContext()
    initApi(mock.context)
  })

  describe('clipboardRead', () => {
    it('空剪贴板返回 null', async () => {
      const result = await api.clipboardRead()
      expect(result.text).toBeNull()
    })

    it('调用正确的命令', async () => {
      await api.clipboardRead()
      expect(mock.calls).toHaveLength(1)
      expect(mock.calls[0].command).toBe('notenote.clipboard.read')
      expect(mock.calls[0].args).toEqual({})
    })

    it('返回已写入的文本', async () => {
      mock.clipboardText = 'hello from clipboard'
      const result = await api.clipboardRead()
      expect(result.text).toBe('hello from clipboard')
    })
  })

  describe('clipboardWrite', () => {
    it('写入文本到剪贴板', async () => {
      const result = await api.clipboardWrite('copied text')
      expect(result.written).toBe(true)
      expect(mock.clipboardText).toBe('copied text')
    })

    it('调用正确的命令和参数', async () => {
      await api.clipboardWrite('test')
      expect(mock.calls).toHaveLength(1)
      expect(mock.calls[0].command).toBe('notenote.clipboard.write')
      expect(mock.calls[0].args).toEqual({ text: 'test' })
    })

    it('写入空字符串', async () => {
      const result = await api.clipboardWrite('')
      expect(result.written).toBe(true)
      expect(mock.clipboardText).toBe('')
    })

    it('覆盖已有内容', async () => {
      mock.clipboardText = 'old content'
      await api.clipboardWrite('new content')
      expect(mock.clipboardText).toBe('new content')
    })
  })

  describe('读写往返', () => {
    it('写入后读取返回相同内容', async () => {
      await api.clipboardWrite('round-trip text')
      const result = await api.clipboardRead()
      expect(result.text).toBe('round-trip text')
    })

    it('多次写入后读取返回最后一次', async () => {
      await api.clipboardWrite('first')
      await api.clipboardWrite('second')
      await api.clipboardWrite('third')
      const result = await api.clipboardRead()
      expect(result.text).toBe('third')
    })

    it('写入含换行和特殊字符的文本', async () => {
      const multiline = '# Title\n\n- item 1\n- item 2\n\n```\ncode block\n```'
      await api.clipboardWrite(multiline)
      const result = await api.clipboardRead()
      expect(result.text).toBe(multiline)
    })
  })
})
