# 常见问题解答

### 使用说明 / 讨论
* [视频教程](https://www.youtube.com/watch?v=4XN02GkcHUM)（特别感谢 [TheiTeckHq](https://www.youtube.com/channel/UC_DUzWMb8gZZnAbISQjmAfQ)）
* [idownloadblog](http://www.idownloadblog.com/2015/12/29/snapdrop/)
* [thenextweb](http://thenextweb.com/insider/2015/12/27/snapdrop-is-a-handy-web-based-replacement-for-apples-fiddly-airdrop-file-transfer-tool/)
* [winboard](http://www.winboard.org/artikel-ratgeber/6253-dateien-vom-desktop-pc-mit-anderen-plattformen-teilen-mit-snapdrop.html)
* [免費資源網路社群](https://free.com.tw/snapdrop/)
* [Hackernews](https://news.ycombinator.com/front?day=2020-12-24)
* [Reddit](https://www.reddit.com/r/Android/comments/et4qny/snapdrop_is_a_free_open_source_cross_platform/)
* [Producthunt](https://www.producthunt.com/posts/snapdrop)

### 求助！我无法安装 PWA！
如果您使用的是基于 Chromium 的浏览器（Chrome、Edge、Brave 等），您可以通过点击 [snapdrop.net](https://snapdrop.net) 右上角的安装按钮轻松在桌面安装 Snapdrop PWA（见下图）。
<img src="pwa-install.png">

### 关于连接方式？是设备之间的直接 P2P 连接还是通过第三方服务器？
如果浏览器支持 WebRTC，则使用 P2P 连接。WebRTC 需要一个信令服务器，但它仅用于建立连接，不参与文件传输。

### 关于隐私？文件会保存在第三方服务器上吗？
您的文件永远不会发送到任何服务器。文件仅在点对点之间传输。Snapdrop 甚至不使用数据库。如果您好奇，可以查看[服务器代码](https://github.com/RobinLinus/snapdrop/blob/master/server/)。即使 Snapdrop 能够查看传输的文件，WebRTC 也会在传输过程中对文件进行加密，因此服务器无法读取它们。

### 关于安全性？文件在计算机之间传输时是否加密？
是的。您的文件使用 WebRTC 传输，这会在传输过程中对文件进行加密。

### 为什么不实现 xyz 功能？
Snapdrop 是一个追求极致简单的研究项目。用户界面极其简单。功能的选择非常谨慎，因为复杂性呈二次方增长，因为每个功能都可能与其他功能相互干扰。我们非常专注于单一用例：即时文件传输。
我们不会为某些边缘情况优化。我们是在优化普通用户的使用流程。如果为了保持简单性而拒绝您的功能请求，请不要感到失望。

如果您想了解更多关于简单性的内容，可以阅读 [Insanely Simple: The Obsession that Drives Apple's Success](https://www.amazon.com/Insanely-Simple-Ken-Segall-audiobook/dp/B007Z9686O) 或 [Thinking, Fast and Slow](https://www.amazon.com/Thinking-Fast-Slow-Daniel-Kahneman/dp/0374533555)。

### Snapdrop 太棒了！我如何支持它？
* [通过 PayPal 捐款以帮助支付服务器费用](https://www.paypal.com/donate/?hosted_button_id=FTP9DXUR7LA7Q)
* [提交错误报告、提供反馈、提出建议](https://github.com/RobinLinus/snapdrop/issues)
* 在社交媒体上分享 Snapdrop
* 修复错误并提交拉取请求
* 进行安全分析和提供建议

## "非官方"实例
以下是一些其他人托管的 Snapdrop 非官方实例：
- https://pairdrop.net/
- https://snapdrop.k26.ch/
- https://snapdrop.9pfs.repl.co/
- https://filedrop.codext.de/
- https://s.hoothin.com/
- https://www.wulingate.com/
- https://snapdrop.fairysoft.net/
- https://airtransferer.web.app/
- https://drop.wuyuan.dev
- https://share.jck.cx

免责声明：我们与运行这些实例的人没有任何关联。我们不认识他们。我们无法验证他们运行的代码！

## 第三方应用
以下是一些第三方 Snapdrop 应用：

1. [Snapdrop 桌面应用](https://github.com/alextwothousand/snapdrop-desktop) 基于 Electron 构建（感谢 [alextwothousand!](https://github.com/alextwothousand/)）。

2. [Snapdrop Android 应用](https://github.com/fm-sys/snapdrop-android) 允许您通过分享操作直接从其他应用发送文件。

3. [Snapdrop Flutter 应用](https://github.com/congnguyendinh0/snapdrop_flutter)

4. [Snapdrop iOS 应用](https://github.com/CDsigma/Snapdrop-iOS-App)

5. [Snapdrop Node 应用（完全使用 Node 服务器）](https://github.com/Bellisario/node-snapdrop)

6. [SnapDrop VSCode 扩展](https://github.com/Yash-Garg/snapdrop-vsc)

7. 欢迎您也开发一个 :)

[< 返回](/README.zh-CN.md) 