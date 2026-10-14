# Docker 镜像推送与服务器部署

本指南面向 `Fugitive844/DecoTV` 的维护者。下面是后续更新时可以复用的步骤；2026-10-14 本轮镜像推送和生产更新已经完成，具体执行结果见[发布状态与接手事项](发布状态与接手事项.md)。

GitHub 只做普通代码和文档提交/推送，**不创建 GitHub Release 或 Git tag**。文中“镜像发布”指向 Docker Hub 上传容器镜像；Docker 镜像的版本标签不需要对应 Git tag。

## 环境和部署对象

| 项目           | 当前约定                                                                            |
| -------------- | ----------------------------------------------------------------------------------- |
| 本地项目       | `C:\github\DecoTV`                                                                  |
| GitHub         | `https://github.com/Fugitive844/DecoTV`，默认分支 `main`                            |
| Docker Hub     | `yangchongshun/deco-tv`                                                             |
| 镜像架构       | 当前香港服务器为 `linux/amd64`；本指南构建单架构镜像                                |
| 本地开发       | Node.js 22 或更高版本、pnpm 10.14.0、Docker Desktop（Linux containers）             |
| Docker 内构建  | 当前 Dockerfile 使用 Node 22 Alpine、pnpm 10.14.0，不要求宿主机安装 Node 来构建镜像 |
| SSH 目标       | 香港阿里服务器 `47.243.109.87`；通过已有 SSH/HexHub 连接操作                        |
| 生产目录       | `/www/dk_project/dk_app/decotv`                                                     |
| 应用服务和容器 | `decotv-core`，容器端口 3000，服务器当前映射 3000                                   |
| 数据库         | `decotv-kvrocks`，Apache Kvrocks，内部端口 6666，当前管理映射端口 12106             |
| 生产数据库卷   | `decotv_kvrocks-data`，不要改 Compose 项目名或卷名                                  |
| 网站           | `https://tv.gzsuy.com`，宝塔 Nginx 反向代理到应用                                   |

线上使用已有密码和 `.env`，不在公开文档中记载生产密码。本地测试使用独立 Kvrocks 容器，实际本机凭据在同目录、Git 忽略的 `测试交接-本机私密.md`。

## 一、提交和推送 GitHub

在开发工作区先检查差异，明确最终待发布改动。示例中的路径要换成本次实际文件列表；不要在存在私密文件、他人暂存项时直接使用 `git add .`。

```powershell
Set-Location C:\github\DecoTV
git remote -v
git status --short
git diff --check
git diff --stat

# 仅在 origin 不正确时执行；本项目当前已指向此 fork。
# git remote set-url origin https://github.com/Fugitive844/DecoTV.git

# 示例：仅提交本次文档，保留其他人的暂存改动。
# 如只更新已有文档，修改文件列表即可。
git add -- 'docs/需求与部署/README.md' 'docs/需求与部署/测试交接.md'
git commit --only -m 'docs: update testing and deployment handoff' -- 'docs/需求与部署/README.md' 'docs/需求与部署/测试交接.md'
git push origin main
git ls-remote origin refs/heads/main
```

如果迁移文档，还要把旧路径删除纳入本次提交。私密文档和 `.env` 不在文件列表中。根目录原有已暂存的空 `docker-compose.yml` 必须保留，不与本轮文档一起提交。不要对共享工作区 reset、clean、强制推送；遇到远端变化，先核对再处理。

源码和文档共同交付后记下最终完整 commit SHA。GitHub 推送成功只证明仓库更新，不代表 Docker Hub 或生产容器同步更新。

当前 `.github/workflows/docker-image.yml` 配置的目标是 **GHCR**，不是 Docker Hub。推送 main 可能触发已有工作流；本轮没有改造它的触发条件和目标，也没有核验这次运行结果。不要把 GHCR 的 Actions 成功记录当作 Docker Hub 推送成功。若以后要自动推送 Docker Hub，需要另行配置工作流及受保护的凭据，不能把 Token 写进 YAML。

## 二、准备独立的构建工作区

Claude Code 正在开发时，从最终已推送 commit 创建独立 checkout，避免把未提交源码或本机文件混进镜像。下面的 `1ab9611…` 是已推送修复基线；接手时应换成最终验收的完整 SHA。

```powershell
$releaseCommit = '1ab96119246ee6a10e27c3f52b4ba58754c503b1'
$releaseShort = $releaseCommit.Substring(0, 7)
$releaseDir = "C:\releases\DecoTV-$releaseShort"

# 使用不存在的新目录；不要覆盖已有构建目录。
git clone https://github.com/Fugitive844/DecoTV.git $releaseDir
if ($LASTEXITCODE -ne 0) { throw '克隆失败，停止发布' }
Set-Location $releaseDir
git checkout --detach $releaseCommit
if ($LASTEXITCODE -ne 0) { throw '目标提交不存在，停止发布' }
git status --short
git rev-parse HEAD
```

构建目录应无工作区改动，HEAD 等于目标 SHA。确认 `.dockerignore` 排除了 `.env*`、`.git`、`.idea`、`.tmp`、`node_modules`、`.next`、本机私密文档和 `docs/imports`；Git 忽略规则和 Docker 忽略规则分别生效，不能互相替代。

检查最终提交中的私密文档路径仍被忽略。不要构建尚未提交忽略规则的新布局，也不要复制生产 `.env` 到构建上下文。Docker build args 只传版本标识，不传管理员密码、数据库密码或 Docker Hub Token。

## 三、构建并做本地运行验证

PowerShell 中使用日期、时间和提交号组成唯一镜像标签。`BUILD_TIMESTAMP` 要用 **14 位数字**，因为版本生成脚本不接受 `2026-10-14` 这种格式；Docker build 中 `.git` 已排除，所以提交 SHA 必须显式传入。

```powershell
$releaseTimestamp = Get-Date -Format yyyyMMddHHmmss
$releaseCommit = (git rev-parse HEAD).Trim()
$releaseCommitDate = (git show -s --format=%cI HEAD).Trim()
$releaseShort = $releaseCommit.Substring(0, 7)
$releaseRepo = 'yangchongshun/deco-tv'
$releaseTag = "$releaseTimestamp-$releaseShort"
$releaseImage = "${releaseRepo}:$releaseTag"

docker build --platform linux/amd64 `
  --build-arg "BUILD_TIMESTAMP=$releaseTimestamp" `
  --build-arg "GIT_COMMIT_SHA=$releaseCommit" `
  --build-arg "GIT_COMMIT_DATE=$releaseCommitDate" `
  --build-arg GIT_REF_NAME=main `
  --label "org.opencontainers.image.source=https://github.com/Fugitive844/DecoTV" `
  --label "org.opencontainers.image.revision=$releaseCommit" `
  -t $releaseImage .
if ($LASTEXITCODE -ne 0) { throw '构建失败，禁止继续推送或部署' }

docker image inspect $releaseImage --format '{{.Id}} {{.Os}}/{{.Architecture}}'
```

`next/font/google` 使构建需要能访问 Google 字体服务，另外要能拉取 Docker 基础镜像、pnpm 和 npm 依赖。字体或依赖网络失败属于构建未完成，不以 `latest` 旧镜像代替。核对访问与代理配置；不要关闭 TLS 校验或把代理密码写进 Dockerfile。

先按[测试交接](测试交接.md)启动独立本地 Kvrocks。准备 **Git/Docker 忽略的** `.env.release-smoke.local`，复制本机测试配置，保留测试密码和站长账号，把 `KVROCKS_URL` 中的主机/端口改为 `decotv-local-kvrocks:6666`。不要使用生产连接。查询本地数据库的实际 Docker 网络，再把候选应用加入该网络：

```powershell
$smokeNetworks = docker inspect decotv-local-kvrocks --format '{{json .NetworkSettings.Networks}}' | ConvertFrom-Json
$smokeNetwork = $smokeNetworks.PSObject.Properties.Name | Select-Object -First 1
if (-not $smokeNetwork) { throw '本地测试数据库网络不存在' }

docker run -d --name decotv-release-smoke `
  --network $smokeNetwork `
  -p 127.0.0.1:13000:3000 `
  --env-file .env.release-smoke.local `
  -e HOSTNAME=0.0.0.0 -e PORT=3000 `
  $releaseImage
if ($LASTEXITCODE -ne 0) { throw '候选容器启动失败' }

curl.exe -sS -o NUL -w 'login=%{http_code}\n' http://localhost:13000/login
curl.exe -sS http://localhost:13000/version.json
docker logs --tail 80 decotv-release-smoke
```

选择没有被占用的容器名和本地端口；如果同名容器存在，先确认是否属于本次发布再处理。打开 `http://localhost:13000`，完成登录、搜索、封面解码、管理分页与源检测。检查 `version.json` 的 commit SHA；使用同一套非成人测试源，不导入生产数据库。

测试完成后 `docker stop decotv-release-smoke`，确认身份再执行 `docker rm decotv-release-smoke`；不删除本地 Kvrocks 或卷。没有 healthcheck 时，容器显示 running 不能代替功能验证。

若同一提交已通过功能测试，按用户要求可跳过构建后的重复功能测试，直接推送和部署，仍核对容器启动、实际镜像版本与数据库保留。本轮用户明确要求停止重复测试，后续按此执行；不要把跳过的生产功能复测写成通过。

## 四、登录并推送 Docker Hub

本机已有 Docker Desktop 凭据不等于一定有目标仓库写权限；真正以 push 返回成功及远端 digest 为准。需要重新登录时：

```powershell
docker login --username yangchongshun
```

在交互提示中输入 Docker Hub 凭据或访问 Token，不使用命令行 `--password 明文`，不将 Token 放入 Git、报告或镜像。本地验证通过后先推送唯一版本：

```powershell
docker push $releaseImage
if ($LASTEXITCODE -ne 0) { throw '版本镜像推送失败，停止部署' }
docker buildx imagetools inspect $releaseImage
if ($LASTEXITCODE -ne 0) { throw '远端镜像校验失败' }
```

记录输出中的 registry **Digest**。它与 `docker image inspect` 的本地镜像 ID 属于不同对象，不能互换。生产优先使用 `yangchongshun/deco-tv@sha256:实际Digest`，或经过核验的唯一版本标签，避免只依赖会被覆盖的 `latest`。

唯一版本验收通过后可更新 latest；本指南只推这两个明确标签，不使用 `--all-tags` 推送本机所有历史标签。

```powershell
docker tag $releaseImage "${releaseRepo}:latest"
docker push "${releaseRepo}:latest"
if ($LASTEXITCODE -ne 0) { throw 'latest 推送失败；保留已成功的版本标签及其 digest' }
docker buildx imagetools inspect "${releaseRepo}:latest"
```

操作依据：[Docker 镜像构建](https://docs.docker.com/reference/cli/docker/buildx/build/)、[Docker 登录](https://docs.docker.com/reference/cli/docker/login/)、[Docker 镜像推送](https://docs.docker.com/reference/cli/docker/image/push/)。上面的步骤不创建任何 GitHub Release。

## 五、服务器更新前备份

以下为 **Linux 服务器 SSH** 命令，不在 Windows 本地执行。先确认目标是 `47.243.109.87` 和现有部署目录。Compose 必须继续在原目录执行，以保留原项目、网络和命名卷。

```bash
cd /www/dk_project/dk_app/decotv
docker compose version
docker compose config --quiet
docker compose config --images
docker compose ps
docker inspect decotv-kvrocks --format '{{.Id}} {{range .Mounts}}{{.Name}} {{.Destination}}{{end}}'

RELEASE_STAMP=$(date +%Y%m%d%H%M%S)
OLD_IMAGE_ID=$(docker inspect decotv-core --format '{{.Image}}')
docker tag "$OLD_IMAGE_ID" "decotv-rollback:$RELEASE_STAMP"
cp -p docker-compose.yml "docker-compose.yml.before-$RELEASE_STAMP"
chmod 600 "docker-compose.yml.before-$RELEASE_STAMP"
install -m 600 .env ".env.before-$RELEASE_STAMP"
```

保存备份文件名、旧镜像 ID 和 rollback 标签。Compose 当前含生产凭据，因此备份只在服务器保管，权限 0600。不要把完整 `docker compose config` 或备份内容贴到公共日志；`--quiet` 校验不输出配置，`--images` 只列镜像。

Compose 和 `.env` 备份**不是数据库备份**。若业务要求完整恢复数据，应确认已有可恢复的 Kvrocks 备份；不要在数据库运行中直接复制 RocksDB 数据文件当作一致快照。本轮只更新同版本应用实现，没有新做数据库快照，也没有数据库迁移操作。

## 六、只替换应用镜像并更新

用服务器编辑器打开现有 `docker-compose.yml`，**只改 `services.decotv-core.image`**。原行目前为上游 `ghcr.io/decohererk/decotv:latest`；替换为第四步实际取得的镜像 digest，例如：

```yaml
services:
  decotv-core:
    image: yangchongshun/deco-tv@sha256:这里填写实际镜像Digest
```

此片段只示意需要修改的字段，不能覆盖整份生产 Compose。保留现有管理员账号、密码、环境变量、数据库服务、12106 映射、requirepass、命名卷、网络和端口。公网可拉取的镜像通常无需服务器登录；若 Docker Hub 仓库为私有，则在服务器交互登录具有 pull 权限的账号。

```bash
cd /www/dk_project/dk_app/decotv
docker compose config --quiet
docker compose pull decotv-core
# 上一步必须成功，失败时停止，不继续运行下一条。
docker compose up -d --no-deps --pull never --wait --wait-timeout 60 decotv-core
docker compose ps
docker inspect decotv-core --format '{{.Config.Image}} {{.Image}} {{.State.Status}}'
docker inspect decotv-kvrocks --format '{{.Id}} {{range .Mounts}}{{.Name}} {{.Destination}}{{end}}'
```

这里以应用服务名限制更新，并用 `--no-deps` 避免启动其关联服务。当前应用没有 healthcheck，`--wait` 只能确认它进入 running，下一节才是业务就绪验证。具体语义见 [Docker Compose up 文档](https://docs.docker.com/reference/cli/docker/compose/up/)。

不要执行 `docker compose down -v`、`docker volume prune`，也不要为此次更新重建 Kvrocks、拉取新的 Kvrocks latest 或修改数据库镜像。应用重建会有短暂访问中断；单实例部署不保证零停机。

## 七、生产验收

先看容器内部应用和公网 Nginx 链路：

```bash
curl -sS -o /dev/null -w 'local_login=%{http_code}\n' http://127.0.0.1:3000/login
curl -sS -o /dev/null -w 'public_login=%{http_code}\n' https://tv.gzsuy.com/login
curl -sS https://tv.gzsuy.com/version.json
docker compose logs --tail 100 decotv-core
```

日志在受控终端查看；外发前去掉 Cookie、密码、Token 和可能敏感的资源 URL。Nginx access/error 日志按该站点配置中的实际路径查看，不假设所有服务器的日志路径相同。

验收至少记录：

- `version.json` 的 commit SHA 等于构建目标；运行容器镜像对应预期 digest。
- 新登录、已有用户会话、首页和搜索页正常；JS/CSS 返回正确 MIME、没有空响应或手机刷新白屏。
- 视频源、直播源、用户配置和播放记录仍在；生产源数量以部署前实际记录为基线，不强行用“156”替代实时值。
- 同源 `/api/image-proxy` 请求正确返回图片，前端 `img.complete && img.naturalWidth > 0`；抽测 HTTP、HTTPS、端口及带查询参数地址。对线上未筛选图片只记录元数据，不查看内容。
- 搜索、聚合/非聚合、虚拟滚动与末尾结果可达；视频源分页、跨页选择、检测完成后连接结束。
- 数据库容器 ID 与命名卷没有改变；现有数据库管理连接仍可用。
- 生产构建静置和操作时 CPU/GPU 与基线对照，手机真机另测。不把开发环境、ChatGPT 应用总占用或视频解码负载混作同一指标。

保留现有 Nginx/Lua 兼容配置，先验证新接口和静态资源。不要在同一次未验收更新中顺手删除旧代理逻辑或改全局 `nginx.conf`。测试报告不附截图。

验收通过后，将最终 commit、镜像标签、digest、部署时间、数据库保留证据和结果补入[发布状态与接手事项](发布状态与接手事项.md)。

## 八、回滚应用

如果新镜像启动失败、页面白屏或核心功能异常，先保留错误日志。恢复本次备份的 Compose，然后把应用镜像改为第五步保留的 **本地 rollback 标签**，防止上游 latest 漂移。下例时间戳必须替换为本次备份对应值：

```bash
cd /www/dk_project/dk_app/decotv
RELEASE_STAMP=替换为本次备份时间戳
cp -p "docker-compose.yml.before-$RELEASE_STAMP" docker-compose.yml
# 用编辑器把 decotv-core.image 改为 decotv-rollback:同一个时间戳。
docker compose config --quiet
docker compose up -d --no-deps --pull never --wait --wait-timeout 60 decotv-core
curl -sS -o /dev/null -w 'login=%{http_code}\n' https://tv.gzsuy.com/login
docker compose ps
```

本次仅替换 image 时 `.env` 本应没有变化，不需要覆盖。只有确认 `.env` 被本次操作误改时，才恢复对应 `.env.before-*` 并保持权限 0600。不要回滚或删除数据库数据卷；若未来版本包含数据迁移，必须另行设计数据恢复，不能套用这里的应用回滚步骤。

当前已经存在的 `docker-compose.yml.before-20261014-1ab9611` 是本轮文档交接前保存的额外备份，但没有为它创建本指南的时间戳 rollback 标签；接手者部署前仍需重新执行第五步。
