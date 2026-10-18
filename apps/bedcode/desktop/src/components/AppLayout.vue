<template>
  <!-- 独立窗口路由（终端窗口）：不显示任何布局元素 -->
  <template v-if="isBareWindow">
    <router-view />
  </template>

  <!-- 普通路由：侧边栏工作台布局（壳标题栏 + Sidebar + 内容区）
       ——标题栏归宿主壳（ShellToolbar，应用路由全程常驻），本应用只占其下方区域，
       高度取 h-full（宿主挂载槽已定高）：写 h-screen 会按整个窗口算，底边超出槽。 -->
  <template v-else>
    <div class="flex flex-col h-full desktop-ui">
      <div class="flex flex-1 overflow-hidden">
        <!-- Sidebar -->
        <Sidebar />

        <!-- Main Content：过渡容器必须带 page-swap（页面过渡体系的定位上下文，
             效果变体与时长 token 见 style.css「页面过渡动效」节） -->
        <main class="page-swap flex-1 overflow-hidden bg-page">
          <router-view v-slot="{ Component }">
            <!-- 不加 mode="out-in"：out-in 在「旧页退场完成」与「新页入场挂载」之间会
                 留出一帧以上的空容器窗口，露出近黑的 --bg-page，即黑屏 + 闪烁。默认
                 重叠模式下旧页作为绝对定位层退场、新页从第一帧就占位，容器永不断层。 -->
            <Transition name="page">
              <!-- 路由页面 KeepAlive：切换路由不销毁页面视图（切走时流式监听继续、
                   切回保留离开时画面）；:key=fullPath 配合缓存：同一路径命中同一实例，
                   路由参数变化仍重建。max 限制缓存总量（LRU 淘汰） -->
              <KeepAlive :max="8">
                <component :is="Component" :key="$route.fullPath" />
              </KeepAlive>
            </Transition>
          </router-view>
        </main>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
/**
 * 应用布局 — 侧边栏工作台（宿主前端下沉后的桌面产品外壳）
 *
 * 与旧宿主 DesktopLayout 的差异：插件状态栏 / 命令面板 / 全局弹窗三个插件
 * 运行时挂载点随贡献面机制退役（D6），侧边栏为静态菜单表（D3）。bareWindow
 * 路由（终端独立窗口）不套外壳，判据取路由 meta。
 *
 * 标题栏（品牌 / 窗口控制）**不在这里**：应用路由的壳标题栏由宿主 ShellHost 常驻
 * 渲染，本应用只占标题栏以下的内容区（2026-10-17 用户裁决，防应用入侵壳 chrome）。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'

const route = useRoute()

// 判据取路由 meta 而非路径前缀：新增的独立窗口路由自动获得「裸窗口」语义
const isBareWindow = computed(() => route.meta.bareWindow === true)
</script>
