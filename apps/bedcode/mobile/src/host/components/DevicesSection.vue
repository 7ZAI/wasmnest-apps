<template>
  <div class="h-full flex flex-col" data-testid="mobile-devices-section" style="background: var(--mobile-bg-primary)">
    <!-- ==================== Header（旧 DevicesView 页头：标题 + 连接状态小字 + 扫描发现开关） ==================== -->
    <div class="page-header flex-shrink-0">
      <div class="page-header-row">
        <div class="min-w-0 flex-1">
          <h1 class="page-title truncate">{{ t('hub.title') }}</h1>
          <!-- 连接成功后标题下方仅显示「已连接」小字，未连接/连接中显示状态文字 -->
          <p
            class="page-subtitle connection-status-subtitle"
            data-testid="mobile-connection-status"
            :data-connected="isConnected ? 'true' : 'false'"
          >
            <template v-if="isConnected && currentDevice">
              <span class="inline-flex items-center gap-1.5">
                <span class="status-dot dot-emerald"></span>
                {{ t('hub.status.connected') }}
              </span>
            </template>
            <template v-else>
              <span class="inline-flex items-center gap-1.5">
                <span
                  class="status-dot"
                  :style="{
                    background:
                      connectionStatus === 'connecting'
                        ? 'var(--mobile-accent)'
                        : 'var(--mobile-text-muted)',
                  }"
                ></span>
                <span class="text-[var(--mobile-text-secondary)]">{{ connectionStatusText }}</span>
              </span>
            </template>
          </p>
        </div>
        <button
          class="flex shrink-0 items-center justify-center w-11 h-11 -mr-2 rounded-[var(--bc-radius-control)] transition-colors active:opacity-80"
          :style="{
            color: showDiscovery ? 'var(--mobile-accent)' : 'var(--mobile-text-secondary)',
            background: showDiscovery ? 'var(--mobile-accent-muted)' : 'transparent',
          }"
          :class="{ 'opacity-50': isConnecting }"
          :disabled="isConnecting"
          :title="t('hub.discoverDevices')"
          @click="toggleDiscovery"
        >
          <!-- 局域网发现：同心圆 + 扫描射线 + 中心点（声呐式），统一 18px / 1.75 描边 -->
          <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" stroke-width="1.75" />
            <circle cx="12" cy="12" r="4.5" stroke-width="1.75" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 12l5.2-5.2" />
            <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Main Content（页面内容滚动容器：scrollbar-gutter-stable 防滚动条显隐引起整页横向抖动） -->
    <div
      ref="contentScrollRef"
      class="scrollbar-gutter-stable flex-1 overflow-y-auto overflow-x-hidden px-4 min-h-0"
    >
      <!-- 连接失败提示（附加在页面区块上方，不替换列表；连接中 loading 由弹窗 LoadingDialog 承担，
          避免状态卡片与列表的快速显示/隐藏跳变闪动） -->
      <Transition name="fade">
        <div v-if="connectionStatus === 'error'" class="mb-4">
          <div class="group-card">
            <div class="group-row">
              <svg
                class="w-5 h-5"
                style="color: var(--mobile-chip-red)"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <span class="group-row-sub">{{ connectionStatusText }}</span>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 穿透状态（T09）：拨号失败（如内网不可达）也要可见，否则用户只看到「连接失败」
           而不知道可以尝试外网。状态文字才是判据，颜色仅是提示。 -->
      <Transition name="fade">
        <div
          v-if="!isConnected && tunnelAttempted && tunnelView"
          class="mb-4"
          data-testid="mobile-tunnel-status"
        >
          <div class="group-card">
            <div class="group-row flex-wrap gap-x-2 gap-y-1">
              <span
                class="text-[var(--font-size-sm)] font-medium"
                :style="{ color: tunnelToneColor }"
                data-testid="mobile-tunnel-mode"
                :title="tunnelReasonText"
                >{{ t(tunnelView.modeKey) }}</span
              >
              <span
                class="text-[var(--font-size-sm)]"
                style="color: var(--mobile-text-muted)"
                data-testid="mobile-tunnel-encryption"
                :title="t('hub.tunnelEncryptionNote')"
                >{{ t('hub.tunnelEncrypted') }}</span
              >
              <span
                v-if="tunnelView.wanOff"
                class="text-[var(--font-size-sm)]"
                style="color: var(--mobile-text-muted)"
                data-testid="mobile-tunnel-wan-off"
                >{{ t('hub.tunnelWanOff') }}</span
              >
              <button
                v-if="tunnelView.manualWan"
                class="ml-auto h-9 px-3 rounded-[var(--bc-radius-control)] text-[var(--font-size-sm)] font-medium active:opacity-80"
                style="
                  color: var(--mobile-text-primary);
                  background: var(--mobile-bg-elevated);
                  border: 1px solid var(--mobile-border);
                "
                data-testid="mobile-tunnel-try-wan"
                :disabled="isConnecting"
                :class="{ 'opacity-50': isConnecting }"
                @click="handleTryWan"
              >
                {{ t('hub.tunnelTryWan') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 主内容区互斥分支（已连接 / 扫描面板 / mDNS 发现 / 历史列表）：切换时淡入淡出（mode="out-in"），
          避免卡片硬切闪动；分支均需显式 key（同标签 div 复用会跳过过渡） -->
      <Transition name="fade" mode="out-in">
        <!-- Connected: 当前设备（会话配置已迁移到会话页） -->
        <div v-if="isConnected" key="connected" class="pb-8">
          <div class="pt-2 space-y-3">
            <!-- Connected device info + disconnect（同行，断开按钮位于卡片右侧） -->
            <div
              v-if="currentDevice"
              class="bg-[var(--mobile-bg-card)] border border-[var(--mobile-border)] rounded-[var(--bc-radius-card)] p-4"
            >
              <div class="flex items-center gap-3">
                <span class="bc-icon-box">
                  <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.75"
                      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </span>
                <div class="flex-1 min-w-0">
                  <span class="text-[var(--font-size-lg)] font-medium text-[var(--mobile-text-primary)] truncate block">
                    {{ currentDevice.name || currentDevice.address }}
                  </span>
                  <p class="text-[var(--font-size-sm)] mt-1 font-mono text-[var(--mobile-text-muted)]">
                    {{ currentDevice.address }}:{{ currentDevice.port }}
                  </p>
                </div>
                <!-- 断开：中性按钮。红色留给确认弹窗里的那一下，不挂在常驻入口上 -->
                <button
                  class="flex-shrink-0 h-11 px-3 rounded-[var(--bc-radius-control)] flex items-center gap-1.5 text-[var(--font-size-sm)] font-medium transition-colors active:opacity-80"
                  style="
                    color: var(--mobile-text-secondary);
                    background: var(--mobile-bg-primary);
                    border: 1px solid var(--mobile-border);
                  "
                  @click="handleDisconnect"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.75"
                      d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v9"
                    />
                  </svg>
                  <span>{{ t('hub.disconnect') }}</span>
                </button>
              </div>

              <!-- 穿透状态（T09）：模式是宿主事实；「已加密」是常量标记（不可关闭），
                   两者都是小字事实，不给底色（原先是两条胶囊比设备名还显眼） -->
              <div
                v-if="tunnelView && tunnelView.viaTunnel"
                class="mt-3 flex items-center gap-x-2 gap-y-1 flex-wrap"
                data-testid="mobile-tunnel-status-connected"
              >
                <span
                  class="text-[var(--font-size-sm)] font-medium"
                  :style="{ color: tunnelToneColor }"
                  data-testid="mobile-tunnel-mode-connected"
                  :title="tunnelReasonText"
                  >{{ t(tunnelView.modeKey) }}</span
                >
                <span
                  class="text-[var(--font-size-sm)]"
                  style="color: var(--mobile-text-muted)"
                  data-testid="mobile-tunnel-encryption-connected"
                  :title="t('hub.tunnelEncryptionNote')"
                  >{{ t('hub.tunnelEncrypted') }}</span
                >
                <span
                  v-if="tunnelView.wanOff"
                  class="text-[var(--font-size-sm)]"
                  style="color: var(--mobile-text-muted)"
                  data-testid="mobile-tunnel-wan-off-connected"
                  >{{ t('hub.tunnelWanOff') }}</span
                >
                <button
                  v-if="tunnelView.manualWan"
                  class="text-[var(--font-size-sm)] font-medium underline underline-offset-2"
                  style="color: var(--mobile-accent)"
                  data-testid="mobile-tunnel-try-wan-connected"
                  @click="handleTryWan"
                >
                  {{ t('hub.tunnelTryWan') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Not Connected: 内嵌扫描面板（扫描整合进连接页，替代独立扫描页） -->
        <div v-else-if="showScanner" key="scanner" class="pb-8">
          <ScanPanel @close="showScanner = false" @scan-result="handleScanResult" />
        </div>

        <!-- Not Connected: mDNS 扫描发现（融合进连接页：点击页头雷达按钮展开，扫描动画+结果在此展示，区域可关闭） -->
        <div v-else-if="showDiscovery" key="discovery" class="pb-8">
          <!-- 区域头部：扫描发现 + 控制（停止/重新扫描）+ × 关闭。吸顶在内容区顶部，
               设备列表较长时滚动中控制按钮仍可达 -->
          <div
            class="sticky top-0 z-10 -mx-4 px-4 pt-2 pb-2 flex items-center justify-between"
            style="background: var(--mobile-bg-primary)"
          >
            <span class="text-[var(--font-size-sm)] font-medium text-[var(--mobile-text-muted)]">
              {{ t('hub.discoverTitle') }}
              <span v-if="discoveredServices.length > 0" class="ml-1 font-mono">
                {{ discoveredServices.length }}
              </span>
            </span>
            <div class="flex items-center -mr-2 flex-shrink-0">
              <button
                class="h-11 px-3 rounded-[var(--bc-radius-control)] text-[var(--font-size-sm)] font-medium transition-colors active:opacity-80"
                style="color: var(--mobile-text-secondary)"
                :disabled="isConnecting"
                :class="{ 'opacity-50': isConnecting }"
                @click="toggleMdnsScan"
              >
                {{ mdnsScanning ? t('hub.discoverStopScan') : t('hub.discoverRestartScan') }}
              </button>
              <button
                class="h-11 w-11 rounded-[var(--bc-radius-control)] flex items-center justify-center transition-colors active:opacity-80"
                style="color: var(--mobile-text-muted)"
                :title="t('hub.actionClose')"
                @click="closeDiscovery"
              >
                <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 扫描状态：一行事实（spinner + 文字 + 已发现数）。原先这里下面还画了一个
               112px 的雷达扫射插图，和这一行的语义完全重复：扫描本身已经在转，插图只是装饰 -->
          <div v-if="mdnsScanning" class="pb-3 flex items-center gap-2.5">
            <div
              class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
              style="color: var(--mobile-text-muted)"
            />
            <span class="group-row-sub">{{ t('hub.discoverScanning') }}</span>
            <span
              v-if="discoveredServices.length > 0"
              class="text-[var(--font-size-sm)] font-mono ml-auto"
              style="color: var(--mobile-text-muted)"
            >
              {{ t('hub.discoverDeviceFound', { count: discoveredServices.length }) }}
            </span>
          </div>

          <!-- 空态（未扫描且无设备） -->
          <div
            v-if="discoveredServices.length === 0 && !mdnsScanning"
            class="flex flex-col items-center justify-center py-12"
          >
            <svg
              class="w-10 h-10 mb-4"
              style="color: var(--mobile-text-disabled)"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0"
              />
            </svg>
            <p class="group-row-sub mb-1">{{ t('hub.discoverNoDevices') }}</p>
            <p class="text-[var(--font-size-sm)]" style="color: var(--mobile-text-secondary)">
              {{ t('hub.discoverNoDevicesHint') }}
            </p>
          </div>

          <!-- 扫描结果（发现的设备列表） -->
          <div v-if="discoveredServices.length > 0" class="group-card">
            <div
              v-for="service in discoveredServices"
              :key="service.instance_name"
              class="group-row"
              :class="isDiscoverCurrentDevice(service) ? 'is-connected' : 'group-row-btn cursor-pointer'"
              @click="handleDiscoverConnect(service)"
            >
              <span class="device-chip">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.75"
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="device-name truncate">{{ service.device_name || service.instance_name }}</span>
                  <!-- 已连：绿点 + 文字；可连：只给文字。两者都不需要底色 -->
                  <span
                    class="ml-auto flex-shrink-0 flex items-center gap-1.5 text-[var(--font-size-sm)]"
                    :style="{
                      color: isDiscoverCurrentDevice(service)
                        ? 'var(--mobile-text-primary)'
                        : 'var(--mobile-text-muted)',
                    }"
                  >
                    <span
                      v-if="isDiscoverCurrentDevice(service)"
                      class="status-dot dot-emerald"
                      aria-hidden="true"
                    />
                    {{
                      isDiscoverCurrentDevice(service)
                        ? t('hub.discoverConnected')
                        : t('hub.discoverConnectToDevice')
                    }}
                  </span>
                </div>
                <div class="device-addr font-mono truncate">
                  {{ service.address }}:{{ service.port }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Not Connected: 远程设备（中继）+ Connection History + Scan Result。
             远程列表是持久化对端记录（重启后仍在）：跨网重连不再依赖桌面用户重发二维码。
             历史为空时整个历史区块（标题/条数/清除/列表）不渲染——空历史只剩标题与
             「暂无」文案纯属噪音；与扫码结果都为空时本分支整体不渲染，不留空内容区 -->
        <div
          v-else-if="hasHistoryOrScanResult || relayTargets.length > 0"
          key="history"
          class="pb-8"
        >
          <div class="pt-2 space-y-3">
            <!-- 远程连接（中继）：只列具备 relay 候选与逻辑端口的记录（没条件的点必失败，
                 不展示假入口）；桌面端需保持运行且已配置中继 -->
            <template v-if="relayTargets.length > 0">
              <div class="flex items-baseline justify-between pt-2">
                <span class="text-[var(--font-size-sm)] font-medium text-[var(--mobile-text-muted)]">
                  {{ t('hub.relayTargetsTitle') }}
                  <span class="ml-1 font-mono">{{ relayTargets.length }}</span>
                </span>
              </div>
              <p
                class="text-[var(--font-size-sm)] leading-relaxed"
                style="color: var(--mobile-text-muted)"
                data-testid="mobile-relay-hint"
              >
                {{ t('hub.relayTargetsHint') }}
              </p>
              <div class="group-card" data-testid="mobile-relay-targets">
                <div
                  v-for="(target, index) in relayTargets"
                  :key="target.nodeId"
                  class="group-row"
                  :data-testid="`mobile-relay-target-${index}`"
                >
                  <span class="device-chip">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.75"
                        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-9c2.5 2.3 4 5.5 4 9s-1.5 6.7-4 9c-2.5-2.3-4-5.5-4-9s1.5-6.7 4-9zM3 12h18"
                      />
                    </svg>
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="device-name truncate">{{ target.deviceName || 'Desktop' }}</span>
                    </div>
                    <div class="device-addr font-mono truncate">
                      {{
                        t('hub.relayTargetMeta', {
                          node: shortNodeId(target.nodeId),
                          port: target.port,
                        })
                      }}
                    </div>
                    <div
                      v-if="target.lastMode"
                      class="text-[var(--font-size-sm)] mt-0.5"
                      style="color: var(--mobile-text-muted)"
                    >
                      {{ t('hub.relayTargetLastMode', { mode: t(modeLabelKey(target.lastMode)) }) }}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="flex-shrink-0 h-9 px-3 rounded-[var(--bc-radius-control)] text-[var(--font-size-sm)] font-medium transition-colors active:opacity-80"
                    style="
                      color: var(--mobile-text-primary);
                      background: var(--mobile-bg-elevated);
                      border: 1px solid var(--mobile-border);
                    "
                    :class="{ 'opacity-50': isConnecting }"
                    :disabled="isConnecting"
                    :data-testid="`mobile-relay-connect-${index}`"
                    @click="handleRelayConnect(target)"
                  >
                    {{ t('hub.relayTargetConnect') }}
                  </button>
                </div>
              </div>
            </template>

            <!-- Connection History（仅非空时渲染，带条数与清除入口）
                 一张分组卡装全部历史，不再每条一张卡：条与条之间靠分隔线，密度与
                 上面的中继列表一致（原先卡片套卡片，一屏只放得下三条） -->
            <template v-if="hasConnectionHistory">
              <div class="flex items-baseline justify-between pt-2">
                <span class="text-[var(--font-size-sm)] font-medium text-[var(--mobile-text-muted)]">
                  {{ t('hub.history') }}
                  <span class="ml-1 font-mono">{{ connectionHistory.length }}</span>
                </span>
                <button
                  class="text-[var(--font-size-sm)] transition-colors active:opacity-80"
                  style="color: var(--mobile-text-muted)"
                  @click="showClearHistoryConfirm = true"
                >
                  {{ t('hub.clearHistory') }}
                </button>
              </div>

              <TransitionGroup name="config-list" tag="div" class="group-card">
                <div
                  v-for="item in connectionHistory"
                  :key="item.address"
                  class="group-row"
                  :class="{ 'opacity-50 pointer-events-none': isConnecting }"
                >
                  <!-- 主区独立按钮：删除键是它的兄弟而不是子元素（按钮不得嵌套） -->
                  <button
                    type="button"
                    class="flex flex-1 min-w-0 items-center gap-3 text-left cursor-pointer active:opacity-80 disabled:cursor-not-allowed"
                    :disabled="isConnecting"
                    @click="handleConnectFromHistory(item)"
                  >
                    <span class="device-chip">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="1.75"
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                    </span>
                    <span class="flex-1 min-w-0 block">
                      <span class="device-name truncate block">
                        {{ item.name || item.address }}
                      </span>
                      <span class="device-addr font-mono truncate block">
                        {{ item.address }}
                      </span>
                    </span>
                    <span
                      class="flex-shrink-0 text-[var(--font-size-sm)] font-mono"
                      style="color: var(--mobile-text-muted)"
                    >
                      {{ formatLastConnected(item.lastConnected, t) }}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="flex items-center justify-center rounded-[var(--bc-radius-control)] transition-colors active:opacity-80 flex-shrink-0 min-w-[var(--mobile-touch-target-min)] min-h-[var(--mobile-touch-target-min)]"
                    style="color: var(--mobile-text-muted)"
                    :disabled="isConnecting"
                    :aria-label="t('hub.remove')"
                    :title="t('hub.remove')"
                    @click.stop="removeFromHistory(item.address)"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.75"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </TransitionGroup>
            </template>

            <!-- 扫描结果：与连接历史同级别的独立区块（识别到二维码停止扫描后出现），可关闭；
                 历史为空时不再让位（无 pt-4 缩进），直接贴顶 -->
            <Transition name="fade">
              <div v-if="scanResult" :class="hasConnectionHistory ? 'pt-4' : 'pt-0'">
                <div class="flex items-center justify-between pb-2">
                  <span class="text-[var(--font-size-sm)] font-medium text-[var(--mobile-text-muted)]">
                    {{ t('hub.scanResultTitle') }}
                  </span>
                  <button
                    class="flex items-center justify-center w-11 h-11 -mr-2 rounded-[var(--bc-radius-control)] transition-colors active:opacity-80 flex-shrink-0"
                    style="color: var(--mobile-text-muted)"
                    :title="t('hub.actionClose')"
                    @click="scanResult = null"
                  >
                    <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.75"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
                <button
                  class="w-full bg-[var(--mobile-bg-card)] border border-[var(--mobile-border)] rounded-[var(--bc-radius-card)] p-4 text-left cursor-pointer transition-colors active:opacity-90 hover:border-[var(--mobile-border-hover)]"
                  :disabled="isConnecting"
                  :class="{ 'opacity-50 pointer-events-none': isConnecting }"
                  @click="onQrConnect"
                >
                  <div class="flex items-center gap-3">
                    <span class="bc-icon-box">
                      <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="3.5" y="3.5" width="6" height="6" rx="1" stroke-width="1.75" />
                        <rect x="14.5" y="3.5" width="6" height="6" rx="1" stroke-width="1.75" />
                        <rect x="3.5" y="14.5" width="6" height="6" rx="1" stroke-width="1.75" />
                        <path stroke-linecap="round" stroke-width="1.75" d="M14.5 14.5h2.5v2.5h-2.5zM20 18h.5v2.5H18" />
                      </svg>
                    </span>
                    <div class="flex-1 min-w-0">
                      <div class="text-[var(--font-size-lg)] font-medium text-[var(--mobile-text-primary)] truncate">
                        Desktop
                      </div>
                      <p class="text-[var(--font-size-sm)] mt-1 font-mono text-[var(--mobile-text-muted)]">
                        {{ scanResult.host }}:{{ scanResult.port }}
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Action Buttons (when not connected)：底部两枚 CTA 常驻（扫码 / 手动），不再随 mDNS
         开关换布局——扫描控制已移入发现面板头部，切换扫描时底部高度与内容均不跳变 -->
    <div
      v-if="!isConnected"
      class="flex-shrink-0 p-4 space-y-3"
      style="padding-bottom: max(1rem, var(--safe-area-bottom, 0px))"
    >
      <!-- 相机态与默认态互斥：切换淡入淡出，避免按钮块硬切闪动 -->
      <Transition name="fade" mode="out-in">
        <!-- 二维码扫描：启动后按钮切换为「停止扫描」（红色） -->
        <button
          v-if="showScanner"
          key="scan"
          class="w-full h-12 rounded-[var(--bc-radius-control)] text-[var(--font-size-base)] font-medium transition-colors active:opacity-80 flex items-center justify-center gap-2"
          style="
            background: var(--mobile-bg-card);
            color: var(--mobile-error);
            border: 1px solid var(--mobile-border);
          "
          :class="{ 'opacity-50': isConnecting }"
          :disabled="isConnecting"
          @click="toggleScanner"
        >
          <svg class="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          {{ t('hub.scanStop') }}
        </button>

        <div v-else key="default" class="space-y-3">
          <button
            class="w-full h-12 rounded-[var(--bc-radius-control)] text-[var(--font-size-base)] font-medium transition-colors active:opacity-80 flex items-center justify-center gap-2"
            style="background: var(--mobile-accent); color: var(--mobile-text-on-accent)"
            :class="{ 'opacity-50': isConnecting }"
            :disabled="isConnecting"
            @click="toggleScanner"
          >
            <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3.5" y="3.5" width="6" height="6" rx="1" stroke-width="1.75" />
              <rect x="14.5" y="3.5" width="6" height="6" rx="1" stroke-width="1.75" />
              <rect x="3.5" y="14.5" width="6" height="6" rx="1" stroke-width="1.75" />
              <path stroke-linecap="round" stroke-width="1.75" d="M14.5 14.5h2.5v2.5h-2.5zM20 18h.5v2.5H18" />
            </svg>
            {{ t('hub.qrConnect') }}
          </button>
          <button
            class="w-full h-12 rounded-[var(--bc-radius-control)] text-[var(--font-size-base)] font-medium transition-colors active:opacity-80 flex items-center justify-center gap-2"
            style="background: var(--mobile-bg-card); color: var(--mobile-text-secondary); border: 1px solid var(--mobile-border)"
            :class="{ 'opacity-50': isConnecting }"
            :disabled="isConnecting"
            data-testid="mobile-manual-connect"
            @click="showManualConnect = true"
          >
            <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            {{ t('hub.manualConnect') }}
          </button>
        </div>
      </Transition>
    </div>

    <!-- Manual Connect Dialog -->
    <BottomSheet
      v-model="showManualConnect"
      :title="t('hub.connectNewDevice')"
      :placeholder="t('hub.addressPlaceholder')"
      :loading="isConnecting"
      :connecting-text="t('hub.bottomSheetConnecting')"
      :cancel-connect-text="t('hub.bottomSheetCancelConnect')"
      :cancel-text="t('hub.actionCancel')"
      :confirm-text="t('hub.actionConfirm')"
      @submit="handleConnectManual"
      @cancel="handleCancelConnection"
    />

    <!-- Biometric Auth Dialog -->
    <BiometricAuthDialog
      v-model="showBiometricDialog"
      :error="authDialogError"
      :loading="authDialogLoading"
      @authenticate="runBiometricAuth"
      @switch-to-pairing="handleSwitchToPairing"
      @close="handleBiometricDialogClose"
    />

    <!-- Pairing Dialog -->
    <PairingInput
      v-model="showPairing"
      :loading="isPairing"
      :error="pairingError"
      @submit="handlePairingSubmit"
      @switch="handleSwitchToBiometric"
      @close="handlePairingClose"
    />

    <!-- Clear History Confirmation Modal -->
    <Modal v-model="showClearHistoryConfirm" :title="t('hub.clearHistory')" size="sm">
      <p style="color: var(--mobile-text-secondary)">{{ t('hub.historyClearConfirm') }}</p>
      <template #footer>
        <div class="flex justify-end gap-3">
          <Button variant="ghost" @click="showClearHistoryConfirm = false">
            {{ t('hub.actionCancel') }}
          </Button>
          <Button variant="danger" @click="confirmClearHistory">{{ t('hub.actionConfirm') }}</Button>
        </div>
      </template>
    </Modal>

    <!-- Disconnect Confirmation Modal -->
    <Modal v-model="showDisconnectConfirm" :title="t('hub.disconnect')" size="sm">
      <p style="color: var(--mobile-text-secondary)">{{ t('hub.disconnectConfirm') }}</p>
      <template #footer>
        <div class="flex justify-end gap-3">
          <Button variant="ghost" @click="showDisconnectConfirm = false">
            {{ t('hub.actionCancel') }}
          </Button>
          <Button variant="danger" @click="confirmDisconnect">{{ t('hub.disconnect') }}</Button>
        </div>
      </template>
    </Modal>

    <!-- 全局遮罩 Loading（配对请求） -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="showPairingLoading"
          class="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm mobile-ui"
          data-bedcode-surface
          style="background: var(--mobile-overlay)"
        >
          <div
            class="bc-overlay-panel rounded-[var(--bc-radius-card)] p-6 flex flex-col items-center gap-4 min-w-[200px]"
            style="background: var(--mobile-bg-card); border: 1px solid var(--mobile-border)"
          >
            <div
              class="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin"
              style="color: var(--mobile-text-muted)"
            />
            <p class="text-[var(--font-size-base)] font-medium" style="color: var(--mobile-text-secondary)">
              {{ t('hub.pairingRequesting') }}
            </p>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Loading Dialog: 连接中（弹窗遮罩，阻断重复点击） -->
    <LoadingDialog :visible="showConnectLoading" :message="connectLoadingMessage" />
  </div>
</template>

<script setup lang="ts">
/**
 * 设备 / 连接区（旧宿主 `Views/DevicesView.vue` 形态还原，2026-10-15）
 * -----------------------------------------------------------------------------
 * 还原范围（与旧宿主逐块对齐）：
 * - 页头（标题 + 连接状态小字 + 雷达扫描按钮）；内容区互斥分支（已连接 / 扫码 /
 *   mDNS 发现 / 历史 + 扫码结果）；底部常驻双 CTA（二维码连接 ⇄ 停止扫描 / 手动连接）
 * - 连接流程：手动连接必走配对；历史 / 发现连接允许存量凭据静默换新；未认证时
 *   **按 `preferredAuthMethod` 选弹窗**（生物优先且已绑定 → 直接弹并自动触发指纹，
 *   否则请求配对码）；弹窗可互切，关闭弹窗 = 断开；扫码走「连上 → 等 isConnected
 *   （200ms×10s）→ QR token 认证」
 * - 机制：二次确认弹窗（清空历史 / 断开）、全屏配对请求遮罩、连接中 LoadingDialog、
 *   连接历史相对时间 + 单项删除
 *
 * 数据面（与旧实现同源）：引擎事实走 `useHostPage`（宿主连接域投影），配对 / 认证
 * 编排走插件命令面（`bedcode.request-pairing` 等）；本组件不直连宿主命令。
 *
 * 与旧实现的三处**有意**差异（其余逐步还原）：
 * 1. 扫码面板未迁「我的二维码」信息弹窗（插件侧暂无平台投影，见 ScanPanel 头注）
 * 2. 连接历史写入时机收敛为「认证成功」（旧实现在请求配对成功后即写入——
 *    也就是说配对码还没验证就已经记了一笔；此处改为认证成功才记，语义更准）
 * 3. 新增「已连未认证」兜底入口：重连 / 启动恢复等未走本页连接流程的场景下，
 *    状态为 connected/pairing 且未认证时自动弹认证入口（旧实现在这种场景无入口，
 *    配对口不可达——对锁用例 C-C7 的保护目标改由该兜底承接）
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useHostPage, type HostDeviceTarget } from '../useHostPage'
import { connectionErrorKey } from '../errors'
import { formatLastConnected, parseAddressWithDefault } from '../utils'
import { parseQrText, type QrPayload } from '../qr'
import {
  buildTunnelView,
  modeLabelKey,
  relayTargetsOf,
  shortNodeId,
  shouldRecordHistory,
  type PeerTarget,
} from '../tunnel'
import BottomSheet from './ui/BottomSheet.vue'
import Button from './ui/Button.vue'
import LoadingDialog from './ui/LoadingDialog.vue'
import Modal from './ui/Modal.vue'
import BiometricAuthDialog from './BiometricAuthDialog.vue'
import PairingInput from './PairingInput.vue'
import ScanPanel from './ScanPanel.vue'

/** mDNS 发现项（宿主 mdnsServices 投影；只取本组件需要的字段） */
interface DiscoveredService {
  instance_name: string
  device_name?: string
  address: string
  port: number
}

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })

const ctrl = useHostPage()
const t = ctrl.t
const toast = ctrl.toast
const logger = ctrl.logger

// ── 引擎事实（SDK 投影的 Ref 经本组件 computed 收口：跨包 `import('vue').Ref`
//    类型在模板里不解引用，直接绑定会让 vue-tsc 报错；运行时 Vue 按 __v_isRef 解引用） ──
const connectionStatus = computed(() => ctrl.connectionStatus.value)
const isConnecting = computed(() => ctrl.isConnecting.value)
const currentDevice = computed(() => ctrl.currentDevice.value)
const isAuthenticated = computed(() => ctrl.isAuthenticated.value)
const mdnsScanning = computed(() => ctrl.mdnsScanning.value)
const connectionHistory = computed(() => ctrl.connectionHistory.value ?? [])

// 与旧 DevicesView / 宿主 `isConnected` 同口径：传输层已连（connected）或已认证（paired）；
// 「pairing」（已连待输入配对码）不算，否则配对弹窗背后会多出一张已连接设备卡
const isConnected = computed(
  () => connectionStatus.value === 'connected' || connectionStatus.value === 'paired',
)

// ── 本域状态（旧 DevicesView 同名同义） ──
const contentScrollRef = ref<HTMLElement | null>(null)
const showScanner = ref(false)
const showDiscovery = ref(false)
const scanResult = ref<QrPayload | null>(null)
const showManualConnect = ref(false)
const showPairing = ref(false)
const showPairingLoading = ref(false)
const showConnectLoading = ref(false)
const isPairing = ref(false)
const pairingError = ref('')
const connectionError = ref('')
const showBiometricDialog = ref(false)
const authBiometricAvailable = ref(false)
const authDialogError = ref('')
const authDialogLoading = ref(false)
const showClearHistoryConfirm = ref(false)
const showDisconnectConfirm = ref(false)
/**
 * 认证流程重入闸（同步置位）
 *
 * 两个入口会触发认证流程：`startConnection` 主动调用、「已连未认证」状态 watch 兜底。
 * 状态置位与 watch 回调可能同时在飞（连接成功到 active 确认之间），无闸时会发起两次
 * `request-pairing` / 弹出两个弹窗。
 */
let authFlowActive = false
/**
 * 扫码流程期间抑制「已连未认证」兜底入口
 *
 * 扫码是自带一次性 token 的认证路径（connect → 等 isConnected → QR 认证），
 * 途中状态会短暂落在 connected 且未认证；不抑制的话兜底 watch 会抢先请求配对码，
 * 页面同时冒出配对弹窗与扫码认证两条路径。
 */
let qrFlowActive = false
/** 本页发起的连接流程在飞（含连接后的静默认证窗口）：兜底认证入口 watch 在此期间让位 */
let connectFlowActive = false
/** 本次连接的目标（页头状态小字 / 连接弹窗文案用；与引擎 currentDevice 区分） */
const pendingDevice = ref<HostDeviceTarget | null>(null)

const hasConnectionHistory = computed(() => connectionHistory.value.length > 0)
const hasHistoryOrScanResult = computed(() => hasConnectionHistory.value || scanResult.value !== null)
const discoveredServices = computed<DiscoveredService[]>(() =>
  Array.isArray(ctrl.mdnsServices.value) ? (ctrl.mdnsServices.value as DiscoveredService[]) : [],
)


// ── 内网穿透（T09）：状态栏事实全部来自宿主；本组件不推断传输路径 ──
const tunnelStatus = computed(() => ctrl.tunnelStatus.value)
/** 本会话试过拨号（句柄或对端 id 存在）：失败态也要能展示「内网不可达 + 尝试外网」 */
const tunnelAttempted = computed(() => !!ctrl.tunnelNodeId.value)
const tunnelView = computed(() => buildTunnelView(tunnelStatus.value, !!ctrl.tunnelHandle.value))
/** 持久化的对端记录里具备中继拨号条件的设备（重启后仍可免扫码重连） */
const relayTargets = computed(() => relayTargetsOf(tunnelStatus.value))
/**
 * 穿透状态的文字色（只给文字上色，不给底色）
 *
 * 原先返回 `chip-*` 类名，除了把「模式」渲染成一条胶囊，default 分支的 `chip-slate`
 * 在宿主词表里根本不存在——归因缺失时那条胶囊会掉成透明（显示成无样式文字）。
 * 现在返回 CSS 颜色：ok 中立、warn 琥珀、error 红、其余取次要文字色。
 */
const tunnelToneColor = computed(() => {
  switch (tunnelView.value?.tone) {
    case 'ok':
      return 'var(--mobile-text-primary)'
    case 'warn':
      return 'var(--mobile-warning)'
    case 'error':
      return 'var(--mobile-error)'
    default:
      return 'var(--mobile-text-secondary)'
  }
})
const tunnelReasonText = computed(() =>
  tunnelView.value?.reasonKey ? t(tunnelView.value.reasonKey) : '',
)

/** 手动连接的默认端口（旧实现读 `mobile-settings.defaultPort`，缺省 8765） */
const defaultPort = computed(() => {
  const value = Number(ctrl.mobileSettings.value?.defaultPort)
  return Number.isFinite(value) && value > 0 ? value : 8765
})

/** 连接中弹窗文案（旧口径：有目标名带名，否则纯「正在连接…」） */
const connectLoadingMessage = computed(() =>
  pendingDevice.value?.name
    ? t('hub.connectionStatus.connecting', { name: pendingDevice.value.name })
    : t('hub.connectionStatus.connectingPlain'),
)

/** 页头状态小字（旧 `connectionStatusText` 口径逐字还原） */
const connectionStatusText = computed(() => {
  switch (connectionStatus.value) {
    case 'connecting':
      return pendingDevice.value?.name
        ? t('hub.connectionStatus.connecting', { name: pendingDevice.value.name })
        : t('hub.connectionStatus.connectingPlain')
    case 'connected':
      return t('hub.connectionStatus.connected')
    case 'pairing':
      return t('hub.connectionStatus.pairing')
    case 'paired':
      return t('hub.connectionStatus.paired')
    case 'error':
      return connectionError.value ? t(connectionError.value) : t('hub.connectFailed')
    default:
      return connectionStatus.value === 'disconnected' ? t('hub.connectionStatus.disconnected') : ''
  }
})

// ==================== 生命周期（旧 onMounted / onActivated / onDeactivated） ====================

/** 页面可见时重读历史；发现区展开则后台续扫并保留已发现设备（旧 onActivated 口径） */
function onPageActivated(): void {
  void ctrl
    .loadHistory(true)
    .catch((e) => logger.warn(`[host] load connection history failed: ${errText(e)}`))
  // 远端设备列表来自持久化对端记录：切回连接页时刷新（别的连接 / 事件可能已更新）
  void ctrl.refreshTunnelStatus()
  if (showDiscovery.value) void startMdnsScan({ keepResults: true })
}

onMounted(() => {
  onPageActivated()
  void ctrl.refreshBiometric()
  // 重启后对账：模式 / 对端记录以宿主 `status` 为准（事件不重放）
  void ctrl.refreshTunnelStatus()
})

// 页签容器常驻挂载（AppRoot 首次访问后不卸载面板）：用 active 复刻旧
// onActivated / onDeactivated 语义——切走停扫、切回续扫并重读历史
watch(
  () => props.active,
  (visible) => {
    if (visible) onPageActivated()
    else void stopMdnsScan()
  },
)

// 组件真被销毁时也停扫描（面板卸载路径），否则 mDNS 一直跑到进程结束
onUnmounted(() => {
  void stopMdnsScan()
})

// 模式切换（二维码 / 扫描发现 / 历史）复位内容区滚动位置：各区块高度不同，内容收缩时
// scrollTop 会被浏览器夹到更小的值，切回长列表时停在半空中段（看起来像页面跳了一下）
watch([showScanner, showDiscovery], async () => {
  await nextTick()
  const el = contentScrollRef.value
  if (el) el.scrollTop = 0
})

// 连接成功后收起两个扫描视图（二维码 / mDNS），断开后回到历史列表布局
watch(isConnected, (connected) => {
  if (connected) {
    showScanner.value = false
    closeDiscovery()
  }
})

// 认证完成（false → true）：记连接历史 + 拉起会话数据（会话与连接的联动，旧 DevicesView
// 的 watch(pairing) 口径）；重新连接同一设备时也刷新
watch(isAuthenticated, (authenticated, wasAuthenticated) => {
  if (!authenticated || wasAuthenticated) return
  const device = pendingDevice.value ?? currentDevice.value
  if (device) {
    // 回环代理是本连接的临时端口（隧道 connect 每次新建、关闭即失效）：写进历史会让
    // 下次点击连到死端口，且每次重连都多一条垃圾记录。设备寻址的真历史由扫码 /
    // 连接串路径按原始 LAN 地址写入。
    if (shouldRecordHistory(device.address)) {
      void ctrl.addHistory(
        `${device.address}:${device.port}`,
        device.name || device.address,
      )
    } else {
      logger.info(
        `[tunnel] history skipped for loopback proxy ${device.address}:${device.port}`,
      )
    }
  }
  pendingDevice.value = null
  void ctrl
    .refreshSessions()
    .catch((e) => logger.warn(`[host] refresh sessions after auth failed: ${errText(e)}`))
})

// 「已连未认证」兜底入口：重连成功 / 启动恢复 JWT 失效等**未走本页连接流程**的场景，
// 旧实现在此无任何认证入口（受保护端点全 401）。按首选认证方式弹入口，保证配对口可达。
// 本页自己发起的连接（connectFlowActive）与扫码流程（qrFlowActive）自行决定认证入口，
// 本 watch 一律让位——否则会在静默换新 JWT 未返回的窗口里抢先弹配对口。
watch(
  [connectionStatus, isAuthenticated],
  ([status, authenticated]) => {
    if (authenticated || isConnecting.value || qrFlowActive || connectFlowActive) return
    if (status !== 'connected' && status !== 'pairing') return
    if (showPairing.value || showBiometricDialog.value || authFlowActive) return
    // 本页未发起过连接（重连 / 启动恢复场景）时，用引擎当前设备作认证目标
    if (!pendingDevice.value && currentDevice.value) pendingDevice.value = { ...currentDevice.value }
    void openAuthEntry()
  },
  // immediate：页面挂载时就已处于「已连未认证」（重连恢复）也要给认证入口
  { immediate: true },
)

// ==================== 连接编排（旧 startConnection） ====================

/**
 * 连接 + 认证编排
 *
 * @param skipPairing 历史 / 发现连接为 true：允许用宿主持有的凭据静默换新（免重配对）；
 *                    手动连接为 false：必须走认证流程
 */
async function startConnection(device: HostDeviceTarget, skipPairing = false): Promise<void> {
  pendingDevice.value = device
  connectionError.value = ''
  showConnectLoading.value = true
  // 本页连接流程在飞：期间由本函数决定认证入口，兜底 watch（专为重连/挂载场景而设）
  // 不得插手——否则它在「已连上、静默换新还没返回」的窗口里抢先请求配对码
  connectFlowActive = true

  try {
    const { authenticated } = await ctrl.connectDevice(device, { silentAuth: skipPairing })
    // 以本次静默认证的结果为准（不读状态位：认证成功与 ws_paired 事件到达之间
    // 存在窗口，读状态位会把「已静默换新成功」误判成需配对）；watch(isAuthenticated)
    // 负责后续收尾（记历史 / 拉会话）
    if (authenticated || isAuthenticated.value) return

    showConnectLoading.value = false
    // 状态 watch 可能已领先一步发起认证（openAuthEntry 已把弹窗打开）：不重复请求配对码
    if (showPairing.value || showBiometricDialog.value || authFlowActive) return
    await openAuthEntry()
  } catch (error) {
    const msg = errText(error)
    connectionError.value = ctrl.deviceError.value || msg
    logger.error(`[host] startConnection failed: address=${device.address} ${msg}`)
    toast.showToast(t(connectionErrorKey(msg)), 'error')
    // 连接失败时确保前后端状态一致：断开后端连接 + 重置前端状态
    await ctrl.disconnect().catch(() => {})
  } finally {
    connectFlowActive = false
    showConnectLoading.value = false
    showPairingLoading.value = false
  }
}

/** 认证入口选择（旧 Step 2.5）：生物优先且已绑定 → 生物弹窗；否则请求配对码 */
async function openAuthEntry(): Promise<void> {
  // 闸门双层：流程在飞（authFlowActive）与弹窗已开（状态 watch 与连接流程两条入口）
  if (authFlowActive || showPairing.value || showBiometricDialog.value) return
  authFlowActive = true
  try {
    await ctrl.refreshBiometric()
    const keyStatus = ctrl.biometric.value
    authBiometricAvailable.value = !!(keyStatus?.deviceSupported && keyStatus?.hasKey)
    authDialogError.value = ''
    pairingError.value = ''

    const preferBiometric =
      ctrl.mobileSettings.value?.preferredAuthMethod === 'biometric' && authBiometricAvailable.value
    if (preferBiometric) await openBiometricAuth()
    else await startPairingFlow()
  } finally {
    authFlowActive = false
  }
}

// Cancel connection
async function handleCancelConnection(): Promise<void> {
  showConnectLoading.value = false
  await ctrl.cancelConnect()
  connectionError.value = t('hub.userCancelled')
}

// 打开生物认证弹窗并立即触发指纹验证（打开即弹系统生物识别）
async function openBiometricAuth(): Promise<void> {
  // 连接中弹窗让位于生物认证弹窗
  showConnectLoading.value = false
  showBiometricDialog.value = true
  authDialogError.value = ''
  await runBiometricAuth()
}

/** 生物认证：指纹识别成功后才走挑战-应答拿到凭据，失败留在弹窗内可重试或切换 */
async function runBiometricAuth(): Promise<void> {
  const device = pendingDevice.value ?? currentDevice.value
  if (!device) return

  authDialogLoading.value = true
  authDialogError.value = ''
  try {
    const ok = await ctrl.authenticateWithBiometric()
    if (ok) {
      showBiometricDialog.value = false
      return
    }
    // 生物认证失败/取消 → 弹窗内展示错误，可重试指纹或切换配对码
    authDialogError.value = t('hub.biometricFailed')
  } catch (e) {
    authDialogError.value = biometricAuthErrorText(e)
  } finally {
    authDialogLoading.value = false
  }
}

/** 将桌面端拒绝原因映射为友好文案（旧 `biometricAuthErrorText` 口径） */
function biometricAuthErrorText(e: unknown): string {
  const msg = errText(e)
  if (/CREDENTIAL_NOT_BOUND|NOT_PAIRED|credential not bound|device not paired/i.test(msg)) {
    return t('hub.biometricNotBoundOnDesktop')
  }
  if (/CHALLENGE_INVALID|SIGNATURE_INVALID|challenge|signature/i.test(msg)) {
    return t('hub.biometricFailed')
  }
  return msg
}

/** 配对码认证（兜底方式）：请求配对码后进入输入弹窗 */
async function startPairingFlow(): Promise<void> {
  const device = pendingDevice.value ?? currentDevice.value
  if (!device) return

  // 连接中弹窗让位于配对请求弹窗
  showConnectLoading.value = false
  showPairingLoading.value = true
  try {
    const pairingTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(t('hub.pairingTimeout'))), 15000),
    )
    await Promise.race([ctrl.requestPairing(), pairingTimeout])
    showPairing.value = true
  } catch (error) {
    // 配对失败或超时时断开连接
    logger.error(`[host] pairing request failed: ${errText(error)}`)
    connectionError.value = errText(error)
    toast.showToast(t(errText(error)), 'error')
    await ctrl.disconnect().catch(() => {})
  } finally {
    showPairingLoading.value = false
  }
}

/** 配对码弹窗 → 切换到生物认证；未绑定生物认证时提示，无法切换 */
async function handleSwitchToBiometric(): Promise<void> {
  if (!authBiometricAvailable.value) {
    toast.showToast(t('hub.biometricNotBound'), 'warning')
    return
  }
  showPairing.value = false
  pairingError.value = ''
  await openBiometricAuth()
}

/** 生物认证弹窗 → 切换到配对码（兜底方式） */
async function handleSwitchToPairing(): Promise<void> {
  showBiometricDialog.value = false
  authDialogError.value = ''
  await startPairingFlow()
}

/** 用户关闭生物认证弹窗 → 断开连接，保持前后端状态一致 */
function handleBiometricDialogClose(): void {
  showBiometricDialog.value = false
  authDialogError.value = ''
  connectionError.value = t('hub.userCancelled')
  void ctrl.disconnect().catch(() => {})
}

/** 用户关闭配对码弹窗 → 断开连接，保持前后端状态一致 */
function handlePairingClose(): void {
  showPairing.value = false
  pairingError.value = ''
  connectionError.value = t('hub.userCancelled')
  void ctrl.disconnect().catch(() => {})
}

/** 提交配对码（旧 `handlePairingSubmit`） */
async function handlePairingSubmit(code: string): Promise<void> {
  if (!pendingDevice.value) return

  isPairing.value = true
  pairingError.value = ''
  try {
    const success = await ctrl.verifyPairingCode(code)
    if (success) {
      showPairing.value = false
    } else {
      pairingError.value = t('hub.codeVerifyFailed')
    }
  } catch (error) {
    pairingError.value = errText(error)
  } finally {
    isPairing.value = false
  }
}

// ==================== 连接入口（历史 / 手动 / mDNS / 扫码） ====================

/** 从连接历史连接（允许存量凭据静默换新） */
async function handleConnectFromHistory(item: { address: string; name?: string }): Promise<void> {
  if (isConnecting.value) return
  const parsed = parseAddressWithDefault(`${item.address}`, defaultPort.value)
  if (!parsed) {
    logger.warn(`[host] history entry address invalid: ${item.address}`)
    return
  }
  await startConnection({ ...parsed, name: item.name || parsed.address }, true)
}

/**
 * 手动连接（必须走配对流程；未写端口回落默认端口）
 *
 * 同一输入框也接受桌面「复制连接串」产出的 `wasmnest://pair/…`：解析走扫码的
 * 同一个纯函数 `parseQrText`，成功后的路径与扫码完全一致（结果卡片 → token 认证），
 * 不为连接串另开一条绕过 token 的明文捷径。
 */
async function handleConnectManual(address: string): Promise<void> {
  if (isConnecting.value) return
  if (address.trim().startsWith('wasmnest://')) {
    const result = parseQrText(address)
    if (!result.ok) {
      // 连接串含 token：只记结论，不落原文
      logger.warn(`[host] manual pair link rejected: reason=${result.reason}`)
      toast.showToast(t('hub.pairLinkInvalid'), 'error')
      return
    }
    showManualConnect.value = false
    handleScanResult(result.payload)
    return
  }
  const parsed = parseAddressWithDefault(address, defaultPort.value)
  if (!parsed) {
    // 格式错误是本地校验失败（非引擎错误）：明确告知期望格式，同时落日志便于排障
    logger.warn(`[host] manual address invalid: ${address}`)
    toast.showToast(t('hub.manualInvalid'), 'error')
    return
  }
  showManualConnect.value = false
  await startConnection({ ...parsed, name: parsed.address }, false)
}

/** 点击发现的设备（允许存量凭据静默换新） */
async function handleDiscoverConnect(service: DiscoveredService): Promise<void> {
  if (isDiscoverCurrentDevice(service)) return
  if (isConnecting.value) return
  await startConnection(
    { address: service.address, port: service.port, name: service.device_name || service.instance_name },
    true,
  )
}

/** 该发现设备是否为当前已连接的设备（连接态行样式 + 点击守卫） */
function isDiscoverCurrentDevice(service: DiscoveredService): boolean {
  return isConnected.value && currentDevice.value?.address === service.address
}

// 切换二维码扫描：非扫描态点击「二维码连接」打开内嵌相机；扫描中点击「停止扫描」收起，
// 若已识别到二维码则下方出现扫描结果卡片（与 mDNS 发现互斥）
function toggleScanner(): void {
  const next = !showScanner.value
  showScanner.value = next
  // 二维码与 mDNS 发现互斥：打开相机时收起发现区，并停掉后台 mDNS 扫描
  if (next) closeDiscovery()
}

/** ScanPanel 识别到有效二维码：关闭扫描视图，结果以卡片展示在连接历史下方 */
function handleScanResult(result: QrPayload): void {
  scanResult.value = result
  showScanner.value = false
}

/** 从扫描结果卡片发起连接：WebSocket 连接 + QR token 认证（旧 `connectFromScanResult`） */
async function onQrConnect(): Promise<void> {
  const result = scanResult.value
  if (!result || isConnecting.value) return

  const device: HostDeviceTarget = {
    address: result.host,
    port: result.port,
    name: 'Desktop',
  }
  pendingDevice.value = device
  connectionError.value = ''
  showConnectLoading.value = true
  qrFlowActive = true

  try {
    // Step 0: QR v2 带 `peer` → 先建隧道，后续一切业务都走 127.0.0.1 回环代理；
    // 旧版载荷（无 `peer`）保持原 LAN 直连路径不回归
    const proxy = await ctrl.openTunnel(result)
    const target: HostDeviceTarget = proxy
      ? { address: proxy.address, port: proxy.port, name: 'Desktop' }
      : device
    // `pendingDevice` 保留**原设备**（连接历史 / 配对展示用原 host:port）；
    // 只有传输层拨号改走回环代理，不能把 127.0.0.1 写进历史（重连会失效）。
    pendingDevice.value = device

    // Step 1: 配对窗口只放行 `/api/auth/*`——先只设目标（不探测、不建通道）。
    // 否则 `/api/health` 会先消费隧道的一次性票据，真正的认证请求反而被
    // `ticket-expired` 拒绝（C1）。认证成功（桌面写 trust）后宿主 supervisor
    // 自动建立事件 WS，不需要再 `connectDevice` 一次。
    await ctrl.connectDevice(target, { pairingOnly: true, silentAuth: false })

    // Step 2: 用 QR token 认证（HTTP `/api/auth/qr-connect`）
    const ok = await ctrl.authenticateWithQr(result.token)
    if (!ok) throw new Error(t('hub.scanQrExpired'))
    scanResult.value = null
  } catch (error) {
    const msg = errText(error)
    connectionError.value = ctrl.deviceError.value || msg
    logger.error(`[host] QR connect failed: ${msg}`)
    toast.showToast(t(connectionErrorKey(msg)), 'error')
    // 连接失败时确保前后端状态一致：先关通道（避免遗留回环监听）再断连接
    await ctrl.closeTunnel()
    await ctrl.disconnect().catch(() => {})
    await ctrl.loadHistory(true).catch(() => {})
  } finally {
    qrFlowActive = false
    showConnectLoading.value = false
  }
}

// ==================== mDNS 扫描发现 ====================

/** 切换 mDNS 扫描发现区（页头雷达按钮）：展开自动开始扫描，收起停止扫描 */
function toggleDiscovery(): void {
  const next = !showDiscovery.value
  showDiscovery.value = next
  if (next) {
    showScanner.value = false
    void startMdnsScan()
  } else {
    void stopMdnsScan()
  }
}

/** 关闭扫描发现区（面板头部 × 按钮，或切换到其它模式时） */
function closeDiscovery(): void {
  showDiscovery.value = false
  void stopMdnsScan()
}

/**
 * 开始/重新开始 mDNS 扫描
 *
 * @param options.keepResults 保留已发现列表（切回连接页时的后台续扫用）
 */
async function startMdnsScan(options?: { keepResults?: boolean }): Promise<void> {
  await ctrl.startScan(options?.keepResults ?? false)
}

/** 停止 mDNS 扫描 */
async function stopMdnsScan(): Promise<void> {
  await ctrl.stopScan()
}

/** 操作栏按钮：扫描中「停止扫描」/ 已停止「重新扫描」 */
function toggleMdnsScan(): void {
  if (mdnsScanning.value) void stopMdnsScan()
  else void startMdnsScan()
}

// ==================== 连接历史维护 ====================

function removeFromHistory(address: string): void {
  void ctrl.removeHistory(address)
}

function confirmClearHistory(): void {
  showClearHistoryConfirm.value = false
  void ctrl.clearHistory().catch((e) => {
    logger.error(`[host] clear connection history failed: ${errText(e)}`)
    toast.showToast(t('hub.historyClearFailed'), 'error')
  })
}

// ==================== 断开 ====================

function handleDisconnect(): void {
  showDisconnectConfirm.value = true
}

/**
 * 经中继连接一个已记录的对端（远程设备列表 / 失败态「尝试外网」共用）
 *
 * - 先用持久化的 relay 候选重建通道（已配对无需新票据）；
 * - 通道建好后走与扫码相同的连接编排：连回环代理 → 存量凭据静默换新
 *   （换新失败时按既有流程回落配对码 / 生物认证入口）；
 * - 失败按宿主错误码给文案；失败路径先关通道，不留本地监听。
 */
async function connectViaRelay(target: PeerTarget): Promise<void> {
  // 对话框已开（拨号中）或宿主正在连接：重复点击会建两条通道
  if (isConnecting.value || showConnectLoading.value) return
  showConnectLoading.value = true
  try {
    const proxy = await ctrl.tryWan(target)
    await startConnection(
      { address: proxy.address, port: proxy.port, name: target.deviceName || 'Desktop' },
      true,
    )
  } catch (e) {
    const message = errText(e)
    connectionError.value = t(message)
    logger.error(`[tunnel] relay connect failed: ${message}`)
    toast.showToast(t(message), 'error')
    await ctrl.closeTunnel()
  } finally {
    showConnectLoading.value = false
  }
}

/** 远程设备列表点选：用持久化 relay 候选重连，不需要桌面用户重发二维码 */
async function handleRelayConnect(target: PeerTarget): Promise<void> {
  await connectViaRelay(target)
}

/**
 * 手动「尝试外网」：拿已记录对端的 relay 候选让宿主重拨。
 *
 * 用户意图就是判据（宿主归因 `user`）；本组件不自己把 lan-unreachable 改判成外网。
 * 失败按宿主错误码给文案，不弹模态。
 */
async function handleTryWan(): Promise<void> {
  const nodeId = ctrl.tunnelNodeId.value
  // 只认**当前这次**拨号的对端记录：拿别的对端（如 targets[0]）兜底会把「尝试外网」
  // 拨到另一台设备，认证必然失败且界面给出的原因全部指向错误的设备。
  const target: PeerTarget | undefined = nodeId
    ? tunnelStatus.value?.targets?.find((item) => item.nodeId === nodeId)
    : undefined
  if (!target) {
    connectionError.value = t('hub.tunnelErrorNoPeerRecord')
    toast.showToast(t('hub.tunnelErrorNoPeerRecord'), 'error')
    return
  }
  await connectViaRelay(target)
}

async function confirmDisconnect(): Promise<void> {
  showDisconnectConfirm.value = false
  try {
    // 先关通道再断 WS：反序会让宿主自动重连去拨已关闭的回环端口（静默重试）
    await ctrl.closeTunnel()
    await ctrl.disconnect()
  } catch (e) {
    logger.error(`[host] disconnect failed: ${errText(e)}`)
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
</script>

<style scoped>
/* 标题下连接状态小字：取根级最小字阶（11 / 12 / 14px）。
   原先这里写 9px 起，手机上「已连接」比说明文字还小一档，读不动也随字号设置不走。 */
.connection-status-subtitle {
  font-size: var(--font-size-sm);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.config-list-enter-active {
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.config-list-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.config-list-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.config-list-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.config-list-move {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 动效降级：系统开启「减少动态效果」时，本视图的模式切换/列表动效直接呈现终态 */
@media (prefers-reduced-motion: reduce) {
  .fade-enter-active,
  .fade-leave-active,
  .config-list-enter-active,
  .config-list-leave-active,
  .config-list-move {
    transition: none !important;
  }
}

/* ==================== mDNS 发现设备列表（融合自原扫描页 DiscoverView） ==================== */

/* 尺寸 / 内边距 / 行高一律交给 .group-row：发现列表此前自带一套 clamp 内边距
   （12px 边、48 高），与下面的中继 / 历史行（16px 边、56 高）对不齐，
   同一屏两张卡里的行首图标差了 4px。 */

/* 行首图标：中性底（与 DeviceSection 里的 .bc-icon-box 同形，尺寸小一档）。
   颜色此前按列表分别取 cyan / amber / emerald——同一台设备在「发现」「历史」
   「已连接」三处是三种颜色，颜色因此不再表达任何东西。 */
.device-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
  background: var(--bc-icon-bg);
  color: var(--bc-icon-fg);
}

.device-name {
  font-size: var(--font-size-base);
  font-weight: 500;
  line-height: 1.2;
  color: var(--mobile-row-title);
}

.device-addr {
  margin-top: 0.125rem;
  font-size: var(--font-size-sm);
  line-height: 1.2;
  color: var(--mobile-row-sub);
}

/* 已连接设备：非交互行，无按压反馈（状态由行尾的绿点承担，图标底保持中性） */
.group-row.is-connected {
  cursor: default;
}

.group-row.is-connected:active {
  background: none;
}
</style>
