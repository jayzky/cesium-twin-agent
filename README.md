# Cesium-Twin-Agent

Three.js 三维积水态势与巡检演示。仓库名称保留历史命名，当前前端使用 Three.js，并未集成 Cesium、实测水文、排水管网或实际无人机服务。

## 已实现内容

- 通过共享配置集中管理基准、警戒、最高模拟水位、降雨预设与巡检周期。
- 模拟累计降雨按 `水位增量 = 降雨量(mm) × 0.016` 计算，取两位小数并限制在最高模拟水位。该规则仅供交互演示，不是水动力模型。
- 模拟水位与场景高度采用 `sceneY = waterLevelM - sceneDatumM`；当前场景以一个场景单位对应一个模拟米绘制。
- 根据建筑网格的实际包围盒底部和水面范围统计受影响建筑，并高亮相关网格；判断为平均水面高于建筑底部且平面范围相交。GLSL 波浪不参与统计，不代表实际灾损或危险等级。
- 浏览器巡检采用 Three.js Catmull-Rom 曲线，按帧间隔 delta 和配置周期推进，支持开始、暂停、继续及重置。没有固定 FPS 承诺。
- Python `LinearWaypointInterpolator` 只做航点分段线性插值，与浏览器样条路径实现分开。

## 运行与验证

在仓库目录运行测试，无需新增依赖：

```powershell
& 'D:/anaconda/python.exe' -m pytest -q
node --test tests/test_frontend.mjs
```

已配置 npm 环境时也可执行 `npm run test:js`，该脚本只运行前端逻辑测试；原有 `npm test` 仍运行 Python 测试。

跨语言水位契约测试会调用 PATH 中的 Node。若使用其他 Node 路径，可先设置 `$env:NODE_BINARY`；没有 Node 时该项显式跳过，前端测试仍需单独执行。

浏览器需要通过静态 HTTP 读取 ES 模块和共享 JSON。手动在仓库目录启动：

```powershell
& 'D:/anaconda/python.exe' -m http.server 8001 --bind 127.0.0.1
```

随后访问 `http://127.0.0.1:8001/src/client/twin_viewer.html`。使用完毕按 Ctrl+C 关闭静态服务。直接双击 `file://` 页面不能正常读取配置与模块。

页面中的 Three.js、OrbitControls 与图标仍依赖 CDN 网络；无法加载时页面显示初始化失败，不会声称后端正常。

## 文件与接口边界

- `src/shared/scenario_config.json`：Python 与浏览器共用的模拟约定与预设。
- `src/client/scenario_model.mjs`：可在 Node 中测试的水位、建筑判定和巡检状态逻辑。
- `src/client/twin_viewer.html`：Three.js 场景和本地交互。
- `src/server/scenario_bridge.py`：Python 模拟命令处理，支持 `SIMULATE_RAINFALL`、`SET_PRESET`、`RESET_WATER` 和线性示例航线输出。

浏览器只读取共享配置，没有调用 Python 命令处理器；两者数值约定通过测试核对，不代表前后端通信已经打通。界面日志为浏览器本地事件，不是 WebSocket 或 Agent 决策记录。建筑、预设降雨和航线均为模拟数据。
