<!-- markdownlint-disable MD033 MD026 MD034 -->

> 本项目由 [Decohererk/DecoTV](https://github.com/Decohererk/DecoTV) fork 而来，在其基础上继续开发，许可证沿用原项目，详见 [LICENSE](LICENSE)。原生安卓客户端见 [Fugitive844/DecoTV-Android](https://github.com/Fugitive844/DecoTV-Android)。

<h1 align="center">
  <img src="public/logo.png" alt="DecoTV Logo" width="160" style="margin-bottom: 12px;" />
  <br />
  DecoTV
</h1>

> 🎬 **DecoTV** 是一个开箱即用的、跨平台的影视聚合播放器。它基于 **Next.js 16** + **Tailwind&nbsp;CSS 4** + **TypeScript 5** 构建，支持多资源搜索、在线播放、收藏同步、播放记录、云端存储，让你可以随时随地畅享海量免费影视内容。**支持本地无数据库模式、CMS 全量代理、隐私纵深防御等企业级特性。**

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

---

## 📱 推荐使用安卓客户端

手机上看视频，推荐使用原生安卓客户端 [DecoTV Android](https://github.com/Fugitive844/DecoTV-Android)。它连接你部署的 DecoTV 服务端，播放时由手机直连视频源，不必绕行服务器，通常起播和拖动更快，也不占用服务器带宽。

**为什么网页端做不到？** 浏览器有安全限制，这些问题网页代码无法绕过：

- **跨域（CORS）**：视频源没有返回允许跨域的响应头时，页面读不到 m3u8 和分片。
- **混合内容**：HTTPS 页面不能加载 HTTP 资源，而很多视频源和直播源只提供 HTTP。

所以网页端的很多视频只能经服务器中转，线路变长，服务器带宽也可能成为瓶颈。原生播放器没有这些限制：

| 项目         | 安卓客户端（默认）   | 网页端受限时 |
| ------------ | -------------------- | ------------ |
| 点播视频     | 手机直连视频源       | 经服务器中转 |
| 直播频道列表 | 手机下载并在本地解析 | 经服务器获取 |
| 直播流       | 手机直连             | 经服务器中转 |
| 封面和台标   | 手机直连             | 经服务器中转 |

搜索仍由服务端聚合。上表每一项都可以在客户端设置中单独切换为不中转、全中转或智能模式；智能模式下直连失败会自动改走中转。实际速度取决于手机到视频源的网络，个别线路可能中转更快。

客户端还支持离线缓存、边存边播、弹幕和手势操作。

---

## 🎬 项目展示

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="public/screenshot1.png" alt="明亮模式" width="400">
        <br>
        <sub><b>明亮模式</b></sub>
      </td>
      <td align="center">
        <img src="public/screenshot2.png" alt="暗夜模式" width="400">
        <br>
        <sub><b>暗夜模式</b></sub>
      </td>
    </tr>
  </table>
</div>

---

### ⚠️ 重要提醒

> **注意**：部署后项目为空壳项目，无内置播放源和直播源，需要自行收集配置。  
> **免责声明**：请不要在 B 站、小红书、微信公众号、抖音、今日头条或其他中国大陆社交平台发布视频或文章宣传本项目，不授权任何"科技周刊/月刊"类项目或站点收录本项目。

## ✨ 功能特性

- 🔍 **多源聚合搜索**：一次搜索立刻返回全源结果。
- 📄 **丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示。
- ▶️ **流畅在线播放**：集成 HLS.js & ArtPlayer。
- 🔊 **多音轨切换**：当视频存在 2 条及以上音轨时，播放器控制栏会显示“音轨”按钮，可在中文配音 / English 等音轨间切换；单音轨会自动隐藏按钮，界面保持简洁。
- 🖥️ **网页投屏（Google Cast）**：支持在网页端直接发起投屏，并提供 iOS 设备兼容提示。
- ❤️ **收藏 + 继续观看**：支持 Kvrocks/Redis/Upstash 存储，多端同步进度。
- 👤 **用户注册系统**：支持用户自助注册（可选），带图形验证码防机器人。
- 📱 **PWA**：离线缓存、安装到桌面/主屏，移动端原生体验。
- 🌗 **响应式布局**：桌面侧边栏 + 移动底部导航，自适应各种屏幕尺寸。
- 📺 **弹幕功能**：集成弹弹play开放平台，Vercel 部署默认可通过公共中继加载官方弹幕，并支持 TMDB 精确匹配、手动匹配与第三方自定义节点。
- ☁️ **PanSou 网盘搜索**：支持对接远程 PanSou 节点，提供聚合网盘搜索能力，并可在后台灵活配置节点与鉴权。
- ⬇️ **视频资源下载能力**：支持浏览器分片下载与服务端 FFmpeg 转存下载，增强任务管理、重试与超时处理。
- 📡 **灵活直播体验**：支持多直播源配置、分页切换优化与 m3u8/flv/mp4 自动识别处理。
- 🧠 **豆瓣信息增强**：支持标题反查豆瓣 ID、并行抓取与图片代理，详情页信息更完整。
- 🎞️ **TMDB 元数据增强**：支持与豆瓣互补的 TMDB 元数据查询，中文优先、英文回退，可为详情页和私人影库补充更稳定的海报、背景图与简介。
- 🗂️ **私人影库**：支持接入 OpenList / 小雅 Alist / Emby / Jellyfin，在“我的影库”中浏览和播放自有媒体资源，并通过服务端代理保护流地址与鉴权信息。
- 👿 **智能去广告**：自动跳过视频中的切片广告（实验性）。
- 🏠 **本地无数据库模式**：无需 Redis，适合快速体验；后台配置存在服务端内存，播放记录和收藏存在浏览器。
- 🌐 **直连优先、代理兜底**：网页端优先直连播放和加载图片，遇到 CORS、Mixed Content 等限制时改走服务端代理。
- 🛡️ **成人内容隔离**：默认过滤；只有后台关闭过滤且请求带有效访问秘钥时才放开。
- 🔑 **访问秘钥**：站长批量生成和停用，通过 URL 参数 `ak` 控制成人内容的访问。
- 🤖 **大模型翻译**：接入 OpenAI 兼容接口翻译直播频道名称和分组，支持额度、批量修改和实时进度。
- 🧾 **审计日志**：后台可查看所有用户的搜索和播放记录。
- 🧭 **源浏览器与直播搜索**：可按视频源浏览内容，并搜索直播源和频道。
- 📲 **安卓客户端入口**：后台填写 APK 下载页后，登录页、注册页和站内右上角会显示下载按钮和二维码。

### 注意：部署后项目为空壳项目，无内置播放源和直播源，需要自行收集

<details>
  <summary>点击查看项目截图</summary>
  <img src="public/screenshot1.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot2.png" alt="项目截图" style="max-width:600px">
</details>

### 请不要在 B 站、小红书、微信公众号、抖音、今日头条或其他中国大陆社交平台发布视频或文章宣传本项目，不授权任何“科技周刊/月刊”类项目或站点收录本项目。

## 🗺 目录

- [📱 推荐使用安卓客户端](#-推荐使用安卓客户端)
- [🎬 项目展示](#-项目展示)
- [✨ 功能特性](#-功能特性)
- [🛠 技术栈](#-技术栈)
- [🚀 部署](#-部署)
- [⚙️ 配置文件](#️-配置文件)
- [🔄 自动更新](#-自动更新)
- [🌍 环境变量](#-环境变量)
- [⬇️ 下载功能使用指南](#️-下载功能使用指南)
- [Roadmap](#roadmap)
- [📺 AndroidTV 使用](#-androidtv-使用)
- [🔒 安全与隐私提醒](#-安全与隐私提醒)
- [📄 License](#-license)
- [🙏 致谢](#-致谢)
- [📈 Star History](#-star-history)
- [💝 赞赏支持](#-赞赏支持)

## 🛠 技术栈

| 分类      | 主要依赖                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 前端框架  | [Next.js 16](https://nextjs.org/) · App Router · Turbopack                                            |
| UI & 样式 | [Tailwind&nbsp;CSS 4](https://tailwindcss.com/)                                                       |
| 语言      | TypeScript 5                                                                                          |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint 9 · Prettier 3 · Jest 29                                                                       |
| 部署      | Docker                                                                                                |

## 🚀 部署

本文档以 **Docker 部署**为准。大模型翻译、直播频道抓取等后台任务依赖常驻进程，不适合 Serverless 平台。

### 🧩 OpenWrt 部署

如果你计划运行在 OpenWrt（软路由 / ARM 盒子 / 树莓派等）设备上，参阅完整指南：

👉 [OpenWrt 部署指南](./docs/OpenWrt部署指南.md)

快速拉取预构建镜像：

```bash
docker pull yangchongshun/deco-tv:latest
```

预构建镜像目前只提供 `linux/amd64`，ARM 设备需要自行构建。若需在外部主机自行构建后再导入至 OpenWrt，请参考指南中的 “获取或构建镜像” 与 “导出并传输” 步骤。

### 📦 Docker 镜像

本项目的镜像发布在 Docker Hub：[`yangchongshun/deco-tv`](https://hub.docker.com/r/yangchongshun/deco-tv)，部署时使用 `latest` 标签：

```bash
docker pull yangchongshun/deco-tv:latest
```

> **注意**：重启容器不会自动拉取新镜像，升级时需要先执行 `docker pull`，再重新创建容器。预构建镜像目前只提供 `linux/amd64` 架构，其他架构（如 ARM）请自行构建。

### 访问协议与反向代理

DecoTV 支持直接通过 Docker 端口映射在局域网 HTTP 地址访问，例如 `http://192.168.1.10:3000`。这种场景下登录 Cookie 不会设置 `Secure` 属性，浏览器可以正常保存认证状态。

公网部署强烈建议使用 HTTPS。若前面有 Nginx/OpenResty 等反向代理，请确保把外部访问协议传给 DecoTV：

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Host $http_host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

DecoTV 会根据请求 URL、`X-Forwarded-Proto`、`X-Forwarded-Host` 或标准 `Forwarded` 头判断实际协议和外部访问域名。使用 `https://域名:非443端口` 反代时，务必传递带端口的 `$http_host`，否则浏览器后续请求 m3u8 代理地址时会丢端口。HTTPS 访问会设置 `Secure` Cookie；HTTP 局域网直连和 HTTP 反代不会设置 `Secure` Cookie。不要仅依赖容器内的 `NODE_ENV=production` 判断访问协议。

### Kvrocks 存储（推荐）

```yml
services:
  decotv-core:
    image: yangchongshun/deco-tv:latest
    container_name: decotv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=kvrocks
      - KVROCKS_URL=redis://decotv-kvrocks:6666
    networks:
      - decotv-network
    depends_on:
      - decotv-kvrocks
  decotv-kvrocks:
    image: apache/kvrocks
    container_name: decotv-kvrocks
    restart: unless-stopped
    volumes:
      - kvrocks-data:/var/lib/kvrocks
    networks:
      - decotv-network
networks:
  decotv-network:
    driver: bridge
volumes:
  kvrocks-data:
```

### Redis 存储（有一定的丢数据风险）

```yml
services:
  decotv-core:
    image: yangchongshun/deco-tv:latest
    container_name: decotv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://decotv-redis:6379
    networks:
      - decotv-network
    depends_on:
      - decotv-redis
  decotv-redis:
    image: redis:alpine
    container_name: decotv-redis
    restart: unless-stopped
    networks:
      - decotv-network
    # 请开启持久化，否则升级/重启后数据丢失
    volumes:
      - ./data:/data
networks:
  decotv-network:
    driver: bridge
```

### Upstash 存储

1. 在 [upstash](https://upstash.com/) 注册账号并新建一个 Redis 实例，名称任意。
2. 复制新数据库的 **HTTPS ENDPOINT 和 TOKEN**
3. 使用如下 docker compose

```yml
services:
  decotv-core:
    image: yangchongshun/deco-tv:latest
    container_name: decotv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=upstash
      - UPSTASH_URL=上面 https 开头的 HTTPS ENDPOINT
      - UPSTASH_TOKEN=上面的 TOKEN
```

### 🏠 本地无数据库模式（最简部署）

如果你只是想**快速体验**或**单机使用**，不需要多端同步功能，可以使用本地存储模式。此模式无需任何外部数据库：后台配置保存在服务端进程内存中，播放记录和收藏保存在浏览器 localStorage 中。

#### Docker Run（最简单）

```bash
docker run -d \
  --name decotv \
  -p 3000:3000 \
  -v decotv-downloads:/app/.cache/ffmpeg-downloads \
  -e PASSWORD=你的管理密码 \
  yangchongshun/deco-tv:latest
```

#### Docker Compose

```yml
services:
  decotv:
    image: yangchongshun/deco-tv:latest
    container_name: decotv
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - PASSWORD=你的管理密码
    volumes:
      - decotv-downloads:/app/.cache/ffmpeg-downloads
volumes:
  decotv-downloads:
```

#### 重要说明

| 项目        | 说明                                                                  |
| ----------- | --------------------------------------------------------------------- |
| ✅ 必需配置 | `PASSWORD` - 管理员登录密码                                           |
| ❌ 不需要   | `USERNAME`、`NEXT_PUBLIC_STORAGE_TYPE`、任何数据库连接变量            |
| ❌ 不需要   | `AUTH_SECRET`、`AUTH_URL`（这些是其他认证框架的配置，DecoTV 不使用）  |
| ⚠️ 后台配置 | 保存在服务端内存，容器重启或重建后丢失，请自行备份配置文件            |
| ⚠️ 用户数据 | 播放记录和收藏保存在浏览器 localStorage，清除浏览器数据会丢失         |
| ⚠️ 安全     | 为便于初次配置，此模式放宽了后台接口的登录校验，不要暴露到公网        |
| ⚠️ 多端同步 | 不支持，每个浏览器独立存储                                            |
| ⬇️ 下载缓存 | 建议挂载 `/app/.cache/ffmpeg-downloads`，避免容器重建时丢失已转存文件 |

### 🏡 免登录家庭模式

默认仍为 `NEXT_PUBLIC_AUTH_MODE=password`，需要登录后使用。家庭局域网、NAS、电视盒子、OpenWrt、飞牛 OS 等完全可信内网场景，可以显式开启免登录：

```bash
docker run -d \
  --name decotv \
  -p 3000:3000 \
  -e NEXT_PUBLIC_AUTH_MODE=public \
  -v decotv-downloads:/app/.cache/ffmpeg-downloads \
  yangchongshun/deco-tv:latest
```

Docker Compose 示例：

```yml
services:
  decotv:
    image: yangchongshun/deco-tv:latest
    container_name: decotv
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - NEXT_PUBLIC_AUTH_MODE=public
    volumes:
      - decotv-downloads:/app/.cache/ffmpeg-downloads
volumes:
  decotv-downloads:
```

> ⚠️ `NEXT_PUBLIC_AUTH_MODE=public` 仅建议局域网、NAS、家庭内网、VPN、自用环境开启，不建议公网暴露。`/admin` 和 `/api/admin/*` 默认仍需要登录保护；只有同时设置 `PUBLIC_ALLOW_ADMIN=true` 才会免登录开放后台和后台 API，该开关风险极高，仅适合完全可信内网。

#### 常见问题

**Q: 登录成功后操作仍提示 401 Unauthorized？**

这可能是以下原因：

1. **浏览器 Cookie 问题**：尝试清除浏览器 Cookie 后重新登录
2. **残留数据库配置**：确保没有设置 `REDIS_URL`、`KV_REST_API_URL` 等数据库变量
3. **反向代理协议头缺失**：如果你通过 Nginx/OpenResty 等反向代理使用 HTTPS，确保正确配置 `X-Forwarded-Proto $scheme`，否则应用可能无法按外部访问协议设置 Cookie
4. **镜像未更新**：`latest` 镜像重启不会自动拉取新版本，升级前需要先执行 `docker pull yangchongshun/deco-tv:latest`

**Q: 如何从本地模式迁移到数据库模式？**

本地模式的数据分散在服务端内存和浏览器中，无法直接迁移。建议：

1. 手动导出配置（复制配置文件内容）
2. 部署新的数据库模式实例
3. 在新实例中导入配置

## ⚙️ 配置文件

完成部署后为空壳应用，无播放源，需要站长在管理后台的 `配置文件` 中填写配置，或填写订阅地址拉取配置（要求 JSON 格式且使用 Base58 编码）；也可以在 `视频源管理`、`直播源管理` 中逐个维护

配置文件示例如下：

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://xxx.com/api.php/provide/vod",
      "name": "示例资源",
      "detail": "http://xxx.com"
    }
    // ...更多站点
  },
  "custom_category": [
    {
      "name": "华语",
      "type": "movie",
      "query": "华语"
    }
  ]
}
```

- `cache_time`：接口缓存时间（秒）。
- `api_site`：你可以增删或替换任何资源站，字段说明：
  - `key`：唯一标识，保持小写字母/数字。
  - `api`：资源站提供的 `vod` JSON API 根地址。
  - `name`：在人机界面中展示的名称。
  - `detail`：（可选）部分无法通过 API 获取剧集详情的站点，需要提供网页详情根 URL，用于爬取。
- `custom_category`：自定义分类配置，用于在导航中添加个性化的影视分类。以 type + query 作为唯一标识。支持以下字段：
  - `name`：分类显示名称（可选，如不提供则使用 query 作为显示名）
  - `type`：分类类型，支持 `movie`（电影）或 `tv`（电视剧）
  - `query`：搜索关键词，用于在豆瓣 API 中搜索相关内容

custom_category 支持的自定义分类已知如下：

- movie：热门、最新、经典、豆瓣高分、冷门佳片、华语、欧美、韩国、日本、动作、喜剧、爱情、科幻、悬疑、恐怖、治愈
- tv：热门、美剧、英剧、韩剧、日剧、国产剧、港剧、日本动画、综艺、纪录片

也可输入如 "哈利波特" 效果等同于豆瓣搜索

DecoTV 支持标准的苹果 CMS V10 API 格式。

## 🔄 自动更新

可借助 [watchtower](https://github.com/containrrr/watchtower) 自动更新镜像容器

dockge/komodo 等 docker compose UI 也有自动更新功能

## 🌍 环境变量

### 基础配置

| 变量                  | 说明                      | 可选值                   | 默认值                                                                                                                     |
| --------------------- | ------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| USERNAME              | 管理员账号                | 任意字符串               | 无默认，数据库模式**必填**，本地模式可省略                                                                                 |
| PASSWORD              | 管理员密码                | 任意字符串               | 无默认，password 模式**必填**                                                                                              |
| NEXT_PUBLIC_AUTH_MODE | 访问模式                  | password、public         | password                                                                                                                   |
| PUBLIC_ALLOW_ADMIN    | public 模式下是否开放后台 | true/false               | false                                                                                                                      |
| SITE_BASE             | 站点 URL                  | 形如 https://example.com | 空                                                                                                                         |
| NEXT_PUBLIC_SITE_NAME | 站点名称                  | 任意字符串               | DecoTV                                                                                                                     |
| ANNOUNCEMENT          | 站点公告                  | 任意字符串               | 本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。 |

### 存储配置

| 变量                     | 说明                    | 可选值                                | 默认值       | 备注                               |
| ------------------------ | ----------------------- | ------------------------------------- | ------------ | ---------------------------------- |
| NEXT_PUBLIC_STORAGE_TYPE | 存储类型                | localstorage、redis、kvrocks、upstash | localstorage | 不填则默认本地模式，数据存浏览器中 |
| KVROCKS_URL              | Kvrocks 数据库连接地址  | redis://host:port                     | 空           | 当 STORAGE_TYPE=kvrocks 时必填     |
| REDIS_URL                | Redis 数据库连接地址    | redis://host:port                     | 空           | 当 STORAGE_TYPE=redis 时必填       |
| UPSTASH_URL              | Upstash Redis REST URL  | https://xxx.upstash.io                | 空           | 当 STORAGE_TYPE=upstash 时必填     |
| UPSTASH_TOKEN            | Upstash Redis REST 令牌 | AUxxxx...                             | 空           | 当 STORAGE_TYPE=upstash 时必填     |

> **注意**：Upstash 使用 REST API 连接，需要填写 `UPSTASH_URL`（HTTPS ENDPOINT）和 `UPSTASH_TOKEN`，不是传统的 Redis 连接字符串。

### 用户注册配置

注册需要先配置 `redis`、`upstash` 或 `kvrocks` 存储。部署后由站长在 `/admin` -> `用户配置` -> `公开注册` 中直接控制开关和新用户默认用户组，无需为日常启停重新部署。

| 变量                            | 说明                         | 可选值     | 默认值 | 备注                             |
| ------------------------------- | ---------------------------- | ---------- | ------ | -------------------------------- |
| NEXT_PUBLIC_ENABLE_REGISTRATION | 旧配置迁移时的初始注册状态   | true/false | false  | 后续以管理面板保存的设置为准     |
| DEFAULT_REGISTRATION_GROUP      | 旧配置迁移时的初始默认用户组 | 用户组名称 | 空     | 后续在管理面板选择已创建的用户组 |

> **安全提示**：公开注册默认关闭；不设置默认用户组时，新账号默认可使用全部可用视频源。详见 [用户注册功能说明](./docs/用户注册功能说明.md)

### 高级配置

| 变量                                | 说明                             | 可选值               | 默认值           | 备注                     |
| ----------------------------------- | -------------------------------- | -------------------- | ---------------- | ------------------------ |
| NEXT_PUBLIC_SEARCH_MAX_PAGE         | 搜索接口可拉取的最大页数         | 1-50                 | 5                | 数值越大越慢             |
| NEXT_PUBLIC_DOUBAN_PROXY_TYPE       | 豆瓣数据源请求方式               | 见下方说明           | auto             | -                        |
| NEXT_PUBLIC_DOUBAN_PROXY            | 自定义豆瓣数据代理 URL           | URL prefix           | 空               | custom 模式使用          |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE | 豆瓣图片代理类型                 | 见下方说明           | auto             | -                        |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY      | 自定义豆瓣图片代理 URL           | URL prefix           | 空               | custom 模式使用          |
| NEXT_PUBLIC_DISABLE_YELLOW_FILTER   | 关闭色情内容过滤                 | true/false           | false            | 不建议开启               |
| NEXT_PUBLIC_FLUID_SEARCH            | 是否开启搜索接口流式输出         | true/false           | true             | -                        |
| NEXT_PUBLIC_SEARCH_RESULT_LOAD_MODE | 搜索结果加载方式                 | infinite、pagination | infinite         | -                        |
| ENABLE_AD_FILTER                    | m3u8 广告分段过滤                | true/false           | true             | 也可在后台配置           |
| AD_FILTER_MIN_DURATION              | 广告段最短时长（秒）             | 数字                 | 3                | 改错可能误删正片         |
| AD_FILTER_MAX_DURATION              | 广告段最长时长（秒）             | 数字                 | 120              | 改错可能误删正片         |
| AD_FILTER_MAX_SEGMENTS              | 广告段最多分片数                 | 数字                 | 15               | 改错可能误删正片         |
| M3U8_SERVER_PROXY                   | 是否把 m3u8 改写为服务端代理地址 | true/false           | 跟随广告过滤设置 | -                        |
| M3U8_DIRECT_MEDIA                   | m3u8 分片是否直连上游            | true/false           | false            | 可节省服务器带宽         |
| M3U8_PROXY_SIGNING_SECRET           | m3u8 代理地址签名密钥            | 任意字符串           | 空               | 未设置时复用 PASSWORD 等 |
| LIVE_SOURCE_REFRESH_CONCURRENCY     | 直播源抓取全局并发               | 1-16                 | 4                | -                        |
| SOURCE_VALIDATE_CONCURRENCY         | 视频源校验并发                   | 数字                 | 6                | -                        |
| SOURCE_VALIDATE_TIMEOUT_MS          | 视频源校验超时（毫秒）           | 数字                 | 12000            | -                        |
| PANSOU_PROXY_TIMEOUT_MS             | PanSou 请求超时（毫秒）          | 数字                 | 15000            | -                        |

#### NEXT_PUBLIC_DOUBAN_PROXY_TYPE 可选值

| 值                    | 说明                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| auto                  | 智能自动（默认），服务端按成功率和延迟在多个 provider 间自动降级                   |
| direct                | 服务器直接请求豆瓣源站                                                             |
| server                | 兼容值，等同于服务端智能代理                                                       |
| cors-proxy-zwei       | 服务端通过 [Zwei](https://github.com/bestzwei) 提供的 CORS Proxy 请求豆瓣数据      |
| cmliussss-cdn-tencent | 服务端通过 [CMLiussss](https://github.com/cmliu) 提供的腾讯云 CDN 加速请求豆瓣数据 |
| cmliussss-cdn-ali     | 服务端通过 [CMLiussss](https://github.com/cmliu) 提供的阿里云 CDN 加速请求豆瓣数据 |
| custom                | 使用自定义代理（需配置 NEXT_PUBLIC_DOUBAN_PROXY）                                  |

#### NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE 可选值

| 值                    | 说明                                                        |
| --------------------- | ----------------------------------------------------------- |
| auto                  | 智能自动（默认），按候选链路逐级重试                        |
| direct                | 浏览器直接请求豆瓣图片域名                                  |
| server                | 服务器代理请求豆瓣图片                                      |
| img3                  | 使用豆瓣官方精品 CDN（阿里云）                              |
| cmliussss-cdn-tencent | 使用 [CMLiussss](https://github.com/cmliu) 提供的腾讯云 CDN |
| cmliussss-cdn-ali     | 使用 [CMLiussss](https://github.com/cmliu) 提供的阿里云 CDN |
| custom                | 使用自定义代理（需配置 NEXT_PUBLIC_DOUBAN_IMAGE_PROXY）     |

`auto` 模式下，豆瓣数据请求统一走服务端 `/api/douban/*`：优先使用最近成功且延迟较低的 provider，单个 provider 超时、403/429/5xx、返回 HTML 或非 JSON 时，会记录失败原因并短期负缓存，然后自动尝试下一个 provider。API 成功响应会带 `X-DecoTV-Douban-Provider` 与 `X-DecoTV-Douban-Duration`，失败响应会带 `providerAttempts` 便于排查。

豆瓣封面图片在浏览器端按候选链路重试：用户选择的代理 → 上次 auto 成功节点 → `img3.doubanio.com` → CMLiussss 阿里云 CDN → CMLiussss 腾讯云 CDN → `/api/image-proxy` 服务器代理 → 豆瓣原图直连 → `poster-fallback.svg`。本地设置或后台配置变更后会触发 `doubanProxyChanged`，只清理豆瓣相关缓存。

### 弹幕功能配置

DecoTV 接入 [弹弹play开放平台](https://doc.dandanplay.com/open/) 提供的弹幕库。按照开放平台文档，应用取得的 `AppId` 与 `AppSecret` 需要妥善保管且不得泄露给他人。为避免将共享凭证写入公开代码或镜像，项目提供服务端中继用于部分公开部署场景。

#### 默认接入规则

| 部署方式                         | 默认行为                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Vercel 等非 Docker Web 部署      | 未配置自有凭证时，通过项目公共中继 `https://tv.katelya.eu.org` 加载弹弹play官方弹幕 |
| 官方 Docker 镜像                 | 不自动接入项目公共中继；可使用后台第三方弹幕节点，或配置自行申请的弹弹play凭证      |
| 已配置 `DANDANPLAY_APP_*` 的部署 | 优先在本部署服务端直连弹弹play开放平台                                              |
| 后台启用了第三方自定义弹幕节点   | 优先使用该第三方节点                                                                |

当视频数据包含 TMDB ID 时，自动匹配会优先使用开放平台的 `tmdbId + episode` 查询，失败时再按标题回退；获取弹幕使用 `withRelated=true` 汇集关联来源。弹幕与搜索结果会在服务端/CDN 缓存，减少对开放平台的重复请求。

#### 项目公共中继

`https://tv.katelya.eu.org` 提供弹弹play官方弹幕的公共中继能力。中继服务在服务端完成开放平台认证，下游部署和浏览器不会获得项目使用的 `AppSecret`。

公共中继主要用于简化 Vercel 等 Web 平台的部署体验。由于公共服务存在可用容量、异常调用检测及平台额度约束，服务可能按实际运行情况进行限流或临时暂停，不保证作为专用弹幕后端长期无限制使用。

#### 自行接入官方弹幕

需要独立可用性、希望脱离公共中继运行的部署，可在 [弹弹play DevCenter](https://dev.dandanplay.com/) 申请凭证，并仅在自己的服务端环境变量中配置：

```env
DANDANPLAY_APP_ID=在DevCenter申请的AppId
DANDANPLAY_APP_SECRET=有效AppSecret
```

Vercel 部署应将 `DANDANPLAY_APP_SECRET` 保存为 Sensitive Environment Variable，并在保存后重新部署。Docker 部署应从未提交到 Git 的运行时环境文件注入凭证，例如：

```bash
docker run --env-file .env.docker.local -p 3000:3000 decotv
```

#### Docker 与自定义中继

公开 Docker 镜像不会内置共享 `AppSecret`，也不会默认请求项目公共中继。镜像持有者能够检查镜像内容和运行环境，因此将共享密钥打包进公开镜像无法保证凭证安全。

希望为 Docker 实例统一提供官方弹幕的用户，可以在自己控制的服务器上部署 DecoTV 中继，并为容器指定中继地址：

```env
DANDANPLAY_RELAY_URL=https://your-relay.example.com
```

Vercel 或其他源码部署也可以使用 `DANDANPLAY_RELAY_URL` 覆盖默认中继；设为 `disabled` 时完全禁用中继回退。如果你的实例对外提供中继，可设置 `DANDANPLAY_PUBLIC_RELAY_ENABLED=false` 临时暂停，本实例的弹幕不受影响。

不要将真实密钥提交到仓库、写入 `NEXT_PUBLIC_*` 环境变量、打包进公开镜像或提供给前端生成签名。弹弹play文档说明开放平台将在 **2026 年 6 月 25 日** 起启用应用分层与额度管理机制；自行部署的中继服务应开启缓存，并根据流量情况配置限流策略。

#### 集成自部署弹幕服务（推荐 Docker 部署使用）

官方 Docker 镜像默认不接入公共中继，最省事的做法是部署一个 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api)（LogVar 弹幕 API）。启用后，网页端和安卓客户端都通过 DecoTV 服务端获取弹幕，不需要单独配置。

1. 在 Compose 中加入弹幕服务，并与 DecoTV 放在同一网络。访问令牌、数据持久化等配置见该项目的文档：

   ```yml
   services:
     decotv-danmu:
       image: logvar/danmu-api:latest
       container_name: decotv-danmu
       restart: unless-stopped
       networks:
         - decotv-network
   ```

2. 进入 DecoTV 后台 `弹幕配置`，启用自定义弹幕服务。
3. 在 `服务器连接` 中填写服务器地址，例如 `http://decotv-danmu:9321`；如果弹幕服务设置了访问令牌，一并填写。
4. 点击 `连通测试`，通过后保存。

后台还可以管理多个备用节点，并设置来源平台优先级、数量限制和屏蔽词等。弹幕服务只提供读取，安卓客户端不支持发送弹幕。

> 感谢 [弹弹play](https://www.dandanplay.com/) 为 DecoTV 提供弹幕服务支持！

### 访问秘钥与成人内容

成人内容默认过滤。要放开，必须同时满足两个条件：

1. 在后台 `站点配置` 中关闭成人内容过滤。
2. 请求 URL 带有效的访问秘钥，例如 `?ak=DKXXXX`。秘钥在后台 `访问秘钥` 中生成，停用或删除后立即失效。

如果在 `访问秘钥` 中启用了“空秘钥”，不带秘钥的请求也视为通过，但仍需先关闭过滤。旧的 `adult=1`、`filter=off` 参数和 `/adult/` 路径前缀已不再放开成人内容。

### 大模型翻译

在后台 `大模型配置` 中添加 OpenAI 兼容的 Chat Completions 接口后，可在 `翻译缓存` 中查看和批量处理译文。任意时刻最多启用一个配置。

新增配置的自动调用额度初始为 0，需要手动调整：`-1` 表示不限，`0` 表示禁止新的自动调用，正整数按实际请求次数扣减。手动翻译不扣额度。

### 直播频道抓取

直播频道缓存写入数据库。抓取成功后每小时刷新一次；失败后依次等待 1、5、15、60 分钟重试，之后保持 60 分钟，成功后恢复正常。

### 审计日志

后台 `审计日志` 记录所有用户的搜索和播放历史，每个用户最多保留 5000 条搜索记录。如果你把实例提供给其他人使用，请提前告知对方。

### 网盘搜索（PanSou）配置

DecoTV 的网盘搜索采用远程 PanSou 节点转发模式。推荐先部署 [fish2018/pansou](https://github.com/fish2018/pansou)，确认服务可访问后，在后台 `PanSou 配置` 中填入服务地址（可选填写 Token）。

快速示例：

1. 部署 PanSou 服务并确保 `https://your-pansou-domain/api/health` 可访问。
2. 进入 DecoTV 后台 `PanSou 配置` 页面。
3. 填写服务地址（例如 `https://your-pansou-domain`）。如果 PanSou 开启 `AUTH_ENABLED=true`，可以直接填写 PanSou 用户名/密码，DecoTV 会自动登录换取 JWT；也可以在 `API Token / 鉴权密钥` 中直接填 JWT，支持填 `Bearer xxx` 或裸 token。
4. 先执行连通性测试，再保存配置即可生效。

### TMDB 元数据增强配置

DecoTV 支持把 TMDB 作为与豆瓣互补的第二元数据来源，尤其适合欧美 / 日韩内容和私人影库场景。

快速使用：

1. 到 TMDB 后台申请 API Key。
2. 在环境变量 `TMDB_API_KEY` 或后台 `站点配置` 的 TMDB API Key 中填写。
3. 如果部署环境无法直连 TMDB，可额外配置 `TMDB_PROXY` 或 `TMDB_REVERSE_PROXY`。
4. 进入后台执行 `TMDB 连通性测试`，保存后即可生效。

使用建议：

- 华语内容可以继续以豆瓣为主，TMDB 负责补充海报、背景图和缺失简介。
- 私人影库建议同时开启 TMDB，这样 OpenList 文件名中的 `{tmdb-xxxx}` 或 Emby / Jellyfin 的 `ProviderIds.Tmdb` 可以直接命中精准元数据。
- 如果未配置 `TMDB_API_KEY`，项目会自动降级，不影响原有豆瓣链路和公共资源站播放。

### 私人影库配置（OpenList / 小雅 Alist / Emby / Jellyfin）

DecoTV 支持在后台接入 OpenList、小雅 Alist、Emby、Jellyfin 等私有媒体服务，配置成功后前台会自动显示“我的影库”入口。

OpenList 快速使用：

1. 准备 OpenList 服务地址、Token 和挂载根路径。
2. 推荐按以下格式整理目录，方便精准匹配 TMDB 元数据：

```text
电影：流浪地球2 (2023) {tmdb-835547}/流浪地球2.mkv
剧集：三体 (2023) {tmdb-1428232}/Season 01/S01E01.mkv
```

1. 进入后台 `私人影库配置`，添加连接并选择 `OpenList`。
2. 填写服务地址、Token、根路径，先测试连接，再执行扫描。

小雅 Alist 快速使用：

1. 准备小雅服务地址、访问密码（若实例开启了访问控制）和扫描根目录，默认根目录为 `/`。
2. 进入后台 `私人影库配置`，添加连接并选择 `小雅 Alist`。
3. 填写服务地址、访问密码和根目录；如实例未开启访问密码可留空，根目录可按需填写如 `/电影`。
4. 先测试连接，再执行扫描；播放 `.strm` 文件时，服务端会实时刷新阿里云盘直链。

Emby / Jellyfin 快速使用：

1. 在 Emby / Jellyfin 管理后台创建 API Key，按需准备用户 ID。
2. 在 DecoTV 后台添加 `Emby` 或 `Jellyfin` 连接，填写服务地址、API Key，可选填写用户 ID 和媒体库过滤。
3. 先测试连接，再保存配置，最后执行扫描或刷新。
4. 播放时 DecoTV 会通过服务端代理获取流地址，并尝试同步播放进度。

补充说明：

- 私人影库的视频流和鉴权信息不会直接暴露给浏览器端。
- 小雅 Alist 兼容 Alist API；如果测试连接提示鉴权失败，请检查是否需要填写访问密码。
- OpenList 默认根目录为 `/Media`，小雅 Alist 默认根目录为 `/`。
- 部分小雅资源暂不支持站内在线播放，遇到此类资源时请在小雅网页端打开。
- Emby / Jellyfin 私人影库支持音轨切换：播放器会基于 `AudioStreamIndex` 重新加载流并恢复切换前进度；HLS 资源支持无中断音轨切换。
- OpenList 即使没有 TMDB ID 也能扫描，但推荐使用规范命名以获得更好的元数据匹配效果。
- 如果某一个连接失效，只会影响该连接，不会影响其他连接和公共资源站功能。
- 更完整的部署变量说明可参考 [TMDB 与私人影库部署说明](./docs/tmdb-private-library-deployment.md)。

## ⬇️ 下载功能使用指南

### 1) 下载当前集（浏览器分片下载）

- 在播放页点击 `下载当前集`。
- m3u8 资源会自动解析分片并下载，完成后在浏览器本地合并导出。
- 该模式不依赖 FFmpeg，适合大部分 Web 部署场景。

### 2) FFmpeg 转存下载（服务端）

- 在播放页点击 `FFmpeg 转存下载`。
- 官方 Docker 镜像已内置 `ffmpeg`/`ffprobe`，VPS Docker 部署可直接使用。
- 自行构建镜像时请使用本仓库 Dockerfile；非 Docker 手动部署需自行安装 `ffmpeg` 和 `ffprobe`。
- Vercel 等 Serverless 环境无法稳定运行长时间 FFmpeg 进程，会自动降级为浏览器分片下载。

### 3) 推荐环境与可选变量

- 推荐：Docker / VPS（稳定支持浏览器下载 + FFmpeg 转存）。
- 推荐挂载：`/app/.cache/ffmpeg-downloads`，用于保存服务端转存的临时成品文件。
- 可选变量：
- `FFMPEG_PATH`：自定义 ffmpeg 可执行路径。
- `FFPROBE_PATH`：自定义 ffprobe 可执行路径。
- `FFMPEG_DOWNLOAD_DIR`：服务端转存文件目录。
- `FFMPEG_ALLOW_SERVERLESS=true`：仅在你明确具备可执行二进制能力时使用。

VPS Docker 持久化示例：

```yml
services:
  decotv:
    image: yangchongshun/deco-tv:latest
    ports:
      - '3000:3000'
    environment:
      - PASSWORD=你的管理密码
      - FFMPEG_MAX_CONCURRENT_JOBS=2
    volumes:
      - decotv-downloads:/app/.cache/ffmpeg-downloads
volumes:
  decotv-downloads:
```

如果使用宿主机目录绑定，例如 `./downloads:/app/.cache/ffmpeg-downloads`，请确保目录允许容器内 UID `1001` 写入：

```bash
mkdir -p ./downloads
sudo chown -R 1001:1001 ./downloads
```

### 4) 常见错误排查

- `拉取播放列表失败 (502)`：通常是上游 m3u8 源需要特定 `Referer/Origin`，请确认源可访问，或切换其他源重试。
- `FFmpeg API request failed (500/501)`：检查部署环境是否安装 FFmpeg；官方 Docker 镜像应开箱可用，自建镜像请确认 Dockerfile 包含 FFmpeg。
- `EACCES` / `permission denied`：转存目录不可写；使用上方 named volume，或修正宿主机目录权限。
- 转存大文件失败：检查 VPS 磁盘空间、反向代理超时和 `FFMPEG_JOB_RETENTION_MS`，必要时降低 `FFMPEG_MAX_CONCURRENT_JOBS`。

## Roadmap

- [ ] 多语言国际化支持
- [ ] 更多数据库存储选择
- [x] 安卓客户端（[DecoTV Android](https://github.com/Fugitive844/DecoTV-Android)）
- [ ] 智能推荐算法
- [ ] 用户评分系统
- [x] 弹幕功能（集成弹弹play弹幕库）
- [x] 下载管理（浏览器分片下载 + FFmpeg 转存）

## 📺 AndroidTV 使用

目前该项目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作为 OrionTV 后端

已实现播放记录和网页端同步

**详细配置指南**：

- 📖 [OrionTV 使用指南](./docs/OrionTV使用指南.md)

**成人内容**：API 地址默认只返回过滤后的内容，放开方式见 [访问秘钥与成人内容](#访问秘钥与成人内容)。旧的 `/adult/` 前缀仍可访问，但不再放开成人内容。

## 🎥 TVbox 配置

具体可见 [TVBox 配置优化说明](./TVBox配置优化说明.md)，详细功能见 `/admin` 管理页面的 **TVBox 配置**

## 🧑‍💻 用户注册功能

DecoTV 支持用户自助注册功能（可选），适合需要允许用户自行创建账号的场景。

**功能特性**：

- ✅ 图形验证码防机器人注册
- ✅ 严格的用户名和密码验证
- ✅ 管理后台即时启停和默认用户组配置（默认关闭）
- ✅ 仅支持 Redis/Upstash/Kvrocks 存储模式

**详细使用指南**：[用户注册功能说明](./docs/用户注册功能说明.md)

**快速启用**：

```bash
# 先设置支持多用户的存储
NEXT_PUBLIC_STORAGE_TYPE=redis  # 或 upstash、kvrocks
```

部署完成后，以站长账号进入 `/admin` 的“用户配置”，选择新用户默认用户组后打开“允许访客自行注册账号”。

> ⚠️ **安全提示**：建议默认关闭注册，仅在需要时临时开启，注册完成后在后台立即关闭。

## 🔒 安全与隐私提醒

### 请设置密码保护并关闭公网注册

为了您的安全和避免潜在的法律风险，我们要求在部署时**强烈建议关闭公网注册**：

### 部署要求

1. **设置环境变量 `PASSWORD`**：为您的实例设置一个强密码
2. **仅供个人使用**：请勿将您的实例链接公开分享或传播
3. **遵守当地法律**：请确保您的使用行为符合当地法律法规

### 重要声明

- 本项目仅供学习和个人使用
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任
- 本项目不在中国大陆地区提供服务。如有该项目在向中国大陆地区提供服务，属个人行为。在该地区使用所产生的法律风险及责任，属于用户个人行为，与本项目无关，须自行承担全部责任。特此声明

## 📄 License

[CC BY-NC-SA 4.0](LICENSE) © 2025 DecoTV & Contributors

## 🙏 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- [Zwei](https://github.com/bestzwei) — 提供获取豆瓣数据的 cors proxy
- [CMLiussss](https://github.com/cmliu) — 提供豆瓣 CDN 服务
- 感谢所有提供免费影视接口的站点。

## 📈 Star History

<div align="center">
  <a href="https://star-history.com/#Fugitive844/DecoTV&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Fugitive844/DecoTV&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Fugitive844/DecoTV&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Fugitive844/DecoTV&type=Date" />
    </picture>
  </a>
</div>

## 💝 赞赏支持

如果这个项目对你有所帮助，欢迎 Star ⭐ 本项目或请作者喝杯咖啡 ☕

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="public/wechat.jpg" alt="微信赞赏" width="200">
        <br>
        <sub><b>🎨 微信赞赏</b></sub>
      </td>
    </tr>
  </table>
</div>

---

<div align="center">
  <p>
    <strong>🌟 如果觉得项目有用，请点个 Star 支持一下！🌟</strong>
  </p>
  <p>
    <sub>Made with ❤️ by <a href="https://github.com/Decohererk">Decohererk</a> and <a href="https://github.com/Decohererk/DecoTV/graphs/contributors">Contributors</a>, maintained by <a href="https://github.com/Fugitive844">Fugitive844</a></sub>
  </p>
</div>
