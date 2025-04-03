# 本地开发
## 安装

首先，[安装 Docker 和 docker-compose](https://docs.docker.com/compose/install/)。

然后，克隆仓库：
```
    git clone https://github.com/RobinLinus/snapdrop.git
    cd snapdrop
    docker-compose up -d
```
现在在浏览器中访问 `http://localhost:8080`。

- 要重启容器，运行 `docker-compose restart`
- 要停止容器，运行 `docker-compose stop`
- 要调试 NodeJS 服务器，运行 `docker logs snapdrop_node_1`

## 从 Docker Hub 拉取镜像在本地运行

安装 Docker 后，使用以下命令：
```
    docker pull linuxserver/snapdrop
```

要运行镜像，输入（如果主机的 8080 端口被占用，请使用另一个随机端口 <随机端口>:80）：
```
    docker run -d -p 8080:80 linuxserver/snapdrop
```

## 测试 PWA 相关功能
PWA 要求应用在正确设置和可信的 TLS 端点下提供服务。

nginx 容器会为您创建 CA 证书和网站证书。要正确设置证书的通用名称，您需要将 `docker/fqdn.env` 中的 FQDN 环境变量更改为您工作站的完全限定域名。

如果您想测试 PWA 功能，需要信任本地部署的证书 CA。为了方便起见，您可以从 `http://<您的 FQDN>:8080/ca.crt` 下载 crt 文件。将该证书安装到操作系统的信任存储中。
- 在 Windows 上，确保将其安装到 `受信任的根证书颁发机构` 存储中
- 在 MacOS 上，双击 `钥匙串访问` 中已安装的 CA 证书，展开 `信任`，并为 SSL 选择 `始终信任`
- Firefox 使用自己的信任存储。要安装 CA，在 Firefox 中访问 `http://<您的 FQDN>:8080/ca.crt`。当提示时，选择 `信任此 CA 来标识网站` 并点击确定
- 使用 Chrome 时，需要重启 Chrome 以重新加载信任存储（`chrome://restart`）。另外，安装新证书后，需要清除存储（开发者工具 -> 应用程序 -> 清除存储 -> 清除站点数据）

请注意，证书（CA 和 Web 服务器证书）会在一天后过期。
此外，每次重启 nginx docker 容器时，都会创建新的证书。

网站通过 `https://<您的 FQDN>:443` 提供服务。

## 部署说明
客户端期望服务器位于 http(s)://your.domain/server。

当在代理后面提供 node 服务器时，代理必须设置 `X-Forwarded-For` 头。否则，由代理服务的所有客户端将相互可见。

默认情况下，服务器在端口 3000 上监听。

有关 nginx 配置示例，请参见 `docker/nginx/default.conf`。

[< 返回](/README.zh-CN.md) 