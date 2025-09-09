import { exec } from "child_process";
import { promisify } from "util";
import config from "../config/index.js";
import logger from "../utils/logger.js";

const execAsync = promisify(exec);

/**
 * 跨平台兼容性处理工具
 */
class PlatformUtils {
    constructor() {
        this.platform = config.platform;
        this.isWindows = this.platform === "windows";
        this.isMac = this.platform === "mac";
        this.isLinux = this.platform === "linux";
    }

    /**
     * 检查系统权限
     */
    async checkPermissions() {
        const checks = [];

        if (this.isMac) {
            checks.push(this.checkMacPermissions());
        } else if (this.isWindows) {
            checks.push(this.checkWindowsPermissions());
        } else if (this.isLinux) {
            checks.push(this.checkLinuxPermissions());
        }

        const results = await Promise.allSettled(checks);
        const issues = results
            .filter(result => result.status === "rejected" || !result.value)
            .map(result => result.reason || "权限检查失败");

        if (issues.length > 0) {
            logger.warn("发现权限问题:");
            issues.forEach(issue => logger.warn(`- ${issue}`));
            return false;
        }

        logger.success("系统权限检查通过");
        return true;
    }

    /**
     * 检查macOS权限
     */
    async checkMacPermissions() {
        try {
            // 检查辅助功能权限
            const { stdout } = await execAsync(
                'sqlite3 /Library/Application\\ Support/com.apple.TCC/TCC.db "SELECT service, client FROM access WHERE service=\'kTCCServiceAccessibility\' AND client LIKE \'%node%\'"'
            );

            if (!stdout.trim()) {
                throw new Error("需要辅助功能权限，请在系统偏好设置 > 安全性与隐私 > 隐私 > 辅助功能中添加终端或Node.js");
            }

            return true;
        } catch (error) {
            logger.warn("macOS权限检查失败:", error.message);
            return false;
        }
    }

    /**
     * 检查Windows权限
     */
    async checkWindowsPermissions() {
        try {
            // 检查是否以管理员身份运行
            const { stdout } = await execAsync("net session");
            return stdout.includes("There are no entries");
        } catch (error) {
            logger.warn("Windows权限检查失败:", error.message);
            return false;
        }
    }

    /**
     * 检查Linux权限
     */
    async checkLinuxPermissions() {
        try {
            // 检查X11或Wayland环境
            const display = process.env.DISPLAY;
            const wayland = process.env.WAYLAND_DISPLAY;

            if (!display && !wayland) {
                throw new Error("未检测到图形环境 (X11/Wayland)");
            }

            // 检查xdotool是否可用
            try {
                await execAsync("which xdotool");
            } catch {
                logger.warn("建议安装xdotool以获得更好的自动化支持: sudo apt-get install xdotool");
            }

            return true;
        } catch (error) {
            logger.warn("Linux权限检查失败:", error.message);
            return false;
        }
    }

    /**
     * 获取屏幕信息
     */
    async getScreenInfo() {
        try {
            if (this.isMac) {
                return await this.getMacScreenInfo();
            } else if (this.isWindows) {
                return await this.getWindowsScreenInfo();
            } else if (this.isLinux) {
                return await this.getLinuxScreenInfo();
            }
        } catch (error) {
            logger.warn("获取屏幕信息失败:", error.message);
            return { width: 1920, height: 1080, scale: 1 };
        }
    }

    /**
     * 获取macOS屏幕信息
     */
    async getMacScreenInfo() {
        try {
            const { stdout } = await execAsync(
                'system_profiler SPDisplaysDataType | grep Resolution'
            );
            const match = stdout.match(/(\d+) x (\d+)/);
            if (match) {
                return {
                    width: parseInt(match[1]),
                    height: parseInt(match[2]),
                    scale: 2 // Retina显示器通常是2倍缩放
                };
            }
        } catch (error) {
            logger.debug("获取macOS屏幕信息失败:", error.message);
        }
        return { width: 1440, height: 900, scale: 2 };
    }

    /**
     * 获取Windows屏幕信息
     */
    async getWindowsScreenInfo() {
        try {
            const { stdout } = await execAsync(
                'wmic path Win32_VideoController get CurrentHorizontalResolution,CurrentVerticalResolution /format:value'
            );
            const lines = stdout.split('\n');
            let width = 1920, height = 1080;

            for (const line of lines) {
                if (line.includes('CurrentHorizontalResolution=')) {
                    width = parseInt(line.split('=')[1]) || 1920;
                } else if (line.includes('CurrentVerticalResolution=')) {
                    height = parseInt(line.split('=')[1]) || 1080;
                }
            }

            return { width, height, scale: 1 };
        } catch (error) {
            logger.debug("获取Windows屏幕信息失败:", error.message);
        }
        return { width: 1920, height: 1080, scale: 1 };
    }

    /**
     * 获取Linux屏幕信息
     */
    async getLinuxScreenInfo() {
        try {
            const { stdout } = await execAsync('xrandr --current');
            const match = stdout.match(/(\d+)x(\d+)/);
            if (match) {
                return {
                    width: parseInt(match[1]),
                    height: parseInt(match[2]),
                    scale: 1
                };
            }
        } catch (error) {
            logger.debug("获取Linux屏幕信息失败:", error.message);
        }
        return { width: 1920, height: 1080, scale: 1 };
    }

    /**
     * 检查依赖项
     */
    async checkDependencies() {
        const dependencies = [];
        const issues = [];

        // 检查Node.js版本
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
        if (majorVersion < 18) {
            issues.push(`Node.js版本过低 (${nodeVersion})，需要18.0.0或更高版本`);
        } else {
            dependencies.push(`Node.js: ${nodeVersion}`);
        }

        // 检查平台特定依赖
        if (this.isMac) {
            const macDeps = await this.checkMacDependencies();
            dependencies.push(...macDeps.dependencies);
            issues.push(...macDeps.issues);
        } else if (this.isWindows) {
            const winDeps = await this.checkWindowsDependencies();
            dependencies.push(...winDeps.dependencies);
            issues.push(...winDeps.issues);
        } else if (this.isLinux) {
            const linuxDeps = await this.checkLinuxDependencies();
            dependencies.push(...linuxDeps.dependencies);
            issues.push(...linuxDeps.issues);
        }

        logger.info("系统依赖检查:");
        dependencies.forEach(dep => logger.info(`✓ ${dep}`));
        
        if (issues.length > 0) {
            logger.warn("发现依赖问题:");
            issues.forEach(issue => logger.warn(`⚠ ${issue}`));
        }

        return {
            dependencies,
            issues,
            allGood: issues.length === 0
        };
    }

    /**
     * 检查macOS依赖
     */
    async checkMacDependencies() {
        const dependencies = [];
        const issues = [];

        try {
            await execAsync("which screencapture");
            dependencies.push("screencapture: 可用");
        } catch {
            issues.push("screencapture: 不可用");
        }

        return { dependencies, issues };
    }

    /**
     * 检查Windows依赖
     */
    async checkWindowsDependencies() {
        const dependencies = [];
        const issues = [];

        try {
            await execAsync("where screencapture");
            dependencies.push("screencapture: 可用");
        } catch {
            // Windows通常不需要额外的截图工具
            dependencies.push("screencapture: 使用内置工具");
        }

        return { dependencies, issues };
    }

    /**
     * 检查Linux依赖
     */
    async checkLinuxDependencies() {
        const dependencies = [];
        const issues = [];

        try {
            await execAsync("which import");
            dependencies.push("ImageMagick: 可用");
        } catch {
            issues.push("ImageMagick: 建议安装 (sudo apt-get install imagemagick)");
        }

        try {
            await execAsync("which xdotool");
            dependencies.push("xdotool: 可用");
        } catch {
            issues.push("xdotool: 建议安装 (sudo apt-get install xdotool)");
        }

        return { dependencies, issues };
    }

    /**
     * 获取平台特定的配置建议
     */
    getPlatformRecommendations() {
        const recommendations = [];

        if (this.isMac) {
            recommendations.push(
                "确保在系统偏好设置中授予辅助功能权限",
                "建议使用Retina显示器以获得更好的截图质量",
                "如果遇到权限问题，请重启终端应用"
            );
        } else if (this.isWindows) {
            recommendations.push(
                "建议以管理员身份运行以获得更好的权限",
                "确保Windows Defender不会阻止自动化操作",
                "如果使用多显示器，请确保主显示器设置正确"
            );
        } else if (this.isLinux) {
            recommendations.push(
                "确保在X11或Wayland环境中运行",
                "安装xdotool和ImageMagick以获得更好的支持",
                "如果使用Wayland，某些功能可能受限"
            );
        }

        return recommendations;
    }
}

export default new PlatformUtils();
