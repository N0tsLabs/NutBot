#!/usr/bin/env node

// 简单测试脚本
console.log('测试程序启动...');

// 模拟输入
const testInputs = ['help', 'config', 'check', 'exit'];

let currentIndex = 0;

const simulateInput = () => {
    if (currentIndex < testInputs.length) {
        const input = testInputs[currentIndex];
        console.log(`模拟输入: ${input}`);
        currentIndex++;
        
        // 模拟处理延迟
        setTimeout(simulateInput, 1000);
    } else {
        console.log('测试完成');
        process.exit(0);
    }
};

// 启动测试
setTimeout(simulateInput, 1000);
