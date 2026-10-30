# DecoTV 在 OpenWrt 上的部署指南

> 适用场景：你有一台性能较好的 OpenWrt 设备（x86_64 软路由、ARM64 盒子、树莓派等），希望在局域网中运行 DecoTV。推荐使用 **Docker 容器方式**，避免在路由系统内直接安装 Node.js 带来的复杂性与依赖污染。

---

## 目录

- [部署方式概览](#部署方式概览)
- [系统与硬件要求](#系统与硬件要求)
- [方法一：Docker 部署（推荐）](#方法一docker-部署推荐)
  - [步骤 1：获取或构建镜像](#步骤-1获取或构建镜像)
  - [步骤 2：导出并传输镜像（仅本地构建时）](#步骤-2导出并传输镜像仅本地构建时)
  - [步骤 3：在 OpenWrt 导入镜像（仅本地构建时）](#步骤-3在-openwrt-导入镜像仅本地构建时)
  - [步骤 4：启动容器](#步骤-4启动容器)
  - [步骤 5：访问与验证](#步骤-5访问与验证)
  - [可选：使用 docker-compose](#可选使用-docker-compose)
- [环境变量与运行参数](#环境变量与运行参数)
- [数据与持久化](#数据与持久化)
- [性能优化建议](#性能优化建议)
- [常见问题排查](#常见问题排查)
- [方法二：裸机部署（不推荐）](#方法二裸机部署不推荐)
- [附录：快速命令汇总](#附录快速命令汇总)
- [后续](#后续)

## 部署方式概览

| 方式                 | 隔离性 | 维护难度 | 性能 | 适合架构       | 说明                      |
| -------------------- | ------ | -------- | ---- | -------------- | ------------------------- |
| Docker 手动构建/加载 | 高     | 低       | 好   | x86_64 / ARM64 | 推荐，最常用              |
| Docker Compose       | 高     | 低       | 好   | x86_64 / ARM64 | 如果固件支持 compose 插件 |
| 裸机 Node.js         | 低     | 高       | 一般 | 仅高性能设备   | 不推荐，依赖管理复杂      |

## 系统与硬件要求

| 项目         | 推荐值             | 说明               |
| ------------ | ------------------ | ------------------ |
| 内存         | ≥ 512 MB           | Next.js 运行与缓存 |
| 存储         | ≥ 1 GB 可用        | 镜像 + 依赖 + 数据 |
| 架构         | x86_64 / aarch64   | 构建镜像时需匹配   |
| OpenWrt 版本 | 21+                | 需 docker 套件支持 |
| 内核特性     | cgroups、overlayfs | 容器运行基础       |

安装 Docker（示例）：

```bash
opkg update
opkg install docker dockerd luci-app-docker
/etc/init.d/dockerd enable
/etc/init.d/dockerd start
```

> 若官方源无 docker，请使用支持 docker 的定制固件 (ImmortalWrt / Flippy 等)。

## 方法一：Docker 部署（推荐）

### 步骤 1：获取或构建镜像

优先使用预构建镜像（减少在路由器上构建的复杂度）：

```bash
docker pull yangchongshun/deco-tv:latest
```

如果需要自行构建（在较好的开发机执行）：

```bash
git clone <你的仓库地址> DecoTV
cd DecoTV

# x86_64 架构
docker build -t decotv:latest .

# ARM64 架构
docker buildx build --platform linux/arm64 -t decotv:latest . --load
```

### 步骤 2：导出并传输镜像（仅本地构建时）

```bash
docker save -o decotv.tar decotv:latest
scp decotv.tar root@<OPENWRT_IP>:/tmp/
```

### 步骤 3：在 OpenWrt 导入镜像（仅本地构建时）

```bash
ssh root@<OPENWRT_IP>
docker load -i /tmp/decotv.tar
docker images | grep decotv
```

### 步骤 4：启动容器

基础运行：

```bash
docker run -d \
  --name decotv \
  --restart unless-stopped \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  yangchongshun/deco-tv:latest
```

增强（持久化 + host 网络）：

```bash
mkdir -p /mnt/sda1/decotv/data
docker run -d \
  --name decotv \
  --restart unless-stopped \
  --net=host \
  -e TZ=Asia/Shanghai \
  -v /mnt/sda1/decotv/data:/app/data \
  yangchongshun/deco-tv:latest
```

> `--net=host` 可避免部分外部源的端口/DNS 问题，不适合公网暴露。

### 步骤 5：访问与验证

浏览器访问：

```text
http://<OPENWRT_IP>:3000
```

日志与健康检查：

```bash
docker logs -f decotv
curl -I http://<OPENWRT_IP>:3000
```

### 可选：使用 docker-compose

`docker-compose.yml`：

```yaml
version: '3.8'
services:
  decotv:
    image: yangchongshun/deco-tv:latest
    container_name: decotv
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      TZ: Asia/Shanghai
    volumes:
      - /mnt/sda1/decotv/data:/app/data
```

启动：

```bash
docker compose up -d
```

## 环境变量与运行参数

| 变量         | 默认    | 说明                 |
| ------------ | ------- | -------------------- |
| `PORT`       | 3000    | 服务端口             |
| `HOSTNAME`   | 0.0.0.0 | 监听地址             |
| `TZ`         | -       | 时区设置             |
| `DOCKER_ENV` | true    | 标识运行在 Docker 内 |

示例：`-e PORT=4000 -e TZ=Asia/Shanghai`

## 数据与持久化

| 路径        | 挂载 | 说明            |
| ----------- | ---- | --------------- |
| `/app/data` | 建议 | 缓存 / 用户配置 |
| 日志文件    | 可选 | 调试、审计      |

挂载：

```bash
docker run -v /mnt/sda1/decotv/data:/app/data ... decotv:latest
```

备份：

```bash
tar czf decotv-data-backup.tgz -C /mnt/sda1/decotv/data .
```

## 性能优化建议

1. 使用 `node:20-alpine` 已较轻量。
2. 限制资源示例：`docker run -d --name decotv --memory=512m --cpus=1 ... yangchongshun/deco-tv:latest`
3. 开启 Swap 缓解 OOM。
4. 定期更新镜像保持安全。
5. 网络慢时调整 DNS 或使用加速。

## 常见问题排查

| 问题              | 现象         | 解决方案                               |
| ----------------- | ------------ | -------------------------------------- |
| exec format error | 容器立即退出 | 架构不匹配，重新使用 `--platform` 构建 |
| Killed / OOM      | 容器消失     | 增内存 / 开 Swap / 降并发              |
| 外网源不可访问    | 搜索为空     | 加 `--net=host` 或修复 DNS/防火墙      |
| 页面加载慢        | 首次延迟高   | 设备性能不足，迁移到更强主机           |
| 端口冲突          | 启动失败     | 改端口 `-p 4000:3000`                  |
| 时区错误          | 日志时间偏差 | 设置 `-e TZ=Asia/Shanghai`             |
| 视频源验证失败    | ECONNREFUSED | 见下方"特殊网络环境问题"章节           |

### 特殊网络环境问题 (Fake IP / Clash)

如果在 OpenWrt 上部署了 OpenClash / Clash 等代理软件并开启了 **Fake IP 模式**，可能会遇到容器内无法连接外网的问题。

**现象：**

- 视频源验证失败，日志报错 `Error: connect ECONNREFUSED 198.18.x.x:443`。
- `198.18.x.x` 是 Fake IP 的保留网段，说明容器解析到了 Fake IP 但无法路由出去。

**解决方案：**

**方案 A：使用 Host 网络模式（推荐）**
让容器共享宿主机的网络栈，直接利用宿主机的代理规则。

Docker Run:

```bash
docker run -d --name decotv --net=host ...
```

Docker Compose:

```yaml
services:
  decotv-core:
    network_mode: 'host'
    # 注意：host 模式下 ports 映射无效，服务将直接监听宿主机的 3000 端口
    # ports:
    #   - '3000:3000'
```

**方案 B：指定 DNS**
强制容器使用公共 DNS，绕过 OpenWrt 的 Fake IP DNS 劫持（前提是 53 端口未被强制劫持）。

Docker Compose:

```yaml
services:
  decotv-core:
    dns:
      - 223.5.5.5
      - 8.8.8.8
```

诊断：

```bash
docker stats decotv
docker exec -it decotv sh
```

## 方法二：裸机部署（不推荐）

仅在你明确掌握依赖与维护成本时使用：

```bash
opkg update
opkg install node npm git ca-certificates
git clone <repo> /root/decotv
cd /root/decotv
corepack enable
corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

缺点：

1. 依赖缺失概率高。
2. 升级复杂易冲突。
3. 无隔离，调试困难。

## 附录：快速命令汇总

```bash
docker build -t decotv:latest .
docker buildx build --platform linux/arm64 -t decotv:latest . --load
docker save -o decotv.tar decotv:latest
scp decotv.tar root@<OPENWRT_IP>:/tmp/
docker load -i /tmp/decotv.tar
docker run -d --name decotv -p 3000:3000 --restart unless-stopped -e TZ=Asia/Shanghai decotv:latest
docker run -d --name decotv --net=host --restart unless-stopped -e TZ=Asia/Shanghai -v /mnt/sda1/decotv/data:/app/data decotv:latest
docker logs -f decotv
docker exec -it decotv sh
docker stop decotv && docker rm decotv
```

## 后续

如需：

1. 反向代理示例 (Nginx/Caddy)
2. HTTPS 支持
3. 外部缓存/Redis 集成

可在 issues 中提出需求。祝使用愉快 🎉
