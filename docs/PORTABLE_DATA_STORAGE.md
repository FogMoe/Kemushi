# Kemushi 单文件版本数据存储说明

## 问题描述

单文件便携版 (`Kemushi-1.0.0-portable-x64.exe`) 在运行时会将程序解压到系统临时目录，导致以下问题：

- 应用设置 (`app-settings.json`) 无法正确保存
- 传输记录 (`transfer-records.json`) 无法正确保存
- 传输进度 (`transfer-progress.json`) 无法正确保存

## 解决方案

### 修复内容

1. **数据目录定位**：
   - 开发环境：使用项目根目录 (`process.cwd()`)
   - 打包环境：使用exe文件所在目录 (`path.dirname(process.execPath)`)

2. **文件保存位置**：
   - 所有数据文件现在保存在exe文件的同级目录中
   - 确保便携性和数据持久化

### 数据文件位置

```
Kemushi-1.0.0-portable-x64.exe
├── app-settings.json          # 应用设置（语言偏好等）
├── transfer-records.json      # 传输历史记录
└── transfer-progress.json     # 传输进度缓存
```

### 技术实现

```javascript
// 获取应用数据目录
function getAppDataDir() {
  if (app.isPackaged) {
    // 打包后：使用exe文件所在目录
    return path.dirname(process.execPath);
  } else {
    // 开发环境：使用项目根目录
    return process.cwd();
  }
}
```

## 使用建议

1. **便携性**：将exe文件放在任意目录，数据文件会在同级目录生成
2. **备份**：备份exe文件及同级目录的所有json文件
3. **迁移**：复制整个目录到新位置即可保持所有设置和记录

## 验证方法

启动应用后，控制台会显示数据文件的实际保存路径：

```
应用数据保存目录: C:\Users\YourName\Desktop\
设置文件路径: C:\Users\YourName\Desktop\app-settings.json
传输记录路径: C:\Users\YourName\Desktop\transfer-records.json
```

## 注意事项

- 确保exe文件所在目录有写入权限
- 在只读目录中运行可能导致设置无法保存
- 建议放在用户目录或桌面等有写入权限的位置 