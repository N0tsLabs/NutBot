#!/usr/bin/env python3
"""
生成点击位置可视化图片
用法: python draw-click.py <原图路径> <x> <y> <标签文字> [输出路径]
"""

import sys
import cv2
import numpy as np

def draw_click_visualization(image_path, x, y, label, output_path=None):
    # 读取原图
    img = cv2.imread(image_path)
    if img is None:
        print(f"无法读取图片: {image_path}")
        return
    
    h, w = img.shape[:2]
    
    # 创建半透明遮罩
    overlay = img.copy()
    cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 0), -1)
    img = cv2.addWeighted(img, 0.7, overlay, 0.3, 0)
    
    # 在点击位置绘制亮区（圆形）
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.circle(mask, (x, y), 100, 255, -1)
    
    # 原图的亮区
    original = cv2.imread(image_path)
    img[mask > 0] = original[mask > 0]
    
    # 绘制红色十字准星
    color = (0, 0, 255)  # BGR
    thickness = 3
    
    # 横线
    cv2.line(img, (x - 35, y), (x + 35, y), color, thickness)
    # 竖线
    cv2.line(img, (x, y - 35), (x, y + 35), color, thickness)
    
    # 绘制红色圆圈
    cv2.circle(img, (x, y), 30, color, thickness)
    cv2.circle(img, (x, y), 50, (0, 0, 200), 2)
    
    # 绘制标签背景
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.7
    text = f"Click: {label}"
    (text_w, text_h), _ = cv2.getTextSize(text, font, font_scale, 2)
    
    label_x = min(x + 60, w - text_w - 20)
    label_y = max(y - 40, 30)
    
    # 背景矩形
    cv2.rectangle(img, (label_x - 8, label_y - text_h - 8), 
                  (label_x + text_w + 8, label_y + 8), (0, 0, 200), -1)
    # 文字
    cv2.putText(img, text, (label_x, label_y), font, font_scale, (255, 255, 255), 2)
    
    # 绘制坐标
    coord_text = f"({x}, {y})"
    cv2.rectangle(img, (x - 40, y + 55), (x + 40, y + 80), (0, 0, 0), -1)
    cv2.putText(img, coord_text, (x - 35, y + 73), font, 0.5, (255, 255, 255), 1)
    
    # 保存
    if output_path is None:
        output_path = image_path.replace('.png', '-click.png')
    cv2.imwrite(output_path, img)
    print(f"已保存: {output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 5:
        print("用法: python draw-click.py <原图路径> <x> <y> <标签文字> [输出路径]")
        sys.exit(1)
    
    image_path = sys.argv[1]
    x = int(sys.argv[2])
    y = int(sys.argv[3])
    label = sys.argv[4]
    output_path = sys.argv[5] if len(sys.argv) > 5 else None
    
    draw_click_visualization(image_path, x, y, label, output_path)
