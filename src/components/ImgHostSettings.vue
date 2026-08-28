<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { ImgHostConfig } from '../../electron/shared/ipc-channels'

const props = defineProps<{
  /** 是否有已保存的文档（决定是否允许上传图片） */
  hasDoc: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** 请求上传当前文档内的图片（由父组件驱动编辑器重渲染+保存） */
  (e: 'publish'): void
}>()

interface FormState {
  provider: string
  name: string
  endpoint: string
  tokenHeader: string
  token: string
}

const form = reactive<FormState>({
  provider: 'smms',
  name: 'SM.MS',
  endpoint: 'https://sm.ms/api/v2/upload',
  tokenHeader: 'Authorization',
  token: ''
})

const saving = ref(false)
const testing = ref(false)
const msg = ref<{ text: string; type: 'ok' | 'err' | 'info' } | null>(null)

/** 各提供方的默认端点与密钥请求头，切换时填入（仅在用户未改过默认值时覆盖） */
function applyProviderDefaults(): void {
  if (form.provider === 'smms') {
    form.name = 'SM.MS'
    form.endpoint = 'https://sm.ms/api/v2/upload'
    form.tokenHeader = 'Authorization'
  }
}

async function loadConfig(): Promise<void> {
  try {
    const cfg = await window.api.getImgHost()
    if (cfg) {
      form.provider = cfg.provider || 'smms'
      form.name = cfg.name
      form.endpoint = cfg.endpoint
      form.tokenHeader = cfg.tokenHeader
      // 密钥不回传渲染层：token 字段留空表示「沿用已保存密钥」
      form.token = ''
    }
  } catch {
    // 无配置时保持默认
  }
}

async function onSave(): Promise<void> {
  if (!form.endpoint) {
    msg.value = { text: '请填写上传端点', type: 'err' }
    return
  }
  saving.value = true
  msg.value = null
  try {
    const config: ImgHostConfig = {
      provider: form.provider,
      name: form.name || form.provider,
      endpoint: form.endpoint.trim(),
      tokenHeader: form.tokenHeader.trim()
    }
    // token 为空字符串 → 主进程沿用已有密钥；非空 → 覆盖加密保存
    await window.api.setImgHost(config, form.token)
    msg.value = { text: '图床配置已保存（密钥已加密）', type: 'ok' }
    form.token = ''
  } catch (e) {
    msg.value = { text: `保存失败：${e instanceof Error ? e.message : String(e)}`, type: 'err' }
  } finally {
    saving.value = false
  }
}

async function onTest(): Promise<void> {
  if (!form.endpoint) {
    msg.value = { text: '请先填写上传端点', type: 'err' }
    return
  }
  testing.value = true
  msg.value = { text: '检测中…', type: 'info' }
  try {
    const cfg: ImgHostConfig = {
      provider: form.provider,
      name: form.name || form.provider,
      endpoint: form.endpoint.trim(),
      tokenHeader: form.tokenHeader.trim()
    }
    // 先把当前填写的配置（含密钥）落盘，再走空文档发布校验通道是否可用
    await window.api.setImgHost(cfg, form.token)
    form.token = ''
    await window.api.publishImages('', null)
    msg.value = { text: '图床通道可用', type: 'ok' }
  } catch (e) {
    msg.value = { text: `通道异常：${e instanceof Error ? e.message : String(e)}`, type: 'err' }
  } finally {
    testing.value = false
  }
}

function onPublish(): void {
  emit('publish')
}

onMounted(() => {
  void loadConfig()
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog jade">
      <header class="dialog__head">
        <h2 class="dialog__title">图床设置</h2>
        <button class="dialog__x" title="关闭" @click="emit('close')">×</button>
      </header>

      <div class="dialog__body">
        <label class="field">
          <span class="field__label">图床服务</span>
          <select v-model="form.provider" class="field__input" @change="applyProviderDefaults">
            <option value="smms">SM.MS</option>
            <option value="custom">自定义（兼容 PicGo）</option>
          </select>
        </label>

        <label class="field">
          <span class="field__label">展示名称</span>
          <input v-model="form.name" class="field__input" placeholder="SM.MS" />
        </label>

        <label class="field">
          <span class="field__label">上传端点</span>
          <input v-model="form.endpoint" class="field__input" placeholder="https://sm.ms/api/v2/upload" />
        </label>

        <label class="field">
          <span class="field__label">密钥请求头</span>
          <input v-model="form.tokenHeader" class="field__input" placeholder="Authorization" />
        </label>

        <label class="field">
          <span class="field__label">密钥 / Token</span>
          <input
            v-model="form.token"
            class="field__input"
            type="password"
            autocomplete="new-password"
            placeholder="留空 = 沿用已保存密钥"
          />
          <span class="field__hint">密钥仅在主进程经 safeStorage 加密保存，不会下发到渲染层。</span>
        </label>

        <p v-if="msg" class="feedback" :class="`feedback--${msg.type}`">{{ msg.text }}</p>
      </div>

      <footer class="dialog__foot">
        <button class="btn" :disabled="!hasDoc" :title="hasDoc ? '' : '请先保存文档'" @click="onPublish">
          上传当前文档图片
        </button>
        <button class="btn" :disabled="testing" @click="onTest">检测通道</button>
        <button class="btn btn--primary" :disabled="saving" @click="onSave">保存配置</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
}

.dialog {
  width: min(440px, 92vw);
  max-height: 86vh;
  overflow: auto;
  border-radius: 14px;
  padding: 18px 20px 16px;
  background: var(--hue-editor, #1c1e1f);
  border: 1px solid var(--hue-border-strong, var(--hue-border-subtle));
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
}

.dialog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.dialog__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--hue-text-1);
}

.dialog__x {
  border: none;
  background: transparent;
  color: var(--hue-text-3);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.dialog__x:hover {
  color: var(--hue-text-1);
}

.dialog__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field__label {
  font-size: 12px;
  color: var(--hue-text-2);
}

.field__input {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--hue-border-subtle);
  background: var(--hue-highlight, rgba(255, 255, 255, 0.04));
  color: var(--hue-text-1);
  font-size: 13px;
  outline: none;
}

.field__input:focus {
  border-color: var(--hue-accent);
}

select.field__input {
  cursor: pointer;
}

.field__hint {
  font-size: 11px;
  color: var(--hue-text-3);
  line-height: 1.4;
}

.feedback {
  margin: 2px 0 0;
  font-size: 12px;
  padding: 7px 10px;
  border-radius: 8px;
}

.feedback--ok {
  color: var(--hue-success, #3cb48c);
  background: rgba(60, 180, 140, 0.12);
}

.feedback--err {
  color: #f3b4af;
  background: rgba(224, 79, 69, 0.14);
}

.feedback--info {
  color: var(--hue-text-2);
  background: var(--hue-highlight, rgba(255, 255, 255, 0.05));
}

.dialog__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  font-size: 12px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--hue-border-subtle);
  background: var(--hue-highlight, rgba(255, 255, 255, 0.05));
  color: var(--hue-text-1);
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  border-color: var(--hue-border-strong, var(--hue-accent));
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn--primary {
  background: var(--hue-accent, #248077);
  border-color: transparent;
  color: #fff;
  font-weight: 500;
}

.btn--primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
</style>
