<template>
  <div class="h-full flex flex-col bg-[var(--bg-page)]" data-testid="pairing-view">
    <!-- ==================== 工具栏页头：左标题+IP:端口，右刷新/生成 ==================== -->
    <div class="wb-toolbar">
      <div class="flex items-center gap-3">
        <h2 class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]">
          {{ t('pairing.sidebar.title') }}
        </h2>
        <span class="wb-mono text-[calc(12px*var(--ui-scale))] text-[var(--text-tertiary)]"
          >{{ displayIp }}:{{ port }}</span
        >
      </div>
      <div class="flex items-center gap-2">
        <button class="wb-btn-ghost" @click="refreshAll">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
            />
          </svg>
          {{ t('pairing.button.refresh') }}
        </button>
        <button class="wb-btn-primary" :disabled="isGenerating" @click="generateCode">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          {{ t('pairing.code.generate') }}
        </button>
      </div>
    </div>

    <!-- ==================== Tab 切换：设备配对 / 设备列表 ==================== -->
    <!-- Tab 区规格与 Agent任务（TaskHistoryView）同款，三点对齐：
         ① 满宽分段控件（容器 flex + 单项 flex-1 等分），不是收缩条；
         ② tab 带自身带底边线 + 卡片底色，与下方内容区物理分开；
         ③ 水平内边距 px-6 与内容列同宽，tab 条左右缘与卡片对齐。
         早前是 inline-flex 收缩条浮在页面底色上（整条 172px、两项各 80px），
         读起来像一对工具按钮而不是页签导航。 -->
    <div class="px-6 pt-3 pb-3 flex-shrink-0 bg-[var(--bg-card)] border-b border-[var(--border)]">
      <div class="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-hover)]" role="tablist">
        <button
          v-for="tab in deviceTabs"
          :key="tab.key"
          class="flex-1 h-8 rounded-md text-[calc(12px*var(--ui-scale))] font-medium transition-colors duration-200"
          :class="
            activeTab === tab.key
              ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          "
          role="tab"
          :aria-selected="activeTab === tab.key"
          :data-testid="`pairing-tab-${tab.key}`"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- ==================== 认证中心未就绪横幅（ADR 0031 欠账 / 票 08 §8.1） ==================== -->
    <!-- 置顶且**不随 Tab 切换隐藏**：fail-closed 的失败发生在入站方向，与用户当前
         看哪个 Tab 无关；且此时本页其余功能（配对码生成等）**照常可用**，
         没有横幅就会出现「配对成功但手机连不上」且界面无任何解释的静默失败。 -->
    <div
      v-if="centerStatusError"
      class="mx-6 mt-4 mb-0 rounded-[10px] border px-4 py-3 flex items-start gap-3"
      :class="
        centerStatusError === 'not_ready'
          ? 'border-[var(--color-danger)] bg-[var(--color-danger-light)]'
          : 'border-[var(--border-strong)] bg-[var(--bg-card)]'
      "
    >
      <span
        class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
        :class="
          centerStatusError === 'not_ready'
            ? 'bg-[var(--color-danger)]'
            : 'bg-[var(--text-tertiary)]'
        "
      ></span>
      <div class="min-w-0 flex-1">
        <template v-if="centerStatusError === 'not_ready'">
          <p class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--color-danger)]">
            {{ t('pairing.center.notReadyTitle') }}
          </p>
          <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)] mt-0.5">
            {{ t('pairing.center.notReadyDesc') }}
          </p>
          <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-tertiary)] mt-1">
            {{ t('pairing.center.rebuildHint') }}
          </p>
        </template>
        <!-- 状态未知：**不**给「重建产物」指引——那是未就位的修法，
             状态读不到是另一类问题，给错指引会把排障方向带偏 -->
        <template v-else>
          <p class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-secondary)]">
            {{ t('pairing.center.statusUnknown') }}
          </p>
        </template>
      </div>
    </div>

    <div
      ref="tabScrollRef"
      data-testid="pairing-tab-scroll"
      class="page-swap pairing-tab-swap flex-1 overflow-auto"
    >
      <Transition name="page">
        <!-- ==================== Tab1 设备配对 · 网络信息 + 配对码 + QR（各占一行） ==================== -->
        <div v-if="activeTab === 'pairing'" class="space-y-5 px-6 py-5">
          <!-- ==================== 网络信息条（置顶） ==================== -->
          <div
            class="rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2.5 flex items-center gap-3 flex-wrap"
          >
            <span class="text-[calc(11px*var(--ui-scale))] font-medium text-[var(--text-tertiary)]">
              {{ t('pairing.network.title') }}
            </span>
            <span class="text-[var(--border)]">|</span>
            <span class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)]">{{
              t('pairing.network.ipv4Address')
            }}</span>
            <!-- 固定宽度：行内条带布局，避免 Select 块级根元素撑满整行 -->
            <Select
              :model-value="selectedHost || ''"
              :options="ipOptions"
              :placeholder="t('pairing.network.notSelected')"
              size="sm"
              class="wb-mono w-[200px]"
              @update:model-value="handleIpSelect"
            />
            <span class="text-[var(--border)]">·</span>
            <span class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)]">{{
              t('pairing.network.websocketPort')
            }}</span>
            <span class="wb-mono text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">{{
              port
            }}</span>
            <span class="text-[var(--border)]">·</span>
            <!-- T07：传输模式（内网直连 / 外网中继 / 不可达 / 离线），只读投影 -->
            <span
              data-testid="pairing-tunnel-status"
              class="inline-flex items-center gap-1.5 text-[calc(12px*var(--ui-scale))]"
              :class="tunnelToneClass"
              :title="tunnel.summary.value.detail || t('pairing.tunnel.title')"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="tunnelDotClass"></span>
              {{ tunnelLabel }}
            </span>
            <!-- T18：中心不可用的显性提示（正在用缓存 / 完全取不到），不把降级藏起来 -->
            <span
              v-if="tunnel.relayError.value"
              data-testid="pairing-tunnel-relay-source"
              class="inline-flex items-center px-1.5 h-5 rounded-[6px] bg-[var(--color-warning-light)] text-[var(--color-warning)] text-[calc(11px*var(--ui-scale))]"
              :title="tunnel.relayError.value"
            >
              {{
                tunnel.relay.value?.source === 'cache'
                  ? t('pairing.tunnel.relayCache')
                  : t('pairing.tunnel.relayCenterUnavailable')
              }}
            </span>
            <!-- T18：WAN 注册表读不到 → 策略按默认 true 继续，但原因必须可见 -->
            <span
              v-if="tunnel.wanPolicyError.value"
              data-testid="pairing-tunnel-wan-policy-error"
              class="inline-flex items-center px-1.5 h-5 rounded-[6px] bg-[var(--color-warning-light)] text-[var(--color-warning)] text-[calc(11px*var(--ui-scale))]"
              :title="tunnel.wanPolicyError.value"
            >
              {{ t('pairing.tunnel.wanPolicyUnreadable') }}
            </span>
            <!-- 加密是常量事实（不变量 12/14）：没有关闭入口，故只显示徽标 -->
            <span
              data-testid="pairing-tunnel-encryption"
              class="inline-flex items-center px-1.5 h-5 rounded-[6px] bg-[var(--color-success-light)] text-[var(--color-success)] text-[calc(11px*var(--ui-scale))]"
              :title="t('pairing.tunnel.encryptionHint')"
            >
              {{ t('pairing.tunnel.encryption') }}
            </span>
            <span
              v-if="addresses.length === 0"
              class="text-[calc(12px*var(--ui-scale))] text-[var(--text-tertiary)] ml-auto"
            >
              {{ t('pairing.network.noIpv4') }}
            </span>
          </div>

          <!-- ==================== 配对码卡片（内容居中，旧版样式） ==================== -->
          <div
            class="rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-5 flex flex-col"
          >
            <div class="flex items-center justify-between gap-3 mb-4">
              <div class="min-w-0">
                <h4
                  class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
                >
                  {{ t('pairing.code.title') }}
                </h4>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <button
                  v-if="pairingCode"
                  class="wb-btn-ghost !h-7 !px-2.5 text-[calc(11px*var(--ui-scale))]"
                  @click="cancelPairing"
                >
                  {{ t('pairing.button.cancel') }}
                </button>
                <button
                  v-else
                  class="wb-btn-primary !h-7 !px-2.5 text-[calc(11px*var(--ui-scale))]"
                  :disabled="isGenerating"
                  @click="generateCode"
                >
                  {{ t('pairing.code.generate') }}
                </button>
                <span
                  v-if="pairingCode"
                  class="wb-mono text-[calc(11px*var(--ui-scale))] inline-flex items-center gap-1.5 px-2 h-5 rounded-[6px] bg-[var(--color-success-light)] text-[var(--color-success)]"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]"></span>
                  {{ remainingSeconds }}{{ t('pairing.time.seconds') }}
                </span>
              </div>
            </div>

            <div class="flex flex-col items-center text-center">
              <template v-if="pairingCode">
                <p
                  class="font-mono text-[calc(36px*var(--ui-scale))] font-bold tracking-[0.15em] text-[var(--text-primary)] select-all break-all text-center px-2 mb-4"
                  data-testid="pairing-code"
                >
                  {{ pairingCode.code }}
                </p>
                <p
                  class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
                >
                  {{ t('pairing.code.hint') }}
                </p>
              </template>
              <template v-else>
                <div
                  class="w-[168px] h-[168px] rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-page)] flex flex-col items-center justify-center text-center px-3 gap-1.5 mb-4"
                >
                  <svg
                    class="w-7 h-7 text-[var(--text-tertiary)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.5"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <p
                    class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] leading-tight"
                  >
                    {{ t('pairing.code.placeholder') }}
                  </p>
                </div>
                <p
                  class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
                >
                  {{ t('pairing.code.hint') }}
                </p>
              </template>
            </div>
          </div>

          <!-- ==================== QR 码卡片（标题 + 紧凑内部分页；每页各自出码） ==================== -->
          <div
            class="rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-5 flex flex-col"
          >
            <!-- 标题行：内部分页紧贴标题、宽度只贴合文本（不铺满卡片）；
                 生成 / 取消 / 倒计时下沉到各页内容区——两页的出码条件不同，
                 共用一颗按钮会让「外网页点了没码」看不出是谁的问题 -->
            <div class="flex items-center gap-3 mb-4 flex-wrap" data-testid="pairing-qr-header">
              <h4
                class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
              >
                {{ t('pairing.qr.title') }}
              </h4>
              <div
                class="inline-flex w-auto shrink-0 items-center gap-0.5 p-0.5 rounded-lg bg-[var(--bg-hover)]"
                role="tablist"
              >
                <button
                  v-for="tab in qrTabs"
                  :key="tab.key"
                  class="h-6 px-2.5 rounded-md whitespace-nowrap text-[calc(11px*var(--ui-scale))] font-medium transition-colors duration-200"
                  :class="
                    activeQrTab === tab.key
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  "
                  role="tab"
                  :aria-selected="activeQrTab === tab.key"
                  :data-testid="`pairing-qr-tab-${tab.key}`"
                  @click="selectQrTab(tab.key)"
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>

            <div class="flex flex-col items-center text-center">
              <!-- 本页独立操作行：按钮文案 / 倒计时只反映本页能否出码；
                   取消按共享 token 判断——两页用的是同一份 QR 会话，任一页都能撤销 -->
              <div class="flex items-center gap-2 mb-4">
                <button
                  v-if="hasQr"
                  class="wb-btn-ghost !h-7 !px-2.5 text-[calc(11px*var(--ui-scale))]"
                  :data-testid="`pairing-qr-cancel-${activeQrTab}`"
                  @click="clearQr"
                >
                  {{ t('pairing.button.cancel') }}
                </button>
                <button
                  class="wb-btn-primary !h-7 !px-2.5 text-[calc(11px*var(--ui-scale))]"
                  :data-testid="`pairing-qr-generate-${activeQrTab}`"
                  :disabled="isQrLoading"
                  @click="handleGenerateQr(activeQrTab)"
                >
                  {{ qrGenerateLabel }}
                </button>
                <span
                  v-if="qrTabRenderable"
                  class="wb-mono text-[calc(11px*var(--ui-scale))] inline-flex items-center gap-1.5 px-2 h-5 rounded-[6px] bg-[var(--color-success-light)] text-[var(--color-success)]"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]"></span>
                  {{ qrRemainingSeconds }}{{ t('pairing.time.seconds') }}
                </span>
              </div>

              <template v-if="qrTabRenderable">
                <!-- 白底衬底保证二维码在暗色模式下可读 -->
                <div
                  class="inline-block bg-white p-3 rounded-lg border border-[var(--border)] mb-4"
                >
                  <canvas ref="qrCanvasRef" class="block"></canvas>
                </div>
                <p
                  class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
                >
                  {{ t('pairing.qr.hint') }}
                </p>
                <p class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] mt-1.5">
                  {{ t('pairing.qr.singleUse') }}
                </p>
                <button
                  data-testid="pairing-qr-copy-link"
                  class="wb-btn-ghost !h-7 !px-2.5 mt-3 text-[calc(11px*var(--ui-scale))]"
                  @click="copyPairUri"
                >
                  {{ t('pairing.qr.copyLink') }}
                </button>
              </template>
              <template v-else>
                <div
                  class="w-[168px] h-[168px] rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-page)] flex flex-col items-center justify-center text-center px-3 gap-1.5 mb-4"
                >
                  <svg
                    class="w-7 h-7 text-[var(--text-tertiary)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.5"
                      d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.5"
                      d="M6.75 6.75h.008v.008H6.75V6.75zM6.75 16.5h.008v.008H6.75V16.5zM16.5 6.75h.008v.008H16.5V6.75zM13.5 13.5h.008v.008H13.5V13.5zM13.5 19.5h.008v.008H13.5V19.5zM19.5 13.5h.008v.008H19.5V13.5zM19.5 19.5h.008v.008H19.5V19.5zM16.5 16.5h.008v.008H16.5V16.5z"
                    />
                  </svg>
                  <p
                    class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] leading-tight"
                  >
                    {{ t('pairing.qr.placeholder') }}
                  </p>
                </div>
                <p
                  class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
                >
                  {{ t('pairing.qr.hint') }}
                </p>
                <!-- 外网 Tab：隧道码不可出的显性原因（局域网 Tab 无此失败路径） -->
                <p
                  v-if="activeQrTab === 'wan' && hasQr && qrWanErrorText"
                  data-testid="pairing-qr-error"
                  class="mt-1.5 text-[calc(11px*var(--ui-scale))] text-[var(--color-danger)] leading-relaxed"
                >
                  {{ qrWanErrorText }}
                </p>
              </template>

              <!-- 生成动作本身失败（命令面报错）：必须上屏 + 详情进 title，不留白也不假装成功 -->
              <p
                v-if="qrGenerateError"
                data-testid="pairing-qr-generate-error"
                class="mt-2 text-[calc(11px*var(--ui-scale))] text-[var(--color-danger)] leading-relaxed"
                :title="qrGenerateError"
              >
                {{ t('pairing.qr.generateFailed') }}
              </p>

              <!-- T18 / T08：外网能力提示（只在外网 Tab 展示：说明该码的外网可达性） -->
              <p
                v-if="activeQrTab === 'wan' && qrRelayError"
                data-testid="pairing-qr-relay-error"
                class="mt-2 text-[calc(11px*var(--ui-scale))] text-[var(--color-warning)] leading-relaxed"
                :title="qrRelayError"
              >
                {{ t('pairing.qr.relayDegraded', { message: qrRelayError }) }}
              </p>
              <p
                v-if="activeQrTab === 'wan' && qrWanDisabled"
                data-testid="pairing-qr-wan-disabled"
                class="mt-2 text-[calc(11px*var(--ui-scale))] text-[var(--color-warning)] leading-relaxed"
              >
                {{ t('pairing.qr.wanDisabled') }}
              </p>
              <!-- T08：隧道 peer 未产出 → 无外网码，原因必须可见 -->
              <p
                v-if="activeQrTab === 'wan' && qrPeerError"
                data-testid="pairing-qr-peer-error"
                class="mt-2 text-[calc(11px*var(--ui-scale))] text-[var(--color-warning)] leading-relaxed"
                :title="qrPeerError"
              >
                {{ t('pairing.tunnel.onlyLan') }}
              </p>
            </div>
          </div>
        </div>

        <!-- ==================== Tab2 设备列表 · 在线 / 离线 ==================== -->
        <div v-else class="space-y-6 px-6 py-5" data-testid="pairing-devices-panel">
          <!-- ==================== ONLINE 分区 ==================== -->
          <section>
            <h3 class="wb-section-title">
              {{ t('pairing.device.sectionOnline') }}
              <span class="text-[var(--text-tertiary)]">·</span> {{ onlineDevices.length }}
            </h3>
            <p
              v-if="onlineDevices.length === 0"
              class="wb-mono text-[calc(12px*var(--ui-scale))] text-[var(--text-tertiary)] px-1 py-2"
            >
              {{ t('pairing.empty.noData') }}
            </p>
            <div v-else class="space-y-2">
              <article
                v-for="device in onlineDevices"
                :key="device.id"
                data-testid="paired-device-row"
                class="px-4 py-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] hover:shadow-sm transition-shadow"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <span class="w-2 h-2 rounded-full shrink-0 bg-[var(--color-success)]"></span>
                  <p
                    class="flex-1 min-w-0 text-[calc(13px*var(--ui-scale))] font-medium text-[var(--text-primary)] truncate"
                  >
                    {{ device.deviceName }}
                  </p>
                  <span
                    class="wb-mono text-[calc(11px*var(--ui-scale))] inline-flex items-center gap-1.5 px-2 h-5 rounded-[6px] bg-[var(--color-success-light)] text-[var(--color-success)]"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]"></span>
                    {{ t('pairing.device.connected') }}
                  </span>
                  <span
                    class="wb-mono text-[calc(12.5px*var(--ui-scale))] text-[var(--text-primary)]"
                    >{{ device.address }}</span
                  >
                  <button
                    class="h-7 px-2.5 rounded-[6px] border border-[var(--border)] wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                    @click="viewHistory(device.id)"
                  >
                    {{ t('pairing.device.historyView') }}
                  </button>
                  <button
                    class="h-7 px-2.5 rounded-[6px] border border-transparent wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] hover:border-[var(--border)] hover:text-[var(--color-danger-ink)] transition-colors"
                    @click="removeDevice(device.id)"
                  >
                    {{ t('pairing.button.remove') }}
                  </button>
                </div>
                <div
                  class="mt-2 pl-5 flex items-center gap-2 flex-wrap text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
                >
                  <span>{{
                    t('pairing.device.pairedAt', { date: formatDate(device.pairedAt) })
                  }}</span>
                  <template v-if="device.lastSeen">
                    <span class="text-[var(--border)]">·</span>
                    <span>{{
                      t('pairing.device.lastSeen', { date: formatDate(device.lastSeen) })
                    }}</span>
                  </template>
                  <span class="text-[var(--border)]">·</span>
                  <span>{{
                    t('pairing.device.connectCount', { count: device.connectCount })
                  }}</span>
                </div>
              </article>
            </div>
          </section>

          <!-- ==================== OFFLINE 分区 ==================== -->
          <section>
            <h3 class="wb-section-title">
              {{ t('pairing.device.sectionOffline') }}
              <span class="text-[var(--text-tertiary)]">·</span> {{ offlineDevices.length }}
            </h3>
            <p
              v-if="offlineDevices.length === 0"
              class="wb-mono text-[calc(12px*var(--ui-scale))] text-[var(--text-tertiary)] px-1 py-2"
            >
              {{ t('pairing.empty.noData') }}
            </p>
            <div v-else class="space-y-2">
              <article
                v-for="device in offlineDevices"
                :key="device.id"
                data-testid="paired-device-row"
                class="px-4 py-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] hover:shadow-sm transition-shadow"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <span class="w-2 h-2 rounded-full shrink-0 bg-[var(--text-tertiary)]"></span>
                  <p
                    class="flex-1 min-w-0 text-[calc(13px*var(--ui-scale))] font-medium text-[var(--text-secondary)] truncate"
                  >
                    {{ device.deviceName }}
                  </p>
                  <span
                    class="wb-mono text-[calc(11px*var(--ui-scale))] inline-flex items-center gap-1.5 px-2 h-5 rounded-[6px] bg-[var(--bg-hover)] text-[var(--text-tertiary)]"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)]"></span>
                    {{ t('pairing.device.offline') }}
                  </span>
                  <span
                    class="wb-mono text-[calc(12.5px*var(--ui-scale))] text-[var(--text-primary)]"
                    >{{ device.address }}</span
                  >
                  <button
                    class="h-7 px-2.5 rounded-[6px] border border-[var(--border)] wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                    @click="viewHistory(device.id)"
                  >
                    {{ t('pairing.device.historyView') }}
                  </button>
                  <button
                    class="h-7 px-2.5 rounded-[6px] border border-transparent wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] hover:border-[var(--border)] hover:text-[var(--color-danger-ink)] transition-colors"
                    @click="removeDevice(device.id)"
                  >
                    {{ t('pairing.button.remove') }}
                  </button>
                </div>
                <div
                  class="mt-2 pl-5 flex items-center gap-2 flex-wrap text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
                >
                  <span>{{
                    t('pairing.device.pairedAt', { date: formatDate(device.pairedAt) })
                  }}</span>
                  <template v-if="device.lastSeen">
                    <span class="text-[var(--border)]">·</span>
                    <span>{{
                      t('pairing.device.lastSeen', { date: formatDate(device.lastSeen) })
                    }}</span>
                  </template>
                  <span class="text-[var(--border)]">·</span>
                  <span>{{
                    t('pairing.device.connectCount', { count: device.connectCount })
                  }}</span>
                </div>
              </article>
            </div>
          </section>

          <!-- ==================== 入场密钥轮换（ADR 0033 D4） ==================== -->
          <section>
            <h3 class="wb-section-title">{{ t('pairing.key.sectionTitle') }}</h3>
            <div
              class="px-4 py-3.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-between gap-4"
            >
              <p
                class="flex-1 min-w-0 text-[calc(12px*var(--ui-scale))] text-[var(--text-tertiary)]"
              >
                {{ t('pairing.key.description') }}
              </p>
              <button
                class="h-8 px-3 rounded-[6px] border border-[var(--border)] wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="isRotatingKey"
                @click="showRotateKeyDialog = true"
              >
                {{ t('pairing.key.rotate') }}
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </div>

    <!-- 移除设备确认 -->
    <PluginModal
      v-model="showRemoveDeviceDialog"
      :title="t('pairing.device.confirmRemove')"
      size="sm"
    >
      <p class="text-[var(--text-primary)] text-[calc(13px*var(--ui-scale))]">
        {{ t('pairing.device.confirmRemoveMsg') }}
      </p>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="wb-btn-ghost" @click="showRemoveDeviceDialog = false">
            {{ t('pairing.button.cancel') }}
          </button>
          <button class="wb-btn-primary bg-[var(--color-danger)]" @click="confirmRemoveDevice">
            {{ t('pairing.button.remove') }}
          </button>
        </div>
      </template>
    </PluginModal>
    <!-- 轮换入场密钥确认 -->
    <PluginModal v-model="showRotateKeyDialog" :title="t('pairing.key.confirmTitle')" size="sm">
      <p class="text-[var(--text-primary)] text-[calc(13px*var(--ui-scale))]">
        {{ t('pairing.key.confirmMsg') }}
      </p>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="wb-btn-ghost" @click="showRotateKeyDialog = false">
            {{ t('pairing.button.cancel') }}
          </button>
          <button class="wb-btn-primary" :disabled="isRotatingKey" @click="confirmRotateKey">
            {{ t('pairing.key.rotate') }}
          </button>
        </div>
      </template>
    </PluginModal>
  </div>
</template>

<script setup lang="ts">
/**
 * DeviceCenterView — 设备与配对页面（宿主 `DevicesView.vue` 的插件版，票 14）
 *
 * What to build（票面）：设备配对 / 已配对设备两块视图搬入插件并经侧边栏目录承载，
 * 位置与外观不变；配对码展示与倒计时、QR 生成、设备撤销确认全在插件内完成。
 *
 * 与宿主原页的刻意差异（票内记录）：
 * - 取数只走插件命令通道与 PluginContext（spec D2）：宿主 `generate_pairing_code` /
 *   `list_paired_devices` 等命令面是宿主 UI 的兼容接缝，插件不得直调（C4 强校验）；
 * - 用户选择的对外 IP 落插件存储（宿主原为 `AppConfig.network.qr_host`）——QR 载荷
 *   的 host 由插件传入，线协议形状不变；
 * - 宿主 `PluginPageToolbar target="devices"` 不再渲染（宿主原页让位后挂载点消失），
 *   与票 13 会话页同一处置。
 */
import { computed, inject, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import QRCode from 'qrcode'
import Select from '@binblink/wasmnest-plugin-sdk-desktop/ui'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { sharedRouter } from '../utils/route'
import {
  planQrCanvas,
  qrMatrix,
  QR_ERROR_CORRECTION,
  QR_QUIET_ZONE_MODULES,
} from '../utils/qrRender'
import PluginModal from './PluginModal.vue'
import { useDeviceCenter } from '../composables/useDeviceCenter'
import { useTunnelStatus } from '../composables/useTunnelStatus'

const context = inject<PluginContext>('pluginContext')!
const { t } = context.i18n

const {
  pairingCode,
  remainingSeconds,
  isGenerating,
  loadNetwork,
  selectHost,
  generateCode: generatePairingCode,
  restoreCode,
  clearCode,
  qrRemainingSeconds,
  isQrLoading,
  hasQr,
  hasWanQr,
  qrWanError,
  qrPeerError,
  qrRelayError,
  qrWanDisabled,
  generateQr,
  restoreQr,
  clearQr,
  qrPayload,
  qrPairUri,
  onlineDevices,
  offlineDevices,
  loadDevices,
  removeDevice: revokeDevice,
  rotateSigningKey,
  loadAuthCenterStatus,
  port,
  addresses,
  selectedHost,
  ipOptions,
  subscribeHostEvents,
  dispose,
} = useDeviceCenter(context)

// ==================== Tab 切换 ====================
type TabKey = 'pairing' | 'devices'
const activeTab = ref<TabKey>('pairing')
const deviceTabs: { key: TabKey; label: string }[] = [
  { key: 'pairing', label: t('pairing.tab.pairing') },
  { key: 'devices', label: t('pairing.tab.devices') },
]
const tabScrollRef = ref<HTMLElement | null>(null)

// 切页时复位滚动：过渡用「旧页绝对定位层淡出 + 新页淡入」，旧层锚在内容顶部，
// 滚动位置若留在中段，残影会落在视口之外、两层对不齐。post flush 保证复位发生在
// DOM 更新（旧页已脱流）之后、浏览器绘制之前，旧页不会先跳回顶部再开始淡出。
watch(
  activeTab,
  () => {
    if (tabScrollRef.value) tabScrollRef.value.scrollTop = 0
  },
  { flush: 'post' },
)

// ==================== QR 内部分页（局域网 / 外网） ====================
type QrTabKey = 'lan' | 'wan'
const activeQrTab = ref<QrTabKey>('lan')
const qrTabs: { key: QrTabKey; label: string }[] = [
  { key: 'lan', label: t('pairing.qr.tabLan') },
  { key: 'wan', label: t('pairing.qr.tabWan') },
]

/**
 * 生成动作本身的失败详情（命令面报错原文；null = 无失败）
 *
 * 与 `qrWanError` 分开：后者是「命令成功但外网载荷组装不了」，本字段是
 * 「命令压根没成功」（如认证中心未激活 / 端口配置缺失）。两种都必须可见——
 * 早前这条路径没有 catch，命令抛错只留下一个未处理的 Promise，界面停在占位态，
 * 用户看到的就是「点了生成二维码但什么都没有」。
 */
const qrGenerateError = ref<string | null>(null)

/**
 * 当前 QR 分页能否出码：局域网 = 有活跃 QR；外网 = 隧道 peer 可用且载荷可组装
 *
 * peer 缺省时载荷虽能按 v1 组装，但那不是内网穿透码，外网分页不出码、只展示原因。
 */
const qrTabRenderable = computed(() =>
  activeQrTab.value === 'lan' ? hasQr.value : hasWanQr.value,
)

/** 切页：清掉上一页残留的生成失败提示（两页各自独立，不互相继承错误态） */
function selectQrTab(key: QrTabKey): void {
  activeQrTab.value = key
  qrGenerateError.value = null
}

/**
 * 当前页的生成按钮文案
 *
 * 按**本页**能否出码取「刷新 / 生成」，而不是看共享的 `hasQr`：外网页在隧道
 * peer 不可用时没有码，按钮就不能显示成「刷新」（那会让用户以为已有外网码）。
 */
const qrGenerateLabel = computed(() => {
  if (qrTabRenderable.value) return t('pairing.button.refresh')
  return activeQrTab.value === 'wan' ? t('pairing.qr.generateWan') : t('pairing.qr.generate')
})

/** 工具栏展示的当前对外 IP（未选择时显示占位文案） */
const displayIp = computed(() => selectedHost.value || t('pairing.network.notSelected'))

/**
 * 外网载荷组装失败的显性文案（T08：peer 信息残缺不静默降级成 v1）
 *
 * 显式映射而不是拼接 key：`plugin-contract` C6 静态检查 `t('...')` 字面量，
 * 动态 key 会绕过完整性门禁。
 */
const qrWanErrorText = computed(() => {
  switch (qrWanError.value) {
    case 'peer-incomplete':
      return t('pairing.qr.errorPeerIncomplete')
    case 'peer-address-invalid':
      return t('pairing.qr.errorPeerAddressInvalid')
    default:
      return ''
  }
})

/**
 * 外网 Tab 出不了码时对用户说的**一句**原因（toast 用；空串 = 没有更具体的原因）
 *
 * 优先级按「离根因最近」排：载荷组装失败 > 业务关闭外网 > 后端未产出 peer >
 * 中继配置降级。页面内的分条提示照旧全量展示，这里只挑第一条说给立刻要反馈的用户。
 */
const qrWanBlockReason = computed(() => {
  if (qrWanErrorText.value) return qrWanErrorText.value
  if (qrWanDisabled.value) return t('pairing.qr.wanDisabled')
  if (qrPeerError.value) return t('pairing.tunnel.onlyLan')
  if (qrRelayError.value) return t('pairing.qr.relayDegraded', { message: qrRelayError.value })
  return ''
})

// ==================== 隧道状态（T07） ====================
//
// 状态真源 = 宿主 `host-tunnel.status`（§4.9 判定全在宿主，本端只读）。
// `prepare` 会幂等地写通道配置 + 暴露本机 HTTP 面，页面进入时调一次即可。
const tunnel = useTunnelStatus(context)

/**
 * 状态文案（显式映射，不拼 key：`plugin-contract` C6 静态检查字面量 key）
 */
const tunnelLabel = computed(() => {
  switch (tunnel.summary.value.key) {
    case 'direct':
      return t('pairing.tunnel.direct')
    case 'relay':
      return t('pairing.tunnel.relay')
    case 'ready':
      return t('pairing.tunnel.ready')
    case 'lanUnreachable':
      return t('pairing.tunnel.lanUnreachable')
    case 'relayUnavailable':
      return t('pairing.tunnel.relayUnavailable')
    case 'wanOff':
      return t('pairing.tunnel.wanOff')
    case 'offline':
      return t('pairing.tunnel.offline')
    default:
      return t('pairing.tunnel.unavailable')
  }
})

/** 状态点 / 文字配色（语气 → token；warning 用文字色混合保证对比度） */
const tunnelToneClass = computed(() => {
  switch (tunnel.summary.value.tone) {
    case 'success':
      return 'text-[var(--color-success)]'
    case 'warning':
      return 'text-[var(--color-warning)]'
    case 'danger':
      return 'text-[var(--color-danger)]'
    default:
      return 'text-[var(--text-tertiary)]'
  }
})

const tunnelDotClass = computed(() => {
  switch (tunnel.summary.value.tone) {
    case 'success':
      return 'bg-[var(--color-success)]'
    case 'warning':
      return 'bg-[var(--color-warning)]'
    case 'danger':
      return 'bg-[var(--color-danger)]'
    default:
      return 'bg-[var(--text-tertiary)]'
  }
})

// ==================== 撤销确认 ====================
const showRemoveDeviceDialog = ref(false)
const pendingDeviceId = ref<string | null>(null)

// ==================== 入场密钥轮换确认（ADR 0033 D4） ====================
const showRotateKeyDialog = ref(false)
const isRotatingKey = ref(false)

// ==================== 认证中心就位横幅（ADR 0031 欠账 / 票 08 §8.1） ====================
/** 非 null 即「中心未就位」；`unknown` 区分「读不到状态」与「确知未注册」 */
const centerStatusError = ref<null | 'not_ready' | 'unknown'>(null)

/**
 * 读认证中心就位状态并更新横幅
 *
 * **三态**（不得压成两态）：
 * - `registered: true` → 无横幅（正常态）
 * - `registered: false` → 「未就位」横幅：入站必被拒，给出修复指引
 * - **读失败** → 「状态未知」横幅：**不**当作未就位。两者正确动作不同
 *   （前者是重建产物，后者是通信/宿主问题），混同会把排障方向带偏。
 */
async function refreshCenterStatus(): Promise<void> {
  try {
    const status = await loadAuthCenterStatus()
    centerStatusError.value = status.registered ? null : 'not_ready'
  } catch (e) {
    console.error('[Device Center] auth center status unavailable:', e)
    centerStatusError.value = 'unknown'
  }
}

// ==================== QR 渲染 ====================

const qrCanvasRef = ref<HTMLCanvasElement | null>(null)

/**
 * 把当前 QR 载荷绘制到 canvas（幂等；载荷缺失 / canvas 未挂载时跳过）
 *
 * 三个触发点缺一不可（2026-09-26 修复「切走再切回来二维码空白」）：
 * 1. 载荷变化——生成 / 恢复 / 扫码后自动重生成；
 * 2. canvas 元素重建——切到「设备列表」Tab 再切回时 `v-if` 会重建 canvas，
 *    此时载荷未变、仅靠 1 不会重画，画布保持空白（2026-09-26 单测复现）；
 * 3. KeepAlive 重新激活（路由切回）—— 路由页被保活时不重建组件，canvas 与
 *    载荷都可能未变，但重新进入页面必须保证图案可见，不依赖 WebView 对
 *    「移出文档再移回」的 canvas 内容保留行为。
 */
async function renderQrCanvas() {
  const payload = qrPayload(activeQrTab.value)
  const canvas = qrCanvasRef.value
  if (!payload || !canvas) return
  try {
    // 画布尺寸必须按**实际模块数**算：v3 载荷（LAN + relay 地址）是 73 模块（多网卡 77，
    // 仅 LAN 61），v2 时代是 85~93；固定 192px 只剩 ~2.2px/模块，手机相机扫不出
    // （见 utils/qrRender.ts 头注）。
    const plan = planQrCanvas(qrMatrix(payload).size, window.devicePixelRatio)
    await QRCode.toCanvas(canvas, payload, {
      width: plan.size,
      margin: QR_QUIET_ZONE_MODULES,
      errorCorrectionLevel: QR_ERROR_CORRECTION,
      color: { dark: '#000000', light: '#ffffff' },
    })
    // `qrcode` 把 canvas 的 CSS 尺寸设成设备像素值：DPR > 1 时浏览器会把画布
    // 放大插值，模块边缘糊掉。按 DPR 还原逻辑尺寸，才是 1 设备像素对 1 物理像素。
    canvas.style.width = `${plan.cssSize}px`
    canvas.style.height = `${plan.cssSize}px`
  } catch (e) {
    console.error('[Device Center] render qr canvas failed:', e)
  }
}

watch(
  // 载荷变化（生成 / 恢复 / 扫码后自动重生成）与分页切换（局域网 ↔ 外网载荷不同）
  // 都要触发重绘；canvas 元素重建由下面的 qrCanvasRef watch 兜底
  () => [activeQrTab.value, qrPayload(activeQrTab.value)] as const,
  () => void renderQrCanvas(),
  { flush: 'post' },
)
// canvas 元素重建（Tab 切换 / 分支重渲染）后补画：载荷不变时上面的 watch 不会触发
watch(qrCanvasRef, () => void renderQrCanvas(), { flush: 'post' })
// 路由切回（KeepAlive 激活）时确保图案可见
onActivated(() => {
  void renderQrCanvas()
  // KeepAlive 切回页面时刷新网络信息（端口）：服务器可能已在期间重启换端口，
  // 不刷新会继续显示旧端口（与 ServerView 的「保存端口 → 立即重启」配套）
  void loadNetwork()
  // 隧道状态同样会过时（对端断开 / relay 掉线 / 换网）：切回时按只读面刷新
  void tunnel.refresh()
})

/**
 * 复制连接串（无摄像头场景：把 `wasmnest://pair/…` 粘贴到移动端）
 *
 * 按当前分页的载荷组装：组装失败时 `qrPairUri()` 返回 null，页面已有显性错误文案，
 * 此时不动作——不复制半成品，也不假装成功；剪贴板不可用则显性 toast。
 */
async function copyPairUri() {
  const uri = qrPairUri(activeQrTab.value)
  if (!uri) return
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(uri)
    toast.success(t('pairing.qr.copyLinkDone'))
  } catch (e) {
    console.error('[Device Center] copy pair link failed:', e)
    toast.error(t('pairing.qr.copyLinkFailed'))
  }
}

// ==================== 交互编排 ====================

/** 选择对外 IP（插件存储持久化；同时刷新 QR 载荷） */
function handleIpSelect(value: string | number) {
  if (value === '') return
  void selectHost(String(value)).then(() => {
    if (hasQr.value) void generateQr(String(value))
  })
}

/**
 * 生成 / 刷新当前分页的二维码
 *
 * 三条纪律（每条都对应一个真实故障，别再退回「点了没反应」）：
 * 1. **外网页先生成隧道**：外网码的 `peer` 是后端在生成时按当时的通道配置组装的；
 *    换网 / relay 刚恢复 / 插件重新激活后旧通道可能还没重建，直接生成会拿到
 *    `peerError`（表现为「外网页生成不出码」）。`prepare` 幂等，代价只有一次命令。
 * 2. **失败必须可见**：命令抛错时置 `qrGenerateError` 并 toast——早前没有 catch，
 *    Promise 未处理 ⇒ 界面停在占位态，看起来就是「按钮没生效」。
 * 3. **外网页没出码要说原因**：后端没能给出可拨的隧道信息时，二维码不该出（那会
 *    假装外网可达），但原因必须上屏 + toast，而不是留一张空占位。
 */
async function handleGenerateQr(tab: QrTabKey) {
  qrGenerateError.value = null
  try {
    if (tab === 'wan') {
      await tunnel.prepare()
    }
    await generateQr(selectedHost.value || undefined)
  } catch (e) {
    console.error('[Device Center] generate qr failed:', e)
    qrGenerateError.value = e instanceof Error ? e.message : String(e)
    toast.error(t('pairing.qr.generateFailed'))
    return
  }
  if (tab !== 'wan' || hasWanQr.value) return
  toast.error(qrWanBlockReason.value || t('pairing.qr.errorPeerIncomplete'))
}

/** 生成配对码（含失败提示；无码视为生成失败，不静默） */
async function generateCode() {
  try {
    const info = await generatePairingCode()
    if (!info?.code) {
      toast.error(t('pairing.code.generateFailedNoCode'))
    }
  } catch (e) {
    console.error('[Device Center] generate pairing code failed:', e)
    toast.error(t('pairing.code.generateFailed'))
  }
}

/** 取消配对码（清除后端状态 + 停表） */
function cancelPairing() {
  void clearCode()
}

/** 刷新：网络信息 + 设备列表 + 就位状态一并取最新 */
async function refreshAll() {
  // 本机地址会随换网络 / DHCP 续租变化，服务器端口也可能已重启换过（与 ServerView 的
  // 「保存端口 → 立即重启」配套）：刷新必须重读网络信息，否则工具栏与二维码继续挂旧地址
  await loadNetwork()
  // 已挂出二维码时按新地址重组载荷（token 不变、不重新签发）：地址已变却还挂着旧 IP 的码，
  // 扫出来照样连不上
  if (hasQr.value) {
    await restoreQr(selectedHost.value || undefined)
  }
  await loadDevices()
  // 顺带重读就位状态：用户「停用并重新启用插件」后的第一手反馈就来自这次点击，
  // 不必等重启页面（横幅正是为「修完立刻看到好了」而存在的）
  await refreshCenterStatus()
  toast.success(t('pairing.toast.listRefreshed'))
}

/** 打开某设备的连接历史页（同一插件的另一个侧边栏目录，query 传设备 id） */
function viewHistory(deviceId: string) {
  void sharedRouter().push({
    name: 'plugin-sidebar-view',
    params: { pluginId: context.id, viewId: 'session.history' },
    query: { deviceId },
  })
}

function removeDevice(deviceId: string) {
  pendingDeviceId.value = deviceId
  showRemoveDeviceDialog.value = true
}

async function confirmRemoveDevice() {
  if (!pendingDeviceId.value) return
  try {
    await revokeDevice(pendingDeviceId.value)
    toast.success(t('pairing.device.removed'))
  } catch (e) {
    void e
    toast.error(t('pairing.error.revokeFailed'))
  } finally {
    showRemoveDeviceDialog.value = false
    pendingDeviceId.value = null
  }
}

/**
 * 确认轮换入场签发密钥（ADR 0033 D4）
 *
 * 轮换**不撤销既有凭证**（撤销走 `revokeDevice`），上一代密钥在宽限期内继续
 * 验签，所以这里**不**触发设备列表刷新——列表不会因轮换而变化。
 * `kid` 只是代次标识，回显给用户便于对照日志（不含密钥材料）。
 */
async function confirmRotateKey() {
  if (isRotatingKey.value) return
  isRotatingKey.value = true
  try {
    const result = await rotateSigningKey()
    toast.success(t('pairing.key.rotatedTo', { kid: result.kid }))
  } catch (e) {
    console.error('[Device Center] rotate entry signing key failed:', e)
    toast.error(t('pairing.key.error'))
  } finally {
    isRotatingKey.value = false
    showRotateKeyDialog.value = false
  }
}

// ==================== 日期格式化（跟随宿主 locale，与宿主原页同口径） ====================

const dateFormatter = computed(() => {
  const locale = context.i18n.getI18n()?.global?.locale?.value === 'en' ? 'en-US' : 'zh-CN'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return t('pairing.status.unknown')
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return t('pairing.status.unknown')
  return dateFormatter.value.format(date)
}

// ==================== 生命周期 ====================

onMounted(async () => {
  // 每一段独立捕获：任一路失败只降级本段（D7 故障隔离），不让页面整体不可用
  try {
    await Promise.all([loadNetwork(), loadDevices()])
  } catch (e) {
    console.error('[Device Center] load device data failed:', e)
    toast.error(t('pairing.error.loadFailed'))
  }
  // 认证中心就位横幅（独立于数据加载：它自己处理失败，不弹 toast 扰动用户）
  await refreshCenterStatus()
  // 隧道准备（写通道配置 + 暴露 HTTP 面，幂等）→ 状态栏；失败由 composable 收口
  await tunnel.prepare()
  // 恢复既有 QR / 配对码（不重新生成，与宿主原页一致）
  await restoreQr(selectedHost.value || undefined)
  await restoreCode()
  // 后端事件驱动状态流转（配对码自动清除 / 设备在线态 / 扫码消耗重生成）
  subscribeHostEvents((code) => {
    toast.info(t('pairing.code.request', { code }))
  })
})

onUnmounted(() => {
  // 停止倒计时并释放宿主事件订阅：页面切走即释放，切回重新订阅（与宿主原页同语义）
  dispose()
})
</script>

<style scoped>
/* 两页签切换过渡只在本页生效（2026-11-17：设备配对 / 设备列表两页签要平滑过渡）。
 *
 * 宿主页面过渡体系（.page-* / .page-swap / --motion-page-*）仍是全局真源；本应用
 * 在 src/style.css 里为工作台高频切换把整页过渡压成了瞬时。这里不新建过渡名字，
 * 只给本页的过渡容器加 `.pairing-tab-swap`，让宿主那套「重叠交叉淡入 + 出场层
 * 脱离文档流」的机制在本页按更短的节奏重新生效——其它页面仍走瞬时策略。
 *
 * 频率与幅度：页签切换是低频动作，入场 160ms / 出场 120ms、位移收到 4px，读起来
 * 是「换了一页」而不是「加载了一页」；只动 opacity / transform，不写 will-change
 * （WebKitGTK 上整块合成层容易闪）。系统减弱动态时与宿主同一口径：瞬时、无位移。
 *
 * 内边距放在两个 pane 上而不是过渡容器上：旧页脱流后与新页用同一套 px-6 py-5，
 * 不依赖宿主的 padding 补偿变量，两层内外缘自然对齐。
 */
.page-swap.pairing-tab-swap {
  --motion-page-duration-in: 160ms;
  --motion-page-duration-out: 120ms;
  --motion-page-shift: 4px;
}

.page-swap.pairing-tab-swap .page-enter-active {
  transition:
    opacity var(--motion-page-duration-in) var(--motion-page-ease),
    transform var(--motion-page-duration-in) var(--motion-page-ease);
}

.page-swap.pairing-tab-swap .page-leave-active {
  transition:
    opacity var(--motion-page-duration-out) var(--motion-page-ease),
    transform var(--motion-page-duration-out) var(--motion-page-ease);
}

.page-swap.pairing-tab-swap .page-enter-from {
  opacity: 0;
  transform: translateY(var(--motion-page-shift));
}

.page-swap.pairing-tab-swap .page-leave-to {
  opacity: 0;
  transform: translateY(calc(0px - var(--motion-page-shift) / 2));
}

@media (prefers-reduced-motion: reduce) {
  .page-swap.pairing-tab-swap .page-enter-active,
  .page-swap.pairing-tab-swap .page-leave-active {
    transition-duration: 0.01ms;
  }

  .page-swap.pairing-tab-swap .page-enter-from,
  .page-swap.pairing-tab-swap .page-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
