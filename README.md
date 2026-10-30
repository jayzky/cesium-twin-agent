# Cesium-Twin-Agent

Three.js 三维积水态势与巡检演示。仓库名称保留历史命名，当前前端使用 Three.js，并未集成 Cesium、实测水文、排水管网或实际无人机服务。

## 已实现内容

- 通过共享配置集中管理基准、警戒、最高模拟水位、降雨预设与巡检周期。
- 模拟累计降雨按 `水位增量 = 降雨量(mm) × 0.016` 计算，取两位小数并限制在最高模拟水位。该规则仅供交互演示，不是水动力模型。
- 模拟水位与场景高度采用 `sceneY = waterLevelM - sceneDatumM`；当前场景以一个场景单位对应一个模拟米绘制。
- 根据建筑网格的实际包围盒底部和水面范围统计受影响建筑，并高亮相关网格；判断为平均水面高于建筑底部且平面范围相交。GLSL 波浪不参与统计，不代表实际灾损或危险等级。
- 浏览器巡检采用 Three.js Catmull-Rom 曲线，按帧间隔 delta 和配置周期推进，支持开始、暂停、继续及重置。没有固定 FPS 承诺。
- Python `LinearWaypointInterpolator` 只做航点分段线性插值，与浏览器样条路径实现分开。
- 一键导出带版本的 JSON 场景快照，记录模拟水位、配置、逐栋建筑包围盒及影响判定、巡检进度、相机视角和当前性能采样。
- 浏览器面板展示真实动画帧间隔的平均 FPS、平均与 P95 帧间隔、实际窗口时长及样本数；渲染暂停或页面隐藏时停止模拟时间并清空采样，恢复后重新计时。

## 运行与验证

需要 Python 3.10+、pytest，以及支持 ES 模块和 `node:test` 的 Node 18+。在仓库目录运行：

```powershell
python -m pytest -q
node --test tests/test_frontend.mjs
```

已配置 npm 环境时也可执行 `npm run test:js`，该脚本只运行前端逻辑测试；原有 `npm test` 仍运行 Python 测试。

跨语言水位契约测试会调用 PATH 中的 Node。若使用其他 Node 路径，可先设置 `$env:NODE_BINARY`；没有 Node 时该项显式跳过，前端测试仍需单独执行。

浏览器需要通过静态 HTTP 读取 ES 模块和共享 JSON。手动在仓库目录启动：

```powershell
python -m http.server 8001 --bind 127.0.0.1
```

随后访问 `http://127.0.0.1:8001/src/client/twin_viewer.html`。使用完毕按 Ctrl+C 关闭静态服务。直接双击 `file://` 页面不能正常读取配置与模块。

页面中的 Three.js、OrbitControls 与图标仍依赖 CDN 网络；无法加载时页面显示初始化失败，不会声称后端正常。

## 可核查的演示与导出

1. 选择「累计降雨 200 mm」，确认模拟水位为 21.70 m，再查看高亮建筑和计数。
2. 开始巡检，暂停并继续，确认位置保留；「重置巡检位置」恢复起点。
3. 点击「导出场景快照 JSON」。导出文件带有 `simulation: true`、`schema_version`、`config_version` 和 `scene_id`，包含完整模拟配置。`impact.buildings` 逐栋记录包围盒、与水面范围是否相交、底部是否低于平均水面及最终判定，可自行复核汇总数量。`mean_water_above_bottom_m` 只是平均水面相对模拟建筑底部的高度差，范围外记录为 `null`，不表示灾损或风险。
4. 查看性能面板，记录当时的窗口、样本数、视口和设备环境。点击「暂停渲染与采样」，确认模拟时间与样本停止；恢复后从空窗口重新采样。巡检自身的暂停只停巡检，水面与相机仍在渲染，所以性能采样继续。

性能默认保留最近 5 秒内结束的帧间隔，平均 FPS 为 `样本数 × 1000 / 帧间隔总毫秒数`，P95 使用 nearest-rank。实际时长在面板及导出中明确记录；单个长帧跨过窗口起点时，实际时长可能大于 5 秒。数据衡量 `requestAnimationFrame` 间隔，不是 GPU 执行时间。导出中的 `performance` 和 `view` 可记录演示环境，不构成固定帧率或跨设备基准结论。WebGL 上下文丢失时显示明确错误并停止渲染，保留导出按钮，刷新后重新初始化。

## 文件与接口边界

- `src/shared/scenario_config.json`：Python 与浏览器共用的模拟约定与预设。
- `src/client/scenario_model.mjs`：可在 Node 中测试的水位、建筑判定、巡检状态、场景快照及性能窗口逻辑。
- `src/client/twin_viewer.html`：Three.js 场景和本地交互。
- `src/server/scenario_bridge.py`：Python 模拟命令处理，支持 `SIMULATE_RAINFALL`、`SET_PRESET`、`RESET_WATER` 和线性示例航线输出。

浏览器只读取共享配置，没有调用 Python 命令处理器；两者数值约定通过测试核对，不代表前后端通信已经打通。界面日志为浏览器本地事件，不是 WebSocket 或 Agent 决策记录。建筑、预设降雨和航线均为模拟数据。
