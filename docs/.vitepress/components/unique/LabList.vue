<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, nextTick } from 'vue'
import LabListData from '../../data/labs.json'
import LabItem from './LabItem.vue'

// 直接从JSON中获取分类数据
const labsData = ref<any[]>([...LabListData.实验室])
const interestGroupsData = ref<any[]>([...LabListData.兴趣社群])
const studyGroupsData = ref<any[]>([...LabListData.学习交流群])

// 移动端状态管理
const isMobile = ref(false)
const expandedSections = ref({
    '实验室': false,
    '兴趣社群': false,
    '学习交流群': false
})

// 悬浮按钮位置和显示状态
const floatingButtonStyle = ref({})
const activeSection = ref('')
const sectionRefs = ref<{ [key: string]: HTMLElement }>({})

// 移动端每个分类显示的数量
const MOBILE_DISPLAY_COUNT = 3

// 计算移动端显示的数据
const displayedLabsData = computed(() => {
    if (!isMobile.value || expandedSections.value['实验室']) {
        return labsData.value
    }
    return labsData.value.slice(0, MOBILE_DISPLAY_COUNT)
})

const displayedInterestGroupsData = computed(() => {
    if (!isMobile.value || expandedSections.value['兴趣社群']) {
        return interestGroupsData.value
    }
    return interestGroupsData.value.slice(0, MOBILE_DISPLAY_COUNT)
})

const displayedStudyGroupsData = computed(() => {
    if (!isMobile.value || expandedSections.value['学习交流群']) {
        return studyGroupsData.value
    }
    return studyGroupsData.value.slice(0, MOBILE_DISPLAY_COUNT)
})

// 检测是否为移动设备
const checkMobile = () => {
    if (typeof window !== 'undefined') {
        isMobile.value = window.innerWidth <= 768
    }
}

// 切换分类展开状态
const toggleSection = (section: string) => {
    expandedSections.value[section] = !expandedSections.value[section]
}

// 判断分类是否需要显示展开按钮
const needsExpandButton = (section: string, totalCount: number) => {
    return isMobile.value && totalCount > MOBILE_DISPLAY_COUNT && !expandedSections.value[section]
}

// 更新悬浮按钮位置
const updateFloatingButtonPosition = () => {
    if (!isMobile.value) {
        activeSection.value = ''
        return
    }

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop
    const windowHeight = window.innerHeight

    // 检查当前在哪个分类区域
    let currentSection = ''
    let bestMatch = { section: '', overlap: 0 }

    Object.keys(sectionRefs.value).forEach(section => {
        const element = sectionRefs.value[section]
        if (element) {
            const rect = element.getBoundingClientRect()
            const totalCount = getTotalCount(section)
            
            // 只考虑需要展开按钮的分类
            if (needsExpandButton(section, totalCount)) {
                // 计算分类在视口中的重叠面积
                const visibleTop = Math.max(0, rect.top)
                const visibleBottom = Math.min(windowHeight, rect.bottom)
                const overlap = Math.max(0, visibleBottom - visibleTop)
                
                // 选择重叠面积最大的分类
                if (overlap > bestMatch.overlap && overlap > 100) {
                    bestMatch = { section, overlap }
                }
            }
        }
    })

    currentSection = bestMatch.section

    if (currentSection !== activeSection.value) {
        activeSection.value = currentSection
    }

    // 更新按钮位置
    if (activeSection.value && sectionRefs.value[activeSection.value]) {
        const element = sectionRefs.value[activeSection.value]
        const rect = element.getBoundingClientRect()

        // 计算按钮位置：在分类底部附近，但不超出屏幕
        let bottomPosition = 20

        // 如果分类底部在视口内，将按钮放在分类底部附近
        if (rect.bottom > 0 && rect.bottom < windowHeight - 80) {
            bottomPosition = windowHeight - rect.bottom + 10
        }

        floatingButtonStyle.value = {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 1000,
            opacity: 1,
            transform: 'translateY(0)',
            transition: 'all 0.3s ease',
            display: 'flex'
        }
    } else {
        floatingButtonStyle.value = {
            opacity: 0,
            transform: 'translateY(20px)',
            transition: 'all 0.3s ease',
            pointerEvents: 'none'
        }
    }
}

// 获取分类总数
const getTotalCount = (section: string) => {
    switch (section) {
        case '实验室': return labsData.value.length
        case '兴趣社群': return interestGroupsData.value.length
        case '学习交流群': return studyGroupsData.value.length
        default: return 0
    }
}

// 数据已在声明时初始化，无需额外初始化函数

const shuffleLabs = () => {
    labsData.value.sort(() => Math.random() - 0.5)
}

const shuffleInterestGroups = () => {
    interestGroupsData.value.sort(() => Math.random() - 0.5)
}

const shuffleStudyGroups = () => {
    studyGroupsData.value.sort(() => Math.random() - 0.5)
}

// 处理窗口大小变化和滚动
const handleResize = () => {
    checkMobile()
    updateFloatingButtonPosition()
}

const handleScroll = () => {
    updateFloatingButtonPosition()
}

onMounted(() => {
    shuffleLabs()
    shuffleInterestGroups()
    shuffleStudyGroups()
    
    checkMobile()
    
    if (typeof window !== 'undefined') {
        window.addEventListener('resize', handleResize)
        window.addEventListener('scroll', handleScroll)
        
        // 延迟更新位置，确保DOM已渲染
        nextTick(() => {
            setTimeout(updateFloatingButtonPosition, 100)
        })
    }
})

onUnmounted(() => {
    if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize)
        window.removeEventListener('scroll', handleScroll)
    }
})
</script>

<template>
    <h1 class="center-line">
        科成实验室/兴趣社群/学习交流群列表
    </h1>

    <slot />

    <div class="center-line vp-doc">
        <a href="https://qm.qq.com/q/woNVaUfvuU" target="_blank" class="submit-link">
            科成星球-开发组 收集整理，点击提交或修改群组信息
            <Icon icon="ri:external-link-line" class="external-icon" />
        </a>
    </div>

    <!-- 实验室分类 -->
    <div class="category-section" ref="el => sectionRefs['实验室'] = el">
        <div class="category-title">
            🔬 实验室
            <Icon class="shuffle-btn" icon="ri:shuffle-fill" @click="shuffleLabs" />
            <span class="count">({{ labsData.length }})</span>
        </div>
        <TransitionGroup tag="section" class="lab-list vp-doc">
            <LabItem v-for="lab in displayedLabsData" v-bind="lab" :key="`lab-${lab.id}`" />
        </TransitionGroup>
        
        <!-- 移动端显示更多/收起提示 -->
        <div 
            v-if="isMobile && labsData.length > MOBILE_DISPLAY_COUNT" 
            class="more-hint clickable" 
            @click="toggleSection('实验室')"
        >
            <Icon 
                :icon="expandedSections['实验室'] ? 'ri:subtract-line' : 'ri:add-line'" 
                class="hint-icon" 
            />
            <span v-if="!expandedSections['实验室']">
                还有 {{ labsData.length - MOBILE_DISPLAY_COUNT }} 个实验室...
            </span>
            <span v-else>
                收起实验室列表
            </span>
            <Icon 
                :icon="expandedSections['实验室'] ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'" 
                class="hint-arrow" 
            />
        </div>
    </div>

    <!-- 兴趣社群分类 -->
    <div class="category-section" ref="el => sectionRefs['兴趣社群'] = el">
        <div class="category-title">
            🎮 兴趣社群
            <Icon class="shuffle-btn" icon="ri:shuffle-fill" @click="shuffleInterestGroups" />
            <span class="count">({{ interestGroupsData.length }})</span>
        </div>
        <TransitionGroup tag="section" class="lab-list vp-doc">
            <LabItem v-for="group in displayedInterestGroupsData" v-bind="group" :key="`interest-${group.id}`" />
        </TransitionGroup>
        
        <!-- 移动端显示更多/收起提示 -->
        <div 
            v-if="isMobile && interestGroupsData.length > MOBILE_DISPLAY_COUNT" 
            class="more-hint clickable" 
            @click="toggleSection('兴趣社群')"
        >
            <Icon 
                :icon="expandedSections['兴趣社群'] ? 'ri:subtract-line' : 'ri:add-line'" 
                class="hint-icon" 
            />
            <span v-if="!expandedSections['兴趣社群']">
                还有 {{ interestGroupsData.length - MOBILE_DISPLAY_COUNT }} 个社群...
            </span>
            <span v-else>
                收起兴趣社群列表
            </span>
            <Icon 
                :icon="expandedSections['兴趣社群'] ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'" 
                class="hint-arrow" 
            />
        </div>
    </div>

    <!-- 学习交流群分类 -->
    <div class="category-section" ref="el => sectionRefs['学习交流群'] = el">
        <div class="category-title">
            📚 学习交流群
            <Icon class="shuffle-btn" icon="ri:shuffle-fill" @click="shuffleStudyGroups" />
            <span class="count">({{ studyGroupsData.length }})</span>
        </div>
        <TransitionGroup tag="section" class="lab-list vp-doc">
            <LabItem v-for="group in displayedStudyGroupsData" v-bind="group" :key="`study-${group.id}`" />
        </TransitionGroup>
        
        <!-- 移动端显示更多/收起提示 -->
        <div 
            v-if="isMobile && studyGroupsData.length > MOBILE_DISPLAY_COUNT" 
            class="more-hint clickable" 
            @click="toggleSection('学习交流群')"
        >
            <Icon 
                :icon="expandedSections['学习交流群'] ? 'ri:subtract-line' : 'ri:add-line'" 
                class="hint-icon" 
            />
            <span v-if="!expandedSections['学习交流群']">
                还有 {{ studyGroupsData.length - MOBILE_DISPLAY_COUNT }} 个群组...
            </span>
            <span v-else>
                收起学习交流群列表
            </span>
            <Icon 
                :icon="expandedSections['学习交流群'] ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'" 
                class="hint-arrow" 
            />
        </div>
    </div>

    <!-- 悬浮展开按钮 - 简化版本，只在有可展开分类时显示 -->
    <Teleport to="body" v-if="isMobile && activeSection && !expandedSections[activeSection]">
        <div class="floating-button" :style="floatingButtonStyle" @click="toggleSection(activeSection)">
            <Icon class="button-icon" icon="ri:arrow-down-line" />
            <span class="button-text">展开</span>
        </div>
    </Teleport>
</template>

<style scoped>
.lab-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 1rem;
    margin: 1rem auto 3rem;
}

.center-line {
    margin: 2em 0 2rem;
    font: revert;
    line-height: normal;
    text-align: center;
}

.category-section {
    margin: 3rem 0;
}

.category-title {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin: 2rem 0 1.5rem;
    font-size: 1.5rem;
    font-weight: bold;
    text-align: center;
    color: var(--vp-c-text-1);
}

.shuffle-btn {
    cursor: pointer;
    font-size: 1.2rem;
    color: var(--vp-c-text-2);
    transition: color 0.2s;
}

.shuffle-btn:hover {
    color: var(--vp-c-brand-1);
}

.count {
    font-size: 1rem;
    font-weight: normal;
    color: var(--vp-c-text-2);
}

.v-move {
    transition: transform 0.3s;
}

/* 移动端更多提示 */
.more-hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    text-align: center;
    padding: 0.8rem 1rem;
    margin: 1rem auto;
    max-width: 280px;
    width: fit-content;
    font-size: 0.85rem;
    color: var(--vp-c-text-2);
    background: var(--vp-c-default-soft);
    border-radius: 20px;
    border: 1px dashed var(--vp-c-divider);
    transition: all 0.2s ease;
}

.more-hint.clickable {
    cursor: pointer;
    user-select: none;
}

.more-hint.clickable:hover {
    background: var(--vp-c-bg-soft);
    border-color: var(--vp-c-text-3);
    color: var(--vp-c-text-1);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.more-hint.clickable:active {
    transform: translateY(0);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.hint-icon {
    font-size: 1rem;
    opacity: 0.7;
}

.hint-arrow {
    font-size: 1.2rem;
    opacity: 0.6;
}

.more-hint.clickable:hover .hint-icon,
.more-hint.clickable:hover .hint-arrow {
    opacity: 1;
}

/* 悬浮展开按钮 */
.floating-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: 80px;
    height: 60px;
    background: var(--vp-c-brand-1);
    color: white;
    border: none;
    border-radius: 30px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.1);
    font-size: 0.85rem;
    font-weight: 500;
    transform-origin: center;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    flex-direction: column;
    padding: 0.5rem;
}

.floating-button:hover {
    background: var(--vp-c-brand-dark);
    transform: scale(1.05);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2), 0 3px 6px rgba(0, 0, 0, 0.15);
}

.floating-button:active {
    transform: scale(0.95);
}

.button-icon {
    font-size: 1.2rem;
    line-height: 1;
}

.button-text {
    font-size: 0.75rem;
    line-height: 1;
    white-space: nowrap;
}

/* 悬浮按钮动画 */
.floating-button {
    animation: float 3s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-3px); }
}

.floating-button:hover {
    animation: none;
}

/* 响应式设计 */
@media (max-width: 768px) {
    .category-title {
        font-size: 1.3rem;
        flex-wrap: wrap;
    }
    
    .lab-list {
        grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
        gap: 0.8rem;
    }
    
    .more-hint {
        margin: 0.5rem auto 2rem;
        font-size: 0.85rem;
    }
}

/* 桌面端隐藏移动端特有元素 */
@media (min-width: 769px) {
    .more-hint {
        display: none;
    }
    
    .floating-button {
        display: none;
    }
}

/* 提交链接样式 */
.submit-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--vp-c-text-2);
    text-decoration: none;
    transition: all 0.2s ease;
    padding: 0.4rem 0.8rem;
    border-radius: 8px;
    font-size: 0.9rem;
}

.submit-link:hover {
    color: var(--vp-c-brand-1);
    background: var(--vp-c-bg-soft);
    text-decoration: none;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.submit-link:active {
    transform: translateY(0);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.external-icon {
    font-size: 0.9em;
    opacity: 0.7;
    transition: opacity 0.2s ease;
}

.submit-link:hover .external-icon {
    opacity: 1;
}
</style>