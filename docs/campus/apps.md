---
aside: false
author: [Dnyo666]
study:
  dingtalk:
    name: 钉钉
    icon: https://th.bing.com/th/id/ODLS.8d3a039e-4d19-46fd-8a77-282d04e98582?w=32&h=32&qlt=90&pcl=fffffa&o=6&pid=1.2
    link: https://www.dingtalk.com/download#/
    desc:
      - 班群、通知、文件、工作
      - 钉工牌、育才工程
  chaoxing:
    name: 学习通
    icon: https://p19.qhimg.com/t01e56f9a7cebff2ea2.png
    link: https://app.chaoxing.com/
    desc:
      - 签到上课，平时课程
      - 不要忘记科成计划
  icourse163:
    name: 中国大学MOOC
    icon: http://p17.qhimg.com/t0155917bbe9d6eabc9.png
    link: https://www.icourse163.org/
    desc:
      - 自学必备，同时心理课可能会用到
      - 定期摄入知识
  yiban:
    name: 易班
    icon: https://img.pcsoft.com.cn/azsoft/202312/140009-65700de9eae4f.jpg
    link: https://www.yiban.cn/mobile/index.html
    desc: 在线科成考试
  daxuesoutijiang:
    name: 大学搜题酱
    icon: http://p19.qhimg.com/t01d349081b85401905.png
    link: https://www.daxuesoutijiang.com/
    desc:
      - 拍照搜题
      - 查习题册答案
  keep:
    name: KEEP
    icon: https://static1.keepcdn.com/misc/2015/08/20/12/53d254c061800000.png
    link: https://www.gotokeep.com/
    desc: 校园跑

org:
  zhiyuanhui:
    name: 志愿汇
    icon: http://p19.qhimg.com/t01ee80da7f31430c22.png
    link: http://mobile.d.appchina.com/McDonald/e/7490457/0/0/0/1757990969877/package_574.1757990969877
    desc: 部分组织团体用来记录志愿时长
  xuexi:
    name: 学习强国
    icon: http://p15.qhimg.com/t01e6a78df67ae66ca9.png
    link: https://www.xuexi.cn/
    desc:
      - 党员必备
  tencentmeeting:
    name: 腾讯会议
    icon: https://th.bing.com/th/id/ODLS.d5f0ed0d-1be8-4f28-bcee-92b9b1b06727?w=32&h=32&qlt=90&pcl=fffffa&o=6&pid=1.2
    link: https://meeting.tencent.com/download/
    desc:
      - 部门线上会议
      - 老师线上课程

life:
  cainiao:
    name: 菜鸟
    icon: http://p16.qhimg.com/dr/_72_/t01950c338d20f6ccaa.png
    link: http://mobile.d.appchina.com/McDonald/e/7478497/0/0/0/1757923238308/package_445.1757923238308
    desc: 查快递、取快递
  huiyou:
    name: 汇优
    icon: https://img.downkuai.com/logo/20221011/5fc42e23929133fe3ea800a6f6837536.png
    link: https://oss.cduestc.fun/huiyou-5.3.4.apk
    desc:
      - 什邡校区 寝室热水
      - 仅支持支付宝充值
  pgsh:
    name: 胖乖生活
    icon: https://pp.myapp.com/ma_icon/0/icon_53962564_1749801897/256
    link: http://mobile.d.appchina.com/McDonald/e/7486078/0/0/0/1757925065585/package_173.1757925065585
    desc:
      - 公共洗衣机
      - 垃圾软件，一堆广告
  doubao:
    name: 豆包
    icon: https://i0.wp.com/wx4.sinaimg.cn/large/006LFp2ily1i569fnh6bzj30d60d6tau.jpg
    link: https://doubao.com
    desc:
      - 日常生活
      - 学习解答

weixin:
  kecheng:
    name: 科成云生活
    icon: https://tvax2.sinaimg.cn/large/008IDFKely1hznkki4lfqj30hs0hs0to.jpg
    desc:
      - 生活必备服务号，校内外卖、桶装水、超市
---

<script setup>
import AppList from "/.vitepress/components/AppList.vue";
</script>

# 科成必备APP

## 课堂学习

<AppList :data="$frontmatter.study" />

## 组织培训

<AppList :data="$frontmatter.org" />

## 生活

<AppList :data="$frontmatter.life" />

## 小程序&公众号

<AppList :data="$frontmatter.weixin" />
