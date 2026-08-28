import { computed, ref } from 'vue'

/**
 * Markdown 往返保真。
 *
 * 问题：Milkdown 经 remark 序列化，会把用户手写的 Markdown 规范化
 * （*斜体* → _斜体_、- 列表 → * 列表、Setext 标题 → ATX 标题）。
 * 对会把笔记推 Git 的技术写作者来说，这会产生大片无意义的 diff。
 *
 * 策略：维护三态，只在「确实在所见即所得模式下编辑过」时才允许规范化输出。
 * - rawText：磁盘原文，一字不改
 * - docText：编辑器序列化结果
 * - isDirty：是否在 WYSIWYG 中产生过编辑事务
 */
export function useFidelity() {
  const rawText = ref('')
  const docText = ref('')
  const isDirty = ref(false)

  /** 从磁盘载入：以原文为准 */
  function loadFromDisk(text: string): void {
    rawText.value = text
    docText.value = text
    isDirty.value = false
  }

  /**
   * WYSIWYG 模式下内容变化：记录序列化结果。
   * 仅当序列化结果「确实不同于磁盘原文」时才标记为脏 —— 否则切模式、
   * 导出前同步源码等「灌入相同文本」的操作会误触发未保存状态。
   */
  function markEdited(markdown: string): void {
    docText.value = markdown
    isDirty.value = markdown !== rawText.value
  }

  /**
   * 源码模式下编辑：直接作为原文。
   * 不经过序列化，因此不产生规范化。
   */
  function onSourceEdited(text: string): void {
    rawText.value = text
    docText.value = text
    isDirty.value = false
  }

  /** 保存成功后：把当前内容固化为新的原文 */
  function afterSave(): void {
    rawText.value = currentText.value
    isDirty.value = false
  }

  /** 当前应写入磁盘的内容 */
  const currentText = computed(() => (isDirty.value ? docText.value : rawText.value))

  /** 是否会发生排版规范化（用于在状态栏给用户提示） */
  const willNormalize = computed(() => isDirty.value)

  return {
    rawText,
    docText,
    isDirty,
    currentText,
    willNormalize,
    loadFromDisk,
    markEdited,
    onSourceEdited,
    afterSave
  }
}
