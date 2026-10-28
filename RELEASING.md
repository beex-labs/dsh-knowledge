# RELEASING — DSH 插件发布流程

> **本文件是本仓库的权威发布流程。** 所有 DSH 插件仓库共用同一份模板，写入时把 `@@...@@` 占位符替换为本仓库的实际值。
> 模板升级时，请把同一改动同步到其它插件仓库（保持各仓库正文一致，只替换占位符）。
>
> 九步：① 发布前检查 → ② 改版本号 → ③ CHANGELOG 定稿 → ④ 提交 + tag + 推送
> → ⑤ `npm publish` → ⑥ 2FA → ⑦ 验证发布成功 → ⑧ 发布后一致性核验 → ⑨ GitHub Release + 市场收录。

---

## 0. 本仓库取值

| 项 | 值 |
| --- | --- |
| npm 包名 | `dsh-knowledge` |
| 当前版本 | `1.0.0` |
| 仓库 | [https://github.com/beex-labs/dsh-knowledge.git](https://github.com/beex-labs/dsh-knowledge.git) |
| 当前状态 | 未发布：`package.json` 为 `"private": true`，npm 拒绝发布。当前以本地 `link:` 方式安装使用。对外发布前需先去掉 `private`。（npm 上已有同名包 `dsh-knowledge`@0.5.2，但与本仓库不是同一份代码——发布前先确认包名与归属，避免覆盖别人的包。） |
| 发布前检查命令 | （无自动化检查脚本：人工核对 §2 清单） |
| 用户安装命令 | `dsh plugin --profile web add dsh-knowledge` |
| 本地开发安装命令 | `dsh plugin --profile web add "link:D:/SoftCode/File/anyiba/dsh/dsh-knowledge"` |

> 桌面版（Desktop）的 profile 归应用自己的插件管理器所有，应用运行期间命令行改不了它；请在应用 **设置 → 插件** 里操作。Web profile 用 `web`。

---

## 1. 前置条件

- **npm 已登录**：`npm whoami` 能显示账号（报 `need auth` 先 `npm login`）。
- **账号开 2FA**：`npm publish` 时需要在浏览器确认一步（步骤 ⑥）。
- **包名未被占用**：发布前先 `npm view dsh-knowledge versions`。有同名包且不是你的，先换名。
- **git 身份与远端**：`git config user.name / user.email` 已设，仓库有 `origin`。
- **registry 正常**：`npm ping` 能通。国内网络可临时 `npm config set registry https://registry.npmmirror.com/`，发布后记得确认 `registry.npmjs.org` 上也有。

---

## 2. 发布前准备（一次性，逐条核对）

### 2.1 `package.json`

```jsonc
{
  "name": "dsh-knowledge",
  "version": "X.Y.Z",
  "description": "一句话说明这个插件做什么（会显示在插件页）",
  "license": "MIT",
  "author": "...",
  "keywords": ["dsh-plugin", "deepseek-harness", "..."],
  "repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" },
  "homepage": "https://github.com/<owner>/<repo>#readme",
  "bugs": { "url": "https://github.com/<owner>/<repo>/issues" },
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md", "README.en.md", "CHANGELOG.md", "LICENSE"],
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },     // ← 必须：没有它就不是 bundle，装不上
    "client": { "platform": "web", "inject": ["..."] } // ← 仅带前端 UI 时需要
  }
}
```

要点：

- **`dsh.bundle.patch` 是硬性要求。** 只有 `dsh.client` 而没有 `dsh.bundle` 的包，安装器判定为 `not-a-bundle`，装进去只是个哑依赖，插件不会生效。市场收录 CI 也会因此拒绝。
- **scoped 包**（`@scope/name`）要 `"publishConfig": { "access": "public" }`，否则默认是私有的。
- **`"private": true` 的包发不到 npm**（npm 直接拒绝）。要对外发布，先去掉该字段。
- **`files` 白名单**决定真正发布的内容。`cordis.patch.yml`、`locale/`、`icon` 必须在内，否则插件装上了但没有名字/图标。
- **预构建产物**：把 `lib/` 一起发布（`prepack` 里构建，或直接提交构建产物）。这样用户安装时不需要跑构建脚本，也就**不会触发 pnpm 的 `allowBuilds` 授权拦截**。
- **`engines.dsh`**（如 `">=0.2.1-rc.2 <0.3.0-0"`）声明宿主版本要求；**不写 `engines.dsh` 时**，`peerDependencies` 里每一条 `@deepseek-ai/dsh-*` 范围都必须匹配当前 DSH 版本。
- **官方 `@deepseek-ai/*` 包一律写 `peerDependencies`，不要写 `dependencies`**（宿主自带这些包；写成 dependency 会拉一份副本，版本可能和宿主不一致）。

### 2.2 `cordis.patch.yml`（仓库根）

```yaml
- insert:
    - id: dsh-knowledge
      name: 'dsh-knowledge'
```

`id` 与 `name` 用包名，同一 patch 内的 id 必须唯一。

### 2.3 展示元数据

- `locale/en.json` 与 `locale/zh.json`：`{ "meta": { "title": "…", "description": "…" } }`（插件页显示的标题和说明）。
- 图标：`icon.svg`（或包根 `package.json` 的 `"icon"` 字段），≤ 256 KiB，必须在包内，不得用绝对路径/URL/越界的软链。
- 只写 `dsh.client`（无 bundle）的包不适用本节其余部分，但只要它出现在插件页，仍要有元数据。

### 2.4 README

- `README.md`（中文）+ `README.en.md`（英文）。
- 必须写明安装命令：`dsh plugin --profile web add dsh-knowledge`。
- 仓库打 `dsh-plugin` topic（市场收录的硬性要求）。

### 2.5 依赖与兼容性

- 用 `pnpm run check`（typecheck + test + build）确认全绿。
- 检查 peer 版本范围是否覆盖当前 DSH 预发布线——见第 6 节「预发布悬崖」。

---

## 3. 首次发布

### 3.1 步骤 ① 发布前检查

```bash
（无自动化检查脚本：人工核对 §2 清单）
npm pack --dry-run      # 核对真正会发布的文件：无密钥、无 tests/、无本地路径
```

`npm pack --dry-run` 的清单必须包含：`package.json`、`cordis.patch.yml`、`locale/*.json`、`icon`、构建产物 `lib/`、`README*`、`LICENSE`。

### 3.2 步骤 ② 改版本号

手动改 `package.json` 的 `version` 为 `X.Y.Z`。以下以目标版本号 `X.Y.Z` 指代。

### 3.3 步骤 ③ CHANGELOG 定稿

在 `CHANGELOG.md` 顶部新增一节：

```markdown
## X.Y.Z (YYYY-MM-DD)
```

- **日期必须是实际发布日**，在打 tag 之前就写好；不要留 `unreleased` 占位（CHANGELOG 随包发布，占位会原样进用户可见的包）。
- 尚未发布的变更条目先暂存在 `docs/PENDING_CHANGELOG.md`，发版时并入 `CHANGELOG.md` 后删掉该文件——因为 `CHANGELOG.md` 是随包文件，在已发布的 tag 之后改它会让「发布后一致性核验」正确地报出「tag 之后改动了发布内容」。

### 3.4 步骤 ④ 提交 + tag + 推送

版本号、CHANGELOG 日期定稿、README 必须在**同一个提交**里完成：

```bash
git add package.json CHANGELOG.md README.md README.en.md
git commit -m "chore: 版本升级至 X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <一句话说明>"
git push origin main
git push origin vX.Y.Z
```

- **不要把 CHANGELOG 日期定稿单独再提一个提交**，否则 tag 指向的提交只改了一行，回溯看不出这个版本包含哪些变更。
- tag 必须指向包含本次代码的提交。确认：`git rev-list -n1 vX.Y.Z` 应等于 `git rev-parse HEAD`。
- tag 一旦推送就是历史锚点，**不再移动**；后续补的文档提交不动 tag。

### 3.5 步骤 ⑤ 发布到 npm

```bash
npm publish
```

`files` 白名单决定包内容；发布产物应与 `npm pack --dry-run` 一致。

### 3.6 步骤 ⑥ 2FA 确认

`npm publish` 报 `EOTP` 时，按 npm CLI 给出的 URL 在浏览器登录确认，终端里的 `npm publish` 会自动继续。不要绕过 2FA。

> **2FA 报错不一定代表「没发出去」。** 凭据类错误（EOTP / 非交互 OTP）可能出现在上传**完成之后**。判据永远是 registry 的实际状态，见步骤 ⑦。

### 3.7 步骤 ⑦ 验证发布成功

```bash
npm view dsh-knowledge version          # 应显示 X.Y.Z
npm view dsh-knowledge dist-tags.latest # 应为 X.Y.Z
npm view dsh-knowledge versions         # 出现 X.Y.Z 即为发布成功
```

- 刚发布后 registry 读缓存有短暂延迟，稍等重查。
- **判据**：只有 registry 上没有该版本才算失败。`npm publish` 的退出信息不作为判据。
- 若报 `E409 Cannot publish over previously published versions`：先查 registry。已有该版本说明**已经发出去过了**，不要重发；确认确实未发布才顺延版本号。

### 3.8 步骤 ⑧ 发布后一致性核验

确认「npm 上的包」确实等于「tag 指向的源码」，防止发布时工作树有未提交改动：

```bash
git show vX.Y.Z:package.json | grep '"version"'   # 应显示 X.Y.Z
git diff --stat vX.Y.Z HEAD                        # 应只有不影响发布产物的文件

# 逐文件比对发布包与 tag（PNG 等二进制按哈希比，不按文本比）
npm pack dsh-knowledge@X.Y.Z && tar -xzf dsh-knowledge-X.Y.Z.tgz
for f in package.json cordis.patch.yml CHANGELOG.md README.md LICENSE; do
  a=$(shasum -a 256 "package/$f" | cut -d' ' -f1)
  b=$(git show vX.Y.Z:"$f" | shasum -a 256 | cut -d' ' -f1)
  [ "$a" = "$b" ] && echo "  OK $f" || echo "  MISMATCH $f"
done
```

构建产物 `lib/`（若未提交进 git）应**由 tag 源码重建后再比对**。

### 3.9 步骤 ⑨ GitHub Release + 市场收录

**GitHub Release**：在仓库 Releases 页新建，tag 选 `vX.Y.Z`（第 ④ 步已推送），标题 `vX.Y.Z`，正文改写成面向用户的措辞（可复用 CHANGELOG 的事实但不必逐字相同）。**Release 在 tag 之后创建**，两个锚点才指向同一提交。

**社区市场收录**（让插件能被搜到、可一键安装）：

1. 在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，新增一个文件 `data/plugins/<owner>__<repo>.yml`：

   ```yaml
   url: https://github.com/<owner>/<repo>      # 必须与仓库地址完全一致
   name: <owner>/<repo>
   category: tools                             # 见 contributing.md 的分类表
   description:
     en: One-line description ending with a period.
     zh: 一句话描述，以句号结尾。
   # 可选：icon: https://raw.githubusercontent.com/<owner>/<repo>/main/assets/icon-180.png
   # 可选：tarball: https://github.com/<owner>/<repo>/releases/download/v1.0.0/<pkg>-1.0.0.tgz
   ```

2. 要求：仓库 `package.json` 声明 `dsh.bundle` manifest、仓库创建满 1 天、有真实可用代码、打了 `dsh-plugin` topic、描述属实（维护者会对着源码核）。
3. 一个 PR 最多 3 条，只改自己的条目；两个 README 由脚本生成，**不要手工编辑**。
4. 合并后市场（`dshmarket` 插件）与站点自动收录，通常一天内生效。

> **进不了官方「Experimental plugins」那张卡。** 那张卡来自 DSH 发行版内嵌的 `OFFICIAL_ON_DEMAND_CATALOG`，只由官方自己填，第三方无法提交。第三方曝光只有社区注册表这一条路。

---

## 3.10 本仓库特有的发布步骤

（本仓库无额外步骤，按上文流程执行即可。）

---

## 4. 后续更新

发布动作与首次相同（步骤 ①–⑨），区别在下面这些：

### 4.1 用户侧怎么升级

**DSH 自带的插件页没有版本选择器，也没有给第三方插件的 Update 按钮**（Update 只给官方按需条目）。第三方插件升级 = **卸载后重装**：

```bash
dsh plugin --profile web remove dsh-knowledge
dsh plugin --profile web add dsh-knowledge
```

装了 `dshmarket` 市场的用户，可以用市场自己的「更新」按钮（市场按 npm 版本比对，提供一键更新）。

### 4.2 新版本发布后 24 小时内

pnpm 11 默认 `minimumReleaseAge` 为 1440 分钟（24 小时）。**新版本发布后 24 小时内，不带版本号的安装会解析到较早的版本**。想让用户立刻拿到新功能，在 README 和 release notes 里给出锁版本的安装命令：

```bash
dsh plugin --profile web add dsh-knowledge@X.Y.Z
```

### 4.3 版本号与 tag

- npm 不允许重复发布同一版本号。
- 已推送的 tag 是历史锚点，**不移动**；tag 之后补的文档提交不动 tag（只要不影响发布产物）。
- 忘了改 CHANGELOG 标题日期时：若 tag 已推送或包已发布，**不要移动 tag**，留给下个版本修正。

### 4.4 抬 `engines.dsh` / peer 下界前先想清楚

宿主在 pnpm 运行**之前**就做兼容性预检：范围不满足当前 DSH 版本 → **直接拒绝安装**，什么都不下载、不跑任何构建脚本。抬下界会让老宿主用户装不上——要么保留老范围兼容，要么在 CHANGELOG 里明确写「本版本起要求 DSH ≥ X」。

### 4.5 替换已安装的包

换版本或换来源（npm ↔ git ↔ link）等于「先移除再安装」。没有 HMR 的 profile 会报 `restart-required`；有 HMR 的 profile 也会在替换后重新组合运行中的插件。

---

## 5. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `npm publish` 报 EOTP | 账号开了 2FA，按 CLI 给的 URL 在浏览器确认。**但先查 registry**——包可能已经发出去了。 |
| `npm publish` 报 E409 | 该版本号在 registry 上已存在。先 `npm view dsh-knowledge versions` 确认：已发布就**不要重发**；确实没发布才顺延版本号。 |
| 发布后 `npm view version` 还是旧版 | registry 缓存延迟，稍等重查。 |
| 装上了但插件没生效 | 缺 `dsh.bundle.patch`（被判 `not-a-bundle`）；或 patch 里的 `id`/`name` 与包名不符；或 `engines.dsh`/peer 范围不覆盖当前宿主（profile 启动时被跳过，日志里有一行 `skipping profile bundle ...`）。 |
| 安装被 `allowBuilds` 拦截 | pnpm 10+ 默认拦依赖构建脚本。发布**预构建产物**可完全避免；否则用户需在弹窗里放行，或在 profile 的 `pnpm-workspace.yaml` 里 `allowBuilds` 放行该包名。 |
| 用户装到的是旧版本 | pnpm `minimumReleaseAge` 24 小时窗口；让用户锁版本安装（见 4.2）。 |
| 装别的包报 `ERR_PNPM_TARBALL_URL_MISMATCH` | pnpm 按默认 registry 校验 lockfile 里每个 tarball URL。装完切过 registry 后，卸载或再装别的包可能撞这个错；用当初安装所用的 registry 执行。 |
| 改完代码不生效 | 替换已安装的包需要重启进程（无 HMR 时）。链接目录（`link:`）的代码改动需要重新构建并重启。 |

---

## 6. 预发布悬崖（最容易踩的一条）

DSH 用 `semver.satisfies(runtime, range, { includePrerelease: true })` 判断兼容性，而 SemVer 里 `0.2.0-rc.1 < 0.2.0-0`。因此：

- peer 上界写 `<0.2.0-0`，会连带把**整条 0.2.0 预发布线**排除在外 → 插件在 DSH 0.2.x 上整个不加载（表现为「插件凭空消失」，不是报错）。
- 反过来，没有显式预发布分支的宽范围也匹配不到预发布版本：`>=0.0.1-rc.1 <0.2.0` 匹配不到 `0.1.0-rc.6`（范围内没有任何比较符与 `0.1.0` 这个 `major.minor.patch` 元组带预发布标签）。

**写法**：peer 范围里带上显式的 `||` 预发布分支，例如

```jsonc
"peerDependencies": {
  "@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.3.0-0"
}
```

或者更简单地用 `engines.dsh` 声明宿主范围：`">=0.2.1-rc.2 <0.3.0-0"`（`engines.dsh` 存在时它单独决定，`peerDependencies` 被忽略）。

---

## 7. 快速命令表

```bash
# 开发期本地安装（改代码即时生效，无需发布）
dsh plugin --profile web add "link:D:/SoftCode/File/anyiba/dsh/dsh-knowledge"

# 首次发布
（无自动化检查脚本：人工核对 §2 清单）
npm pack --dry-run
npm publish
npm view dsh-knowledge versions      # 判据：出现 X.Y.Z 即成功

# 后续升级（用户侧）
dsh plugin --profile web remove dsh-knowledge
dsh plugin --profile web add dsh-knowledge
dsh plugin --profile web add dsh-knowledge@X.Y.Z   # 24h 冷却期内锁版本
```
