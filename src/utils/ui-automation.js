/**
 * UI 自动化模块 (ES Module)
 */

import { execFile } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';

const TEMP_DIR = resolve(import.meta.dirname, 'temp');
if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
}

async function runPS(script, timeout = 30000) {
    const timestamp = Date.now();
    const scriptPath = join(TEMP_DIR, `test-${timestamp}.ps1`);

    // PowerShell 脚本设置 UTF-8 编码
    const preamble = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
`;
    const fullScript = preamble + script;

    // 写入脚本文件 (带BOM)
    const bomBuffer = Buffer.from([0xEF, 0xBB, 0xBF]);
    const contentBuffer = Buffer.from(fullScript, 'utf8');
    writeFileSync(scriptPath, Buffer.concat([bomBuffer, contentBuffer]));

    try {
        return new Promise((resolve, reject) => {
            const psCmd = process.platform === 'win32' ? 'powershell.exe' : 'powershell';
            const child = execFile(psCmd, [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', scriptPath
            ], {
                timeout,
                maxBuffer: 50 * 1024 * 1024,
                windowsHide: true,
                encoding: 'utf8'
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }

                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (parseErr) {
                    reject(new Error(`JSON解析失败: ${parseErr.message}`));
                }
            });
        });
    } finally {
        setTimeout(() => {
            try { unlinkSync(scriptPath); } catch {}
        }, 1000);
    }
}

// 获取所有元素
export async function getElements() {
    const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient

$desktop = [System.Windows.Automation.AutomationElement]::RootElement

function Get-Elements($Element, $Level=0) {
    $results = @()
    try {
        $name = $Element.Current.Name
        $rect = $Element.Current.BoundingRectangle
        $typeId = $Element.Current.ControlType.Id
        $className = $Element.Current.ClassName

        $types = @{
            50000="Button";50001="Calendar";50002="CheckBox";50003="ComboBox"
            50004="Edit";50005="Hyperlink";50006="Image";50007="ListItem"
            50008="List";50009="Menu";50010="MenuBar";50011="MenuItem"
            50012="ProgressBar";50013="RadioButton";50014="ScrollBar";50015="Slider"
            50016="Spinner";50017="StatusBar";50018="Tab";50019="TabItem"
            50020="Text";50021="ToolBar";50022="ToolTip";50023="Tree"
            50024="TreeItem";50025="Custom";50026="Group";50027="Thumb"
            50028="DataGrid";50029="DataItem";50030="Document";50031="SplitButton"
            50032="Window";50033="Pane";50034="Header";50035="HeaderItem"
            50036="Table";50037="TitleBar";50038="Separator"
        }
        $type = if($types[$typeId]){$types[$typeId]}else{"Type$typeId"}

        $w = $rect.Width
        $h = $rect.Height

        if($w -gt 5 -and $h -gt 5 -and $rect.Left -gt -10000 -and $rect.Top -gt -10000) {
            $results += @{
                name = $name
                type = $type
                className = $className
                level = $Level
                x = [math]::Round($rect.Left + $rect.Width/2)
                y = [math]::Round($rect.Top + $rect.Height/2)
                width = $w
                height = $h
            }

            if($Level -lt 3) {
                $children = $Element.FindAll([System.Windows.Automation.TreeScope]::Children,
                    [System.Windows.Automation.Condition]::TrueCondition)
                for($i=0; $i -lt [Math]::Min($children.Count,50); $i++) {
                    $results += Get-Elements $children[$i] ($Level+1)
                }
            }
        }
    } catch {}
    return $results
}

$tree = Get-Elements $desktop 0
$tree | ConvertTo-Json -Depth 10 -Compress
`;
    return runPS(script, 60000);
}

// 专门获取任务栏
export async function getTaskbar() {
    const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$results = @()

$condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, "Shell_TrayWnd")
$taskbar = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)

if($taskbar) {
    $rect = $taskbar.Current.BoundingRectangle
    $results += @{
        type = "Taskbar"
        name = "Windows任务栏"
        className = "Shell_TrayWnd"
        x = [math]::Round($rect.Left + $rect.Width/2)
        y = [math]::Round($rect.Top + $rect.Height/2)
        width = $rect.Width
        height = $rect.Height
    }

    $allChildren = $taskbar.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)

    for($i=0; $i -lt $allChildren.Count; $i++) {
        try {
            $child = $allChildren[$i]
            $name = $child.Current.Name
            $className = $child.Current.ClassName
            $rect = $child.Current.BoundingRectangle

            if($name -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
                # 返回所有任务栏元素，让AI自己识别
                # 只过滤掉一些系统内部元素
                $isSystemInternal = $className -eq "Start" -or 
                                   $className -eq "ReBarWindow32" -or
                                   ($name -eq "" -and $rect.Width -lt 10)
                
                if(-not $isSystemInternal) {
                    $results += @{
                        name = $name
                        className = $className
                        x = [math]::Round($rect.Left + $rect.Width/2)
                        y = [math]::Round($rect.Top + $rect.Height/2)
                        width = $rect.Width
                        height = $rect.Height
                    }
                }
            }
        } catch {}
    }
}

# 查找系统托盘溢出区域
$overflowCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, "NotifyIconOverflowWindow")
$overflowArea = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $overflowCondition)

if($overflowArea) {
    $overflowChildren = $overflowArea.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)

    for($i=0; $i -lt $overflowChildren.Count; $i++) {
        try {
            $child = $overflowChildren[$i]
            $name = $child.Current.Name
            $className = $child.Current.ClassName
            $rect = $child.Current.BoundingRectangle

            if($name -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
                # 返回所有溢出区域的元素
                $results += @{
                    name = $name
                    className = $className
                    x = [math]::Round($rect.Left + $rect.Width/2)
                    y = [math]::Round($rect.Top + $rect.Height/2)
                    width = $rect.Width
                    height = $rect.Height
                }
            }
        } catch {}
    }
}

$results | ConvertTo-Json -Depth 5 -Compress
`;
    return runPS(script, 30000);
}

// 查找特定应用
export async function findApp(keyword) {
    const taskbar = await getTaskbar();
    const found = taskbar.find(el => el.name && el.name.toLowerCase().includes(keyword.toLowerCase()));
    
    if (found) {
        return {
            found: true,
            name: found.name,
            x: found.x,
            y: found.y,
            width: found.width,
            height: found.height
        };
    }
    
    return { found: false };
}

// 获取所有窗口
export async function getWindows() {
    const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$results = @()
$children = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)

for($i=0; $i -lt $children.Count; $i++) {
    try {
        $win = $children[$i]
        $name = $win.Current.Name
        $className = $win.Current.ClassName
        $rect = $win.Current.BoundingRectangle

        if($rect.Width -gt 10 -and $rect.Height -gt 10) {
            $results += @{
                name = $name
                className = $className
                x = [math]::Round($rect.Left + $rect.Width/2)
                y = [math]::Round($rect.Top + $rect.Height/2)
                width = $rect.Width
                height = $rect.Height
                left = $rect.Left
                top = $rect.Top
            }
        }
    } catch {}
}

$results | Sort-Object y | ConvertTo-Json -Depth 5 -Compress
`;
    return runPS(script, 20000);
}

// 格式化输出
export function format(elements, title = 'UI Elements') {
    const lines = [`# ${title}`, ''];
    elements.forEach((el, i) => {
        const name = (el.name || '').substring(0, 45) || '(无名称)';
        const icon = el.type === 'Taskbar' ? '📊' :
                     el.type === 'AppIcon' ? '📱' :
                     el.type === 'TrayIcon' ? '🔹' :
                     el.type === 'Window' ? '🪟' : '  ';
        lines.push(`${icon} ${i + 1}. [${el.type}] "${name}" @ (${el.x}, ${el.y})`);
    });
    return lines.join('\n');
}

// 格式化任务栏
export function formatTaskbar(elements) {
    const lines = ['# 任务栏元素', ''];

    // 第一个元素是任务栏本身
    if (elements.length > 0 && elements[0].type === 'Taskbar') {
        const taskbar = elements[0];
        lines.push(`📊 ${taskbar.name}: (${taskbar.x}, ${taskbar.y}) ${taskbar.width}x${taskbar.height}`);
        lines.push('');
        
        // 其余元素是任务栏上的子元素
        for (let i = 1; i < elements.length; i++) {
            const el = elements[i];
            if (el.name) {
                const name = el.name.substring(0, 40) || '(无名称)';
                lines.push(`  🔹 ${name} @ (${el.x}, ${el.y})`);
            }
        }
    } else {
        // 兼容旧格式或没有type字段的情况
        elements.forEach((el) => {
            if (el.name) {
                const name = el.name.substring(0, 40) || '(无名称)';
                lines.push(`  🔹 ${name} @ (${el.x}, ${el.y})`);
            }
        });
    }

    return lines.join('\n');
}
