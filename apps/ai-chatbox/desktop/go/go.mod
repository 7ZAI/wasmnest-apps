// ai-chatbox 桌面端 Go 版后端（issue #21 Solution 5 试点：TinyGo wasip2 组件，
// 前端零改动、命令契约不变）。SDK 壳经 replace 指回平台仓源码（首期不发布，
// 与 npm 侧 file: 依赖同一消费形态；R1 兄弟布局 5 级上溯）。
module github.com/7zai/wasmnest-app-ai-chatbox

go 1.27.3

require (
	github.com/7zai/wasmnest-plugin-sdk-go v0.0.0
	go.bytecodealliance.org/cm v0.3.0
)

replace github.com/7zai/wasmnest-plugin-sdk-go => ../../../../../wasmnest/wasmnest-desktop/packages/plugin-sdk-desktop/go
