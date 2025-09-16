<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Dropdown from '../Dropdown.vue'

const isMobile = ref(false)
const qrUrl = 'https://pd.qq.com/g/cduestc2025'

// 检测是否为移动设备
const checkMobile = () => {
    if (typeof window !== 'undefined') {
        isMobile.value = window.innerWidth <= 768
    }
}

// 移动端点击处理
const handleMobileClick = () => {
    if (isMobile.value) {
        window.open(qrUrl, '_blank')
    }
}

// 窗口大小变化处理
const handleResize = () => {
    checkMobile()
}

onMounted(() => {
    checkMobile()
    if (typeof window !== 'undefined') {
        window.addEventListener('resize', handleResize)
    }
})

onUnmounted(() => {
    if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize)
    }
})
</script>

<template>
    <!-- 移动端：直接点击跳转 -->
    <div v-if="isMobile" class="card vp-doc mobile-card" @click="handleMobileClick">
        <img src="https://pd.qq.com/favicon.ico" alt="" class="coder-gulid-icon">
        "科成星球"频道
        <div class="desc">
            实验室纳新、技术交流、兴趣社群交流、学习沟通
        </div>
        <Icon icon="ri:external-link-line" class="arrow" />
    </div>

    <!-- 桌面端：显示下拉二维码 -->
    <Dropdown v-else class="card vp-doc">
        <img src="https://pd.qq.com/favicon.ico" alt="" class="coder-gulid-icon">
        "科成星球"频道
        <div class="desc">
            实验室纳新、技术交流、兴趣社群交流、学习沟通
        </div>
        <Icon icon="ri:arrow-down-s-line" class="arrow" />

        <template #content>
            <QRCode :src="qrUrl" />
            <div class="desc code-desc">
                QQ 扫码加入
            </div>
        </template>
    </Dropdown>
</template>

<style scoped>
.card {
    display: flex;
    align-items: center;
    gap: 0.2em 0.5em;
    position: relative;
    width: fit-content;
    margin: 0 auto;
    padding: 0.5em 1.6em 0.5em 0.8em;
    border-radius: 0.5rem;
    background: var(--vp-c-default-soft);
    flex-wrap: wrap;
}

.coder-gulid-icon {
    height: 1.5em;
}

.desc {
    font-size: 0.8em;
    line-height: normal;
    color: var(--vp-c-text-2);
}

:deep(.qrcode) {
    margin: 0.5em;
    border-radius: 0.5em;
}

.code-desc {
    margin-bottom: 1em;
    text-align: center;
}

.arrow {
    position: absolute;
    right: 0.2em;
}

.mobile-card {
    cursor: pointer;
    transition: all 0.2s ease;
}

.mobile-card:hover {
    background: var(--vp-c-bg-soft);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.mobile-card:active {
    transform: translateY(0);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.mobile-hint {
    font-size: 0.8em;
    color: var(--vp-c-brand-1);
    font-weight: 500;
}
</style>

<!-- eslint-disable-next-line vue/enforce-style-attribute -->
<style>
.dark .coder-gulid-icon {
    filter: brightness(12);
}
</style>