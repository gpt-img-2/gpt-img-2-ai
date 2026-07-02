# Happy Horse Template Happy Horse 基于 Vercel + Supabase + Stripe + Kie.ai + Cloudflare R2 技术栈落地AI生图项目

## 预览地址

> 建议开启魔法梯子后访问

> Vercel全流程闭环，不过在预览时如果要体验生图，得订阅，建议自己下载代码，使用本地走Stripe测试模式体验

Vercel: [https://image3.org/](https://image3.org/)

> Cloudfare由于google登录等没配置域名，所以只能看个大概（我主要是用来显示部署成功可以访问到）

Cloudfare: [https://image3.org/](https://image3.org/)

## 快速上手

> 不少同学反馈github issues的图在开启魔法后还是展示不出来，现将文档部署到服务器（图片使用R2），阅读体交互验有很大提升（后续就维护这个网站内容了，github issues后续会删除，减少维护成本）

[✨项目快速上手全流程图文手册](https://doc.16781678.xyz/Happy Horse)


## 项目概要

- 比官网Happy Horse模板更好的地方：展示数据均为数据库数据，非动态JSON配置数据，好处是：更贴近真实项目，方便上线维护，减少写代码（在访问预览网站时会有loading...交互，自己clone的项目在导入预制数据后可见）；
- 首页Showcases展示的是：用户生图的20条按创建时间倒序数据（自己clone的项目表中无数据，可导入预制数据或者在Admin后台录入Showcases数据）；
- showcases页面展示的是：Admin后台录入Prompt数据；
- hairstyles页面展示的是：Admin后台录入Showcases数据（Tags：hairstyles）；

[✨项目可导入的表预制数据](https://image3.org/docs/configuration/preset-data)

[✨项目如何管理首页Showcases块、Showcases页、Hairstyles页数据](https://image3.org/docs/configuration/showcases-management)


## 视频教程

[✨Happy HorseTwo视频实战课程：AI 壁纸生成器开发视频教学（含Creem支付）（2025-12-03）](https://image3.org/docs/video-tutorials/ai-wallpaper-tutorial)

[✨Happy HorseTwo实战课程：从零搭建了一个一站式 AI 生成平台(2025-11-26)](https://image3.org/docs/video-tutorials/ai-platform-tutorial)


## 分支

- `main`: main branch (for vercel)
- `cloudfare`: cloudfare branch (for cloudfare)