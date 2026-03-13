# NutBot 截图与 AI 交互优化计划

## 现有架构分析

### 当前流程
1. `screenshot.ts` 截图 → 调用 `ocr-som.ts` 进行 SoM 标注
2. SoM 服务需要本地 Python 服务运行（OCR-SoM API）
3. 返回带编号元素的标注图和元素列表给 AI
4. AI 根据编号选择元素，然后 `computer.ts` 执行点击

### 存在的问题
1. **依赖复杂**：需要额外运行 SoM Python 服务
2. **流程繁琐**：截图 → SoM 标注 → 返回编号元素 → AI 选择编号 → 点击
3. **维护困难**：SoM 服务可能遇到 GPU/cuDNN 等问题
4. **不够精准**：SoM 标注的元素可能不准确或遗漏

---

## 优化方案

### 目标
**简化流程**：截图 → 直接给 AI 原图 → AI 返回坐标 → 点击

### 核心思路
利用 AI 的视觉能力（如 kimi-k2.5、GPT-4o 等支持视觉的模型），直接分析截图并返回点击坐标，无需中间的 SoM 标注服务。

---

## 具体实施计划

### 1. 保留的文件/功能
- `screenshot.ts` - 截图功能保留，但**移除 SoM 相关代码**
- `computer.ts` - 鼠标键盘控制功能保留，但**移除 UI Automation 相关代码**

### 2. 删除/简化的内容

#### screenshot.ts 简化：
- [ ] 删除 `ocr-som.ts` 导入和调用
- [ ] 删除 `OCR-SoM` 相关返回字段（`markedImage`, `elements`, `elementsHelp` 等）
- [ ] 只返回截图的 base64 和基本信息

#### computer.ts 简化：
- [ ] 删除 `UI Automation` 相关代码（PowerShell/AppleScript/Python 脚本）
- [ ] 删除 `getUIElements()` 及相关平台实现
- [ ] 保留鼠标键盘控制核心功能

### 3. 新增/修改功能

#### screenshot.ts 修改：
- [ ] 截图后直接返回 base64 图片给 AI
- [ ] 添加图片尺寸信息（用于坐标转换）
- [ ] AI 通过视觉能力直接分析图片内容

#### computer.ts 修改：
- [ ] 支持 AI 直接返回坐标进行点击
- [ ] 添加 `click_by_description` action（AI 根据描述点击）
- [ ] 坐标缩放处理（处理高分屏缩放问题）

### 4. 流程对比

| 步骤 | 旧流程 | 新流程 |
|------|--------|--------|
| 1 | 截图 | 截图 |
| 2 | 调用 SoM 服务标注 | **直接给 AI 原图** |
| 3 | 返回编号元素列表 | AI 视觉分析 |
| 4 | AI 选择元素编号 | **AI 返回坐标** |
| 5 | 根据编号获取坐标 | 直接点击 |
| 6 | 点击 | - |

### 5. 文件变更清单

#### 修改文件：
- `src/tools/screenshot.ts` - 简化，移除 SoM
- `src/tools/computer.ts` - 简化，移除 UI Automation

#### 删除文件：
- `src/services/ocr-som.ts` - 不再需要
- `src/services/debug-visualizer.ts` - 相关的调试可视化

#### 可能删除：
- `Set-of-Mark` 相关代码（如果只在 NutBot 中使用）

---

## 优势

1. **减少依赖**：不再需要 SoM Python 服务
2. **更精准**：AI 直接识别，不受 SoM 标注质量影响
3. **更灵活**：可以识别任意元素，不限于 SoM 能检测到的
4. **易维护**：代码量减少 50% 以上
5. **跨平台**：不再依赖平台特定的 UI Automation API

---

## 实施步骤

1. [ ] 备份现有文件
2. [ ] 简化 `screenshot.ts` - 移除 SoM 调用
3. [ ] 简化 `computer.ts` - 移除 UI Automation
4. [ ] 测试新流程
5. [ ] 删除无用文件

---

## 参考代码

测试用例 `ai-click-test.mjs` 已经验证了方案的可行性：
- 直接调用 AI 视觉 API 分析图片
- AI 返回相对坐标 (0-1)
- 转换为实际像素坐标
- 在图片上标记验证

结果证明 AI 可以准确识别 QQ 搜索框和微信图标的位置。
