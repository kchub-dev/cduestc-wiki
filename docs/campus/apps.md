---
aside: false
study:
  dingtalk:
    name: 钉钉
    icon: https://tvax2.sinaimg.cn/large/008IDFKely1hznj19cih7j30m80m80w6.jpg
    link: https://www.dingtalk.com/download#/
    desc:
      - 班群、通知、文件
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
      - 自学必备
      - 定期摄入知识
  yiban:
    name: 易班
    icon: https://tvax2.sinaimg.cn/large/008IDFKely1hzn9bmf8y6j30e80e8gmd.jpg
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
    icon: https://tvax1.sinaimg.cn/large/008IDFKely1hzn9hk211cj30cl0cl3yx.jpg
    link: https://www.gotokeep.com/
    desc: 校园跑


org:
  zhiyuanhui:
    name: 志愿汇
    icon: http://p19.qhimg.com/t01ee80da7f31430c22.png
    desc: 部分组织团体用来记录志愿时长
  xuexi:
    name: 学习强国
    icon: http://p15.qhimg.com/t01e6a78df67ae66ca9.png
    link: https://www.xuexi.cn/
    desc:
      - 党员必备
  tencentmeeting:
    name: 腾讯会议
    icon: https://tvax4.sinaimg.cn/large/008IDFKely1hznjd4fchhj3074074glh.jpg
    link: https://meeting.tencent.com/download/
    desc:
      - 部门线上会议
      - 老师线上课程

life:
  cainiao:
    name: 菜鸟
    icon: http://p16.qhimg.com/dr/_72_/t01950c338d20f6ccaa.png
    desc: 查快递、取快递
  huiyou:
    name: 汇优
    icon: https://tvax3.sinaimg.cn/large/008IDFKely1hzn9l3kotqj3074074wec.jpg
    link:
    desc:
      - 什邡校区 寝室热水
      - 仅支持支付宝充值
  pgsh:
    name: 胖乖生活
    icon: https://tvax1.sinaimg.cn/large/008IDFKely1hzn9nj7dc7j305c05cjr7.jpg
    link: 
    desc:
      - 公共洗衣机
      - 垃圾软件，一堆广告

weixin:
  kecheng:
    name: 科成云生活
    icon: https://tvax2.sinaimg.cn/large/008IDFKely1hznkki4lfqj30hs0hs0to.jpg
    desc:
      - 校内外卖、桶装水、超市
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
