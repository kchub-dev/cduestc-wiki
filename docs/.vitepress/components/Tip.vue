<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { computed, useTemplateRef } from 'vue'

const props = defineProps<{
    text?: string
    tip?: string
    icon?: string | boolean
    copy?: boolean
    details?: boolean
}>()

const tip = computed(() => props.tip || (props.copy ? '点击复制' : ''))
const tipSource = useTemplateRef('tip-text')

const { copy, copied } = useClipboard({ source: () => tipSource.value!.textContent!, legacy: true })
const icon = computed(() => props.icon
    || (copied.value && 'ph:check-bold')
    || (props.copy && 'ph:copy-bold')
    || 'ph:question-bold',
)
</script>

<template>
    <template v-if="props.details">
    <details>
        <summary ref="tip-text" v-tip="tip" class="tip" @click="props.copy && copy()">
            <slot>{{ text }}</slot>
            <Icon v-if="typeof icon === 'string'" :icon class="tip-icon" />
        </summary>
        <slot name="content"></slot>
    </details>
</template>
<template v-else>
    <span ref="tip-text" v-tip="tip" class="tip" @click="props.copy && copy()">
        <slot>{{ text }}</slot>
        <Icon v-if="typeof icon === 'string'" :icon class="tip-icon" />
    </span>
</template>
</template>

<style scoped>
.tip {
    position: relative;
    text-decoration: underline dashed var(--vp-c-text-3);
    text-underline-offset: 5px;
    cursor: pointer;
}

.tip-icon {
    display: inline-block;
    font-size: 1em;
    vertical-align: top;
}
</style>
