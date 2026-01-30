# OCR-SoM 点击坐标问题调试记录

## 当前状态
- 测试用例 `test/test-ocr-som-ai.js` 运行正常，点击位置准确
- 实际 NutBot 运行时，点击位置仍然可能有偏差

## 已完成的修复

### 1. 移除图片 resize（只做质量压缩）
```
文件: src/tools/screenshot.ts
原因: 图片被 resize 到 1920px 导致坐标不匹配
修复: 只做 JPEG 质量压缩，保持原始尺寸
```

### 2. 修复双重坐标转换
```
问题: screenshot 返回 mouseCenter（已除以 scale），computer 又除一次
修复: 改为返回图片坐标 center，让 computer 统一处理转换
```

### 3. 简化为与测试用例一致的格式
```
元素列表: JSON.stringify 完整数据（id, type, text, center, box）
发送给 AI: 元素列表 JSON + 原图 + 标注图
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/tools/screenshot.ts` | 截图 + 调用 OCR-SoM + 返回元素列表 |
| `src/tools/computer.ts` | 执行点击，`convertCoordinate` 做坐标转换 |
| `src/agent/index.ts` | `processToolResult` 处理截图结果发给 AI |
| `test/test-ocr-som-ai.js` | 参考实现，运行正常 |

## 坐标转换流程

```
截图 (2880x1800) → OCR-SoM 返回 center (图片坐标)
                          ↓
                    AI 使用 center 作为 coordinate
                          ↓
            computer.convertCoordinate(x, y)
                          ↓
                    x / scale, y / scale
                          ↓
                    鼠标实际点击位置
```

## 调试方法

### 1. 查看调试图片
```
位置: C:\Users\16560\.nutbot\screenshots\debug\
每个步骤有:
- 1_original.png (原图)
- 2_marked.png (OCR标注图)  
- 3_click.png (点击位置预览)
- info.txt (详细信息)
```

### 2. 运行测试用例对比
```bash
cd d:\project\NutBot
node test/test-ocr-som-ai.js
```

### 3. 检查 info.txt 中的关键信息
- 截图尺寸 vs 鼠标坐标系
- scale 值
- AI 返回的坐标
- 元素列表中对应元素的 center 坐标

## 可能的问题点

### 1. AI 没有使用元素列表中的 center 坐标
检查: AI 返回的 coordinate 是否等于目标元素的 center

### 2. scale 计算不一致
检查: `computer.ts` 中 `getScale()` 返回的值是否正确

### 3. debugCache 元素格式问题
检查: `agent/index.ts` 中缓存的 elements 结构是否完整

## 下一步调试建议

1. **对比日志**: 运行测试用例和实际任务，对比 AI 收到的消息内容
2. **检查 AI 响应**: 确认 AI 是否返回了正确的 center 坐标
3. **验证转换**: 在 `computer.ts` 的 `convertCoordinate` 加日志，确认转换是否正确

## 测试命令

```bash
# 启动 OCR-SoM 服务
cd d:\project\ocr-som
python server.py

# 启动 NutBot
cd d:\project\NutBot  
yarn dev

# 运行测试用例
node test/test-ocr-som-ai.js
```
