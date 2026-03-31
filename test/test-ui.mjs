/**
 * 测试 UI 自动化模块
 * 运行: node test/test-ui.mjs
 */

import { getElements, getTaskbar, getWindows, format, formatTaskbar, findApp } from '../src/utils/ui-automation.js';

console.log('========================================');
console.log('   UI 自动化测试');
console.log('========================================\n');

try {
    // 1. 获取所有元素（深度遍历）
    console.log('📋 获取所有 UI 元素（深度3）...');
    const elements = await getElements();
    console.log(`✓ 获取到 ${elements.length} 个元素\n`);

    // 2. 专门获取任务栏
    console.log('📌 获取任务栏和系统托盘...');
    const taskbar = await getTaskbar();
    console.log(`✓ 获取到 ${taskbar.length} 个任务栏元素\n`);

    console.log('任务栏元素:');
    taskbar.forEach(el => {
        const icon = el.type === 'Taskbar' ? '📊' :
                     el.type === 'NotifyArea' ? '📌' :
                     el.type === 'AppIcon' ? '📱' : '🔹';
        console.log(`  ${icon} ${el.name} @ (${el.x}, ${el.y}) ${el.width}x${el.height}`);
    });

    // 3. 查找特定应用
    console.log('\n🔍 查找 Steam...');
    const steam = await findApp('Steam');
    if (steam.found) {
        console.log(`✓ 找到 Steam @ (${steam.x}, ${steam.y})`);
    } else {
        console.log('✗ 未找到 Steam');
    }

    console.log('\n🔍 查找 Clash...');
    const clash = await findApp('Clash');
    if (clash.found) {
        console.log(`✓ 找到 Clash @ (${clash.x}, ${clash.y})`);
    } else {
        console.log('✗ 未找到 Clash');
    }

    console.log('\n🔍 查找 QQ...');
    const qq = await findApp('QQ');
    if (qq.found) {
        console.log(`✓ 找到 QQ @ (${qq.x}, ${qq.y})`);
        console.log(`  名称: ${qq.name}`);
    } else {
        console.log('✗ 未找到 QQ');
    }

    console.log('\n🔍 查找微信...');
    const wechat = await findApp('微信');
    if (wechat.found) {
        console.log(`✓ 找到微信 @ (${wechat.x}, ${wechat.y})`);
    } else {
        console.log('✗ 未找到微信');
    }

    // 4. 获取所有窗口
    console.log('\n🪟 获取所有窗口...');
    const windows = await getWindows();
    console.log(`✓ 获取到 ${windows.length} 个窗口\n`);

    console.log('前10个窗口:');
    windows.slice(0, 10).forEach((win, i) => {
        const name = (win.name || '').substring(0, 35) || '(无标题)';
        console.log(`  ${i+1}. "${name}" @ (${win.x}, ${win.y}) ${win.width}x${win.height}`);
    });

    // 5. 格式化输出
    console.log('\n========================================');
    console.log('   格式化给 AI');
    console.log('========================================\n');
    console.log(formatTaskbar(taskbar));

} catch (err) {
    console.error('❌ 错误:', err.message);
    console.error(err.stack);
}
